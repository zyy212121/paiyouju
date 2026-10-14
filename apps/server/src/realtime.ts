import type {
  ClientToServerEvents,
  CommandAcknowledgement,
  CommandAcknowledgementCallback,
  InterServerEvents,
  RealtimeError,
  RoomChatMessage,
  SeatOperationResult,
  ServerToClientEvents,
  SocketData as ProtocolSocketData,
} from "@paiyouju/shared";
import {
  ActionSubmitSchema,
  AvatarIdSchema,
  BuyInCommandSchema,
  BuyTimeExtensionSchema,
  NextActionAutopilotCancelSchema,
  NextActionAutopilotSchema,
  ReserveAwaySchema,
  RevealOwnCardsSchema,
  RunoutChoiceSchema,
  RoomChatSendSchema,
  SeatLeaveSchema,
  SeatOperationSchema,
  SeatTakeSchema,
  TableStartSchema,
  TableRequestStateSchema,
  TableSubscribeSchema,
  TrusteeshipSetSchema,
} from "@paiyouju/shared";
import type { Server as HttpServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { Server as SocketIoServer, type Socket } from "socket.io";

import type { Environment } from "./config/environment.js";
import type { DatabaseClient } from "./db/client.js";
import { ApiError } from "./http/api-error.js";
import { createSessionService, type AuthenticatedIdentity } from "./modules/sessions/session.service.js";
import { createHandPersistenceService } from "./modules/tables/hand-persistence.service.js";
import { createRoomFileDiagnosticLog, type AdministratorRoomProbeEventName } from "./modules/tables/room-file-diagnostic-log.js";
import {
  createTableAccountingService,
  type AccountingMutationHooks,
  type LeaveAccountingResult,
  type SeatAccountingResult,
} from "./modules/tables/table-accounting.service.js";
import { finalizeRoomGameSessions } from "./modules/tables/table-session-lifecycle.js";
import { createTableTransitionService } from "./modules/tables/persistence/table-transition.service.js";
import { createTableLifecycleCommandService } from "./modules/tables/persistence/table-lifecycle-command.service.js";
import {
  advanceRuntimeAuthority,
  applyRuntimeAuthority,
  captureRuntimeAuthority,
  type RuntimeAuthorityState,
} from "./modules/tables/runtime/runtime-authority-state.js";
import { createSnapshotRepository } from "./modules/tables/snapshot/snapshot-repository.js";
import {
  deserializeTableSnapshot,
  SnapshotValidationError,
  type SnapshotRecord,
} from "./modules/tables/snapshot/snapshot-codec.js";
import { systemClock, systemScheduler, type Clock, type ScheduledTask, type Scheduler } from "./modules/tables/runtime/clock.js";
import { productionDeckProvider, type DeckProvider } from "./modules/tables/runtime/deck-provider.js";
import { createHandController } from "./modules/tables/runtime/hand-controller.js";
import { hydrateTableRuntime, type TableRuntimeHydrationSnapshot } from "./modules/tables/runtime/hydrate-table-runtime.js";
import { TableRuntime } from "./modules/tables/runtime/table-runtime.js";
import { projectTableStateForUser } from "./modules/tables/runtime/project-table-state.js";
import type { TableRuntimeManager } from "./modules/tables/runtime/table-runtime-manager.js";
import type { RuntimeRoomConfig, RuntimeSeat } from "./modules/tables/runtime/types.js";
import { KeyedSlidingWindowRateLimiter } from "./realtime/sliding-window-rate-limiter.js";
import { RoomChatBuffer } from "./realtime/room-chat-buffer.js";
import { assertFaultInjectionAllowed, type TableFaultInjector } from "./testing/fault-injection.js";

interface RealtimeSocketData extends ProtocolSocketData {
  commandTimestamps: number[];
  identity: AuthenticatedIdentity;
  sessionExpiryTask?: ScheduledTask;
  subscribedRooms: Set<string>;
}

type CommandFailure = Extract<CommandAcknowledgement<never>, { readonly ok: false }>;
type CommandSuccess<T> = Extract<CommandAcknowledgement<T>, { readonly ok: true }>;

export interface RealtimeLogger {
  error(data: Record<string, unknown>, message: string): void;
  info(data: Record<string, unknown>, message: string): void;
}

type RoomBroadcastStage = "afterActionCommitBeforeBroadcast" | "afterSettlementCommitBeforeBroadcast";

export const SOCKET_MAX_PAYLOAD_BYTES = 64 * 1_024;
export const SOCKET_MAX_SOCKETS_PER_USER = 5;
const SOCKET_TRANSPORT_MAX_PAYLOAD_BYTES = SOCKET_MAX_PAYLOAD_BYTES + 8 * 1_024;
const SOCKET_CONNECTIONS_PER_IP_PER_MINUTE = 30;
const SOCKET_CONNECTIONS_PER_USER_PER_MINUTE = 12;
const SOCKET_COMMANDS_PER_TEN_SECONDS = 120;
const SOCKET_COMMANDS_PER_USER_PER_TEN_SECONDS = 80;
const SOCKET_CHAT_MESSAGES_PER_USER_PER_TEN_SECONDS = 5;
const SOCKET_SEAT_COMMANDS_PER_USER_PER_THIRTY_SECONDS = 6;
const KNOWN_CLIENT_EVENTS = new Set([
  "action:submit",
  "hand:arm-next-action-autopilot",
  "hand:buy-time-extension",
  "hand:cancel-next-action-autopilot",
  "hand:reveal-own-cards",
  "hand:choose-runout-count",
  "room:chat-send",
  "seat:leave",
  "seat:reserve-away",
  "seat:set-trusteeship",
  "seat:return",
  "seat:sit-out",
  "seat:take",
  "stack:buy-in",
  "table:request-state",
  "table:start",
  "table:subscribe",
]);
const TRACED_CLIENT_EVENTS = new Set([
  "action:submit",
  "hand:arm-next-action-autopilot",
  "hand:buy-time-extension",
  "hand:cancel-next-action-autopilot",
  "hand:reveal-own-cards",
  "hand:choose-runout-count",
  "seat:leave",
  "seat:reserve-away",
  "seat:set-trusteeship",
  "seat:return",
  "seat:sit-out",
  "seat:take",
  "stack:buy-in",
  "table:start",
]);
const SEAT_LIFECYCLE_EVENTS = new Set([
  "seat:leave",
  "seat:reserve-away",
  "seat:return",
  "seat:sit-out",
  "seat:take",
]);

export interface AttachRealtimeOptions {
  readonly beforeSubscriptionAttach?: (roomId: string, userId: string) => void | Promise<void>;
  readonly clock?: Clock;
  readonly database: DatabaseClient;
  readonly deckProvider?: DeckProvider;
  readonly environment: Environment;
  readonly idFactory?: () => string;
  readonly logger?: RealtimeLogger;
  readonly faultInjector?: TableFaultInjector;
  readonly runtimes: TableRuntimeManager;
  readonly scheduler?: Scheduler;
}

export interface RealtimeRecoveryReport {
  readonly degradedRooms: number;
  readonly recoveredRooms: number;
}

export interface RealtimeSessionControl {
  disconnectSession(sessionId: string): Promise<void>;
}

export type RealtimeServer = SocketIoServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, RealtimeSocketData> & {
  recoverRoom(roomId: string): Promise<RealtimeRecoveryReport>;
  recoverTables(): Promise<RealtimeRecoveryReport>;
  readonly sessionControl: RealtimeSessionControl;
  shutdown(): Promise<void>;
};

type TableSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, RealtimeSocketData>;

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try { return decodeURIComponent(raw); } catch { return undefined; }
  }
  return undefined;
}

function stableOperationId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function realtimeError(
  code: RealtimeError["code"],
  message: string,
  stateVersion?: number,
  latestState?: RealtimeError["latestState"],
): RealtimeError {
  return {
    code,
    message,
    requestId: randomUUID(),
    ...(stateVersion === undefined ? {} : { stateVersion }),
    ...(latestState === undefined ? {} : { latestState }),
  };
}

function safeError(
  code: RealtimeError["code"],
  message: string,
  stateVersion?: number,
  latestState?: RealtimeError["latestState"],
): CommandFailure {
  const error = realtimeError(code, message, stateVersion, latestState);
  return {
    error: { code: error.code, message: error.message },
    ...(latestState === undefined ? {} : { latestState }),
    ok: false,
    requestId: error.requestId,
    ...(stateVersion === undefined ? {} : { stateVersion }),
  };
}

function safeSuccess<T>(data: T, stateVersion: number): CommandSuccess<T> {
  return { data, ok: true, requestId: randomUUID(), stateVersion };
}

function roomConfig(room: {
  readonly actionTimeSeconds: number;
  readonly bigBlind: number;
  readonly bombPotBlindMultiplier: number | null;
  readonly bombPotIntervalMinutes: number | null;
  readonly bombPotNextAt: Date | null;
  readonly durationMinutes: number;
  readonly expiresAt: Date;
  readonly initialBuyIn: number;
  readonly maximumBuyIn: number;
  readonly maxSeats: number;
  readonly minimumBuyIn: number;
  readonly name: string;
  readonly nextHandPaused: boolean;
  readonly ownerId: string;
  readonly paidCardRevealCost: number;
  readonly paidCardRevealEnabled: boolean;
  readonly roomCode: string;
  readonly requiresManualStart: boolean;
  readonly runItTwiceEnabled: boolean;
  readonly id: string;
  readonly smallBlind: number;
  readonly specialMode: "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT";
  readonly status: "OPEN" | "CLOSING" | "CLOSED";
  readonly squidRoundGraceEndsAt: Date | null;
  readonly squidRoundNumber: number;
  readonly squidSettlementPending: boolean;
  readonly squidStake: number | null;
  readonly tableStartedAt: Date | null;
}): RuntimeRoomConfig {
  return {
    actionTimeSeconds: room.actionTimeSeconds,
    bigBlind: room.bigBlind,
    bombPotBlindMultiplier: room.bombPotBlindMultiplier,
    bombPotIntervalMinutes: room.bombPotIntervalMinutes,
    bombPotNextAt: room.bombPotNextAt,
    durationMinutes: room.durationMinutes,
    expiresAt: room.expiresAt,
    initialBuyIn: room.initialBuyIn,
    maximumBuyIn: room.maximumBuyIn,
    maxSeats: room.maxSeats,
    minimumBuyIn: room.minimumBuyIn,
    name: room.name,
    nextHandPaused: room.nextHandPaused,
    ownerId: room.ownerId,
    paidCardRevealCost: room.paidCardRevealCost,
    paidCardRevealEnabled: room.paidCardRevealEnabled,
    roomCode: room.roomCode,
    roomId: room.id,
    requiresManualStart: room.requiresManualStart,
    runItTwiceEnabled: room.runItTwiceEnabled,
    smallBlind: room.smallBlind,
    specialMode: room.specialMode,
    status: room.status,
    squidRoundGraceEndsAt: room.squidRoundGraceEndsAt,
    squidRoundNumber: room.squidRoundNumber,
    squidSettlementPending: room.squidSettlementPending,
    squidStake: room.squidStake,
    tableStartedAt: room.tableStartedAt,
  };
}

export function attachRealtimeTransport(
  server: HttpServer,
  options: AttachRealtimeOptions,
): RealtimeServer {
  assertFaultInjectionAllowed(options.environment.NODE_ENV, options.faultInjector);
  const clock = options.clock ?? systemClock;
  const sessions = createSessionService(options.database, () => clock.now());
  const accounting = createTableAccountingService(options.database);
  const diagnosticLog = createRoomFileDiagnosticLog(options.database, {
    connectionProbesEnabled: options.environment.ADMIN_ROOM_CONNECTION_PROBES_ENABLED,
    enabled: options.environment.ADMIN_ROOM_FILE_LOG_ENABLED,
  });
  const persistence = createHandPersistenceService(options.database);
  const lifecycleCommands = createTableLifecycleCommandService(options.database);
  const snapshots = createSnapshotRepository(options.database);
  const deckProvider = options.deckProvider ?? productionDeckProvider;
  const idFactory = options.idFactory ?? randomUUID;
  const scheduler = options.scheduler ?? systemScheduler;
  const controllers = new Map<string, ReturnType<typeof createHandController>>();
  const sessionSockets = new Map<string, Set<string>>();
  const userSockets = new Map<string, Set<string>>();
  const connectionAttemptsByIp = new KeyedSlidingWindowRateLimiter(SOCKET_CONNECTIONS_PER_IP_PER_MINUTE, 60_000);
  const connectionAttemptsByUser = new KeyedSlidingWindowRateLimiter(SOCKET_CONNECTIONS_PER_USER_PER_MINUTE, 60_000);
  const commandsByUser = new KeyedSlidingWindowRateLimiter(SOCKET_COMMANDS_PER_USER_PER_TEN_SECONDS, 10_000);
  const chatMessagesByUser = new KeyedSlidingWindowRateLimiter(SOCKET_CHAT_MESSAGES_PER_USER_PER_TEN_SECONDS, 10_000);
  const seatCommandsByUser = new KeyedSlidingWindowRateLimiter(SOCKET_SEAT_COMMANDS_PER_USER_PER_THIRTY_SECONDS, 30_000);
  const roomChat = new RoomChatBuffer();
  let shuttingDown = false;
  const pendingBroadcastStage = new Map<string, RoomBroadcastStage>();
  const reservedAwayTasks = new Map<string, ScheduledTask>();
  const pendingDiagnosticWrites = new Set<Promise<void>>();
  const io = new SocketIoServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, RealtimeSocketData>(server, {
    cors: { credentials: true, origin: options.environment.CLIENT_ORIGIN },
    // Leave only enough framing headroom to return the typed 64 KiB application error.
    // Engine.IO still closes substantially larger frames before allocation grows unbounded.
    maxHttpBufferSize: SOCKET_TRANSPORT_MAX_PAYLOAD_BYTES,
    path: "/socket.io",
    serveClient: false,
  });

  function queueConnectionProbe(input: {
    readonly eventName: AdministratorRoomProbeEventName;
    readonly handId?: string | null;
    readonly payload: Readonly<Record<string, boolean | number | string | null | readonly number[] | readonly string[]>>;
    readonly roomId: string;
    readonly stateVersion: number;
  }): void {
    if (!options.environment.ADMIN_ROOM_FILE_LOG_ENABLED || !options.environment.ADMIN_ROOM_CONNECTION_PROBES_ENABLED) return;
    const write = diagnosticLog.recordProbe({
      createdAt: clock.now(),
      eventName: input.eventName,
      ...(input.handId !== undefined ? { handId: input.handId } : {}),
      payload: input.payload,
      roomId: input.roomId,
      stateVersion: input.stateVersion,
    }).then(() => undefined).catch(() => {
      options.logger?.error({ eventName: input.eventName, roomId: input.roomId }, "connection probe write failed");
    }).finally(() => {
      pendingDiagnosticWrites.delete(write);
    });
    pendingDiagnosticWrites.add(write);
  }

  function snapshotMutation<TResult>(
    previous: RuntimeAuthorityState,
    candidateFor: (result: TResult) => RuntimeAuthorityState,
  ): AccountingMutationHooks<TResult> & { readonly committedState: () => RuntimeAuthorityState | null } {
    let committed: RuntimeAuthorityState | null = null;
    return {
      async beforeMutation(transaction) {
        const record = await snapshots.lock(previous.room.roomId, transaction);
        if (
          !record
          || record.snapshotRevision !== previous.snapshotRevision
          || record.stateVersion !== previous.stateVersion
        ) {
          const error = new Error("牌桌快照已被较新事务更新") as Error & { code: string };
          error.code = "SNAPSHOT_CONFLICT";
          throw error;
        }
      },
      async afterMutation(result, transaction) {
        committed = await snapshots.persist(candidateFor(result), previous.snapshotRevision, transaction);
      },
      committedState() {
        return committed;
      },
    };
  }

  async function loadRuntimeSnapshot(roomId: string): Promise<TableRuntimeHydrationSnapshot | null> {
    const room = await options.database.room.findUnique({
      include: {
        tableSeats: {
          include: { user: { select: { avatarId: true, nickname: true } } },
          orderBy: { seatIndex: "asc" },
        },
      },
      where: { id: roomId },
    });
    if (!room) return null;
    const configuredRoom = roomConfig(room);
    const seats = room.tableSeats.map((seat) => ({
        avatarId: AvatarIdSchema.parse(seat.user.avatarId),
        gameSessionId: seat.gameSessionId,
        nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet,
        nextActionAutopilotArmed: seat.nextActionAutopilotArmed,
        pendingShowCardIndices: seat.pendingShowCardIndices.filter((index): index is 0 | 1 => index === 0 || index === 1),
        nickname: seat.user.nickname,
        playStatus: seat.playStatus,
        reservedAwayEndsAt: seat.reservedAwayEndsAt,
        seatId: seat.id,
        seatIndex: seat.seatIndex,
        stack: seat.stack,
        squidMarked: seat.squidMarked,
        squidRoundParticipant: seat.squidRoundParticipant,
        trusteeshipEnabled: seat.trusteeshipEnabled,
        userId: seat.userId,
        version: seat.version,
      }));
    const persistent = await options.database.tableSnapshot.findUnique({ where: { roomId } });
    if (persistent) {
      const recovered = deserializeTableSnapshot(persistent as unknown as SnapshotRecord, { room: configuredRoom, seats });
      return {
        currentHand: recovered.currentHand,
        handNumber: recovered.handNumber,
        lastButtonSeat: recovered.lastButtonSeat,
        lastCompletedHand: recovered.lastCompletedHand,
        postHandReview: recovered.postHandReview ?? null,
        room: recovered.room,
        seats: recovered.seats,
        snapshotRevision: recovered.snapshotRevision,
        startCountdownAt: recovered.startCountdownAt,
        stateVersion: recovered.stateVersion,
        status: recovered.status,
      };
    }
    const latestHand = await options.database.handRecord.findFirst({
      orderBy: { handNumber: "desc" },
      select: { buttonSeat: true, handNumber: true },
      where: { roomId },
    });
    const legacy = new TableRuntime(configuredRoom);
    legacy.handNumber = Math.max(latestHand?.handNumber ?? 0, room.nextHandNumber - 1);
    legacy.lastButtonSeat = latestHand?.buttonSeat ?? null;
    legacy.status = room.status === "CLOSED" ? "CLOSED" : room.status === "CLOSING" ? "CLOSING" : room.nextHandPaused ? "PAUSED" : "IDLE";
    for (const seat of seats) legacy.seats.set(seat.seatIndex, seat);
    const initial = await snapshots.upsertInitial(captureRuntimeAuthority(legacy));
    return {
      currentHand: initial.currentHand,
      handNumber: initial.handNumber,
      lastButtonSeat: initial.lastButtonSeat,
      lastCompletedHand: initial.lastCompletedHand,
      postHandReview: initial.postHandReview ?? null,
      room: initial.room,
      seats: initial.seats,
      snapshotRevision: initial.snapshotRevision,
      startCountdownAt: initial.startCountdownAt,
      stateVersion: initial.stateVersion,
      status: initial.status,
    };
  }

  async function loadRuntimeAuthority(roomId: string): Promise<RuntimeAuthorityState | null> {
    const recovered = await loadRuntimeSnapshot(roomId);
    if (!recovered) return null;
    return {
      currentHand: recovered.currentHand ?? null,
      handNumber: recovered.handNumber,
      lastButtonSeat: recovered.lastButtonSeat,
      lastCompletedHand: recovered.lastCompletedHand ?? null,
      postHandReview: recovered.postHandReview ?? null,
      room: recovered.room,
      seats: recovered.seats,
      snapshotRevision: recovered.snapshotRevision ?? 0,
      startCountdownAt: recovered.startCountdownAt ?? null,
      stateVersion: recovered.stateVersion ?? 0,
      status: recovered.status ?? "IDLE",
    };
  }

  io.use(async (socket, next) => {
    if (shuttingDown) {
      next(new Error("SERVER_SHUTTING_DOWN"));
      return;
    }
    const now = clock.now().getTime();
    const address = socket.handshake.address || "unknown";
    if (!connectionAttemptsByIp.take(address, now)) {
      options.logger?.info({ reason: "connection-rate" }, "socket rejected");
      next(new Error("SOCKET_CONNECTION_RATE_LIMITED"));
      return;
    }
    if (socket.handshake.headers.origin !== options.environment.CLIENT_ORIGIN) {
      options.logger?.info({ reason: "origin" }, "socket rejected");
      next(new Error("ROOM_ACCESS_DENIED"));
      return;
    }
    try {
      const rawToken = cookieValue(
        socket.handshake.headers.cookie,
        options.environment.SESSION_COOKIE_NAME,
      );
      const identity = await sessions.authenticate(rawToken);
      if (!identity) {
        options.logger?.info({ reason: "authentication" }, "socket rejected");
        next(new Error("SOCKET_AUTH_REQUIRED"));
        return;
      }
      if (!connectionAttemptsByUser.take(identity.user.id, now)) {
        options.logger?.info({ reason: "user-connection-rate", userId: identity.user.id }, "socket rejected");
        next(new Error("SOCKET_USER_CONNECTION_RATE_LIMITED"));
        return;
      }
      const existingSockets = userSockets.get(identity.user.id) ?? new Set<string>();
      if (existingSockets.size >= options.environment.MAX_SOCKETS_PER_USER) {
        options.logger?.info({ reason: "user-socket-limit", userId: identity.user.id }, "socket rejected");
        next(new Error("SOCKET_LIMIT_REACHED"));
        return;
      }
      existingSockets.add(socket.id);
      userSockets.set(identity.user.id, existingSockets);
      socket.data.identity = identity;
      socket.data.commandTimestamps = [];
      socket.data.subscribedRooms = new Set<string>();
      options.logger?.info({ userId: identity.user.id }, "socket connected");
      next();
    } catch {
      options.logger?.info({ reason: "authentication" }, "socket rejected");
      next(new Error("SOCKET_AUTH_REQUIRED"));
    }
  });

  async function subscribe(
    socket: TableSocket,
    rawPayload: unknown,
    acknowledge: CommandAcknowledgementCallback<"table:subscribe"> | CommandAcknowledgementCallback<"table:request-state">,
    requestOnly = false,
  ): Promise<void> {
    const parsed = (requestOnly ? TableRequestStateSchema : TableSubscribeSchema).safeParse(rawPayload);
    if (!parsed.success) {
      acknowledge(safeError("INVALID_REQUEST", "请求格式无效"));
      return;
    }
    const membership = await options.database.roomMember.findUnique({
      include: {
        room: {
          include: {
            tableSeats: { include: { user: { select: { nickname: true } } } },
          },
        },
      },
      where: {
        roomId_userId: {
          roomId: parsed.data.roomId,
          userId: socket.data.identity.user.id,
        },
      },
    });
    if (!membership) {
      acknowledge(safeError("ROOM_ACCESS_DENIED", "无权访问该房间"));
      return;
    }
    const runtime = await options.runtimes.getOrCreate(roomConfig(membership.room));
    if (!await hydrateTableRuntime(runtime, async () => loadRuntimeSnapshot(membership.roomId))) {
      acknowledge(safeError("TABLE_NOT_AVAILABLE", "牌桌当前不可用"));
      return;
    }
    syncReservedAwayTasks(runtime);
    if (!requestOnly && !socket.data.subscribedRooms.has(membership.roomId)) {
      await options.beforeSubscriptionAttach?.(membership.roomId, socket.data.identity.user.id);
      const attached = await runtime.queue.run(async () => {
        if (!socket.connected || !await sessions.isSessionActive(socket.data.identity.sessionId)) return false;
        if (!socket.connected) return false;
        await socket.join(membership.roomId);
        if (!socket.connected) return false;
        socket.data.subscribedRooms.add(membership.roomId);
        runtime.addPresence(socket.data.identity.user.id, socket.id);
        return true;
      });
      if (!attached) {
        queueConnectionProbe({
          eventName: "SESSION_REJECTED",
          payload: {
            connectionId: socket.id,
            reason: "SUBSCRIPTION_ATTACH_SESSION_INACTIVE",
            userId: socket.data.identity.user.id,
          },
          roomId: membership.roomId,
          stateVersion: runtime.stateVersion,
        });
        if (socket.connected) {
          acknowledge(safeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
          socket.disconnect(true);
        }
        return;
      }
      queueConnectionProbe({
        eventName: "SOCKET_SUBSCRIBED",
        payload: {
          connectionId: socket.id,
          presenceVersion: runtime.presenceVersion,
          subscribedRoomIds: [...socket.data.subscribedRooms],
          userConnected: runtime.isConnected(socket.data.identity.user.id),
          userId: socket.data.identity.user.id,
        },
        roomId: membership.roomId,
        stateVersion: runtime.stateVersion,
      });
      await controllerFor(membership.roomId).refreshTimers();
      await controllerFor(membership.roomId).evaluateStart();
      // Presence is recipient-visible authoritative state. Existing subscribers
      // must learn that a member attached even when no durable table state changed.
      await broadcastRoom(membership.roomId);
    }
    if (requestOnly) {
      queueConnectionProbe({
        eventName: "STATE_REQUESTED",
        payload: {
          adapterAttached: io.sockets.adapter.rooms.get(membership.roomId)?.has(socket.id) ?? false,
          connectionId: socket.id,
          declaredSubscribed: socket.data.subscribedRooms.has(membership.roomId),
          presenceConnected: runtime.isConnected(socket.data.identity.user.id),
          socketConnected: socket.connected,
          userId: socket.data.identity.user.id,
        },
        roomId: membership.roomId,
        stateVersion: runtime.stateVersion,
      });
    }
    if (!socket.connected || !await sessions.isSessionActive(socket.data.identity.sessionId)) {
      queueConnectionProbe({
        eventName: "SESSION_REJECTED",
        payload: {
          connectionId: socket.id,
          reason: "STATE_PROJECTION_SESSION_INACTIVE",
          userId: socket.data.identity.user.id,
        },
        roomId: membership.roomId,
        stateVersion: runtime.stateVersion,
      });
      if (socket.connected) {
        acknowledge(safeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        socket.disconnect(true);
      }
      return;
    }
    if (!socket.connected) return;
    const state = projectTableStateForUser(runtime, socket.data.identity.user.id);
    socket.emit("table:state", state);
    if (!requestOnly) socket.emit("room:chat-history", roomChat.history(membership.roomId));
    options.logger?.info({ roomId: membership.roomId, userId: socket.data.identity.user.id }, "table subscribed");
    acknowledge(safeSuccess(state, runtime.stateVersion));
  }

  async function broadcastRoom(roomId: string): Promise<void> {
    const runtime = options.runtimes.get(roomId);
    if (!runtime) return;
    await diagnosticLog.recordSnapshot(captureRuntimeAuthority(runtime), clock.now()).catch(() => {
      options.logger?.error({ roomId }, "administrator room snapshot log write failed");
    });
    const stage = pendingBroadcastStage.get(roomId);
    if (stage) {
      pendingBroadcastStage.delete(roomId);
      await options.faultInjector?.hit(stage, { transition: "action" });
    }
    const sockets = await io.in(roomId).fetchSockets();
    for (const target of sockets) {
      if (!await sessions.isSessionActive(target.data.identity.sessionId)) {
        queueConnectionProbe({
          eventName: "SESSION_REJECTED",
          payload: {
            connectionId: target.id,
            reason: "BROADCAST_SESSION_INACTIVE",
            userId: target.data.identity.user.id,
          },
          roomId,
          stateVersion: runtime.stateVersion,
        });
        target.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        target.disconnect(true);
        continue;
      }
      target.emit("table:state", projectTableStateForUser(runtime, target.data.identity.user.id));
    }
  }

  async function roomChatRecipients(roomId: string) {
    const candidates = await io.in(roomId).fetchSockets();
    const active = [] as typeof candidates;
    for (const target of candidates) {
      if (!await sessions.isSessionActive(target.data.identity.sessionId)) {
        target.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        target.disconnect(true);
      } else active.push(target);
    }
    const memberUserIds = new Set((await options.database.roomMember.findMany({
      select: { userId: true },
      where: { roomId, userId: { in: active.map((target) => target.data.identity.user.id) } },
    })).map((member) => member.userId));
    for (const target of active) {
      if (memberUserIds.has(target.data.identity.user.id)) continue;
      target.data.subscribedRooms.delete(roomId);
      await target.leave(roomId);
    }
    return active.filter((target) => memberUserIds.has(target.data.identity.user.id));
  }

  async function activeParticipants(roomId: string, seats: readonly RuntimeSeat[]): Promise<readonly RuntimeSeat[]> {
    const sockets = await io.in(roomId).fetchSockets();
    for (const target of sockets) {
      if (await sessions.isSessionActive(target.data.identity.sessionId)) {
        continue;
      } else {
        queueConnectionProbe({
          eventName: "SESSION_REJECTED",
          payload: {
            connectionId: target.id,
            reason: "HAND_START_PARTICIPANT_SESSION_INACTIVE",
            userId: target.data.identity.user.id,
          },
          roomId,
          stateVersion: options.runtimes.get(roomId)?.stateVersion ?? 0,
        });
        target.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        target.disconnect(true);
      }
    }
    return seats;
  }

  function controllerFor(roomId: string) {
    const existing = controllers.get(roomId);
    if (existing) return existing;
    if (shuttingDown) throw new Error("SERVER_SHUTTING_DOWN");
    const runtime = options.runtimes.get(roomId);
    if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
    const transitions = createTableTransitionService(options.database, {
      onAfterSettlementCommit: (context) => {
        if (options.faultInjector) pendingBroadcastStage.set(roomId, "afterSettlementCommitBeforeBroadcast");
        options.logger?.info({
          roomId,
          snapshotRevision: context.snapshotRevision,
          stateVersion: context.stateVersion,
          transition: context.transition,
        }, "hand settlement committed");
        return options.faultInjector?.hit("afterSettlementCommitBeforeRuntimeUpdate", context);
      },
      onAfterSnapshotCommit: (context) => {
        if (options.faultInjector && context.transition === "action" && !pendingBroadcastStage.has(roomId)) {
          pendingBroadcastStage.set(roomId, "afterActionCommitBeforeBroadcast");
        }
        options.logger?.info({
          roomId,
          snapshotRevision: context.snapshotRevision,
          stateVersion: context.stateVersion,
          transition: context.transition,
        }, "snapshot committed");
        return options.faultInjector?.hit("afterSnapshotCommitBeforeRuntimeUpdate", context);
      },
      onBeforeActionReceiptCommit: (context) => options.faultInjector?.hit("beforeActionReceiptCommit", context),
      onBeforeSettlementCommit: (context) => options.faultInjector?.hit("beforeSettlementCommit", context),
      onBeforeSnapshotCommit: (context) => options.faultInjector?.hit("beforeSnapshotCommit", context),
    });
    const created = createHandController(runtime, {
      assertHandCanStart: async (seats) => accounting.assertHandCanStart(
        roomId,
        seats.map((seat) => seat.userId),
      ),
      clock,
      commitPlayerAction: transitions.commitPlayerAction,
      commitPostHandReviewEnd: transitions.commitPostHandReviewEnd,
      commitRunoutChoice: transitions.commitRunoutChoice,
      commitRunoutVoteTimeout: transitions.commitRunoutVoteTimeout,
      commitRoomExpiry: transitions.commitRoomExpiry,
      commitRuntimeState: transitions.commitRuntimeState,
      commitStart: transitions.commitStart,
      commitTimeout: transitions.commitTimeout,
      deckProvider,
      idFactory,
      loadAuthoritativeState: () => loadRuntimeAuthority(roomId),
      onError: (error) => {
        options.logger?.error({
          err: error,
          roomId,
          ...(runtime.currentHand ? { handId: runtime.currentHand.state.handId } : {}),
          ...(error instanceof Error ? { errorName: error.name } : {}),
        }, "table timer command failed");
      },
      onFatalError: async () => {
        const error = realtimeError("PERSISTENCE_ERROR", "牌局结算持久化失败", runtime.stateVersion);
        io.to(roomId).emit("table:error", error);
      },
      onLifecycle: (event) => {
        const { type, ...data } = event;
        if (type === "hand persistence failed" || type === "state invariant violation") {
          options.logger?.error(data, type);
        } else {
          options.logger?.info(data, type);
          if (type === "automatic action") options.logger?.info(data, "expired timeout executed");
        }
      },
      onProbe: (event) => {
        const { handId, roomId: probeRoomId, stateVersion, type, ...payload } = event;
        queueConnectionProbe({ eventName: type, handId, payload, roomId: probeRoomId, stateVersion });
      },
      onRoomExpired: () => options.runtimes.notify(roomId),
      onStateChanged: () => broadcastRoom(roomId),
      persistCompletedHand: async (currentRuntime) => {
        const hand = currentRuntime.currentHand;
        if (!hand) throw new Error("missing runtime hand");
        const connectedUserIds = new Set(
          [...currentRuntime.seats.values()]
            .filter((seat) => currentRuntime.isConnected(seat.userId))
            .map((seat) => seat.userId),
        );
        return persistence.persistCompletedHand({
          actions: hand.actions,
          connectedUserIds,
          finishedAt: clock.now(),
          handNumber: hand.handNumber,
          handState: hand.state,
          paidCardRevealCost: hand.paidCardRevealCost,
          paidCardRevealEnabled: hand.paidCardRevealEnabled,
          roomId,
          seatSessions: new Map([...currentRuntime.seats.values()].map((seat) => [seat.userId, seat.gameSessionId])),
          startedAt: hand.startedAt,
        });
      },
      prepareHandParticipants: (seats) => activeParticipants(roomId, seats),
      retainConnectedParticipants: (seats) => seats,
      scheduler,
    });
    controllers.set(roomId, created);
    return created;
  }

  function syncReservedAwayTask(roomId: string, seat: RuntimeSeat): void {
    reservedAwayTasks.get(seat.seatId)?.cancel();
    reservedAwayTasks.delete(seat.seatId);
    if (seat.playStatus !== "RESERVED_AWAY" || !seat.reservedAwayEndsAt) return;
    const deadline = seat.reservedAwayEndsAt;
    reservedAwayTasks.set(seat.seatId, scheduler.schedule(deadline, async () => {
      reservedAwayTasks.delete(seat.seatId);
      const runtime = options.runtimes.get(roomId);
      if (!runtime || shuttingDown) return;
      try {
        let changed = false;
        await runtime.queue.run(async () => {
          const current = [...runtime.seats.values()].find((candidate) => candidate.seatId === seat.seatId);
          if (
            !current
            || current.playStatus !== "RESERVED_AWAY"
            || current.reservedAwayEndsAt?.getTime() !== deadline.getTime()
            || clock.now().getTime() < deadline.getTime()
          ) return;
          const participating = runtime.currentHand?.state.players.some((player) => player.playerId === current.userId) ?? false;
          const previous = captureRuntimeAuthority(runtime);
          const mutation = snapshotMutation(previous, (accounted: LeaveAccountingResult) => advanceRuntimeAuthority(previous, {
            seats: accounted.seatId === null
              ? previous.seats.filter((candidate) => candidate.seatIndex !== accounted.seatIndex)
              : previous.seats.map((candidate) => candidate.seatIndex === accounted.seatIndex
                ? {
                  ...candidate,
                  nextActionAutoCallCurrentBet: null,
                  nextActionAutopilotArmed: accounted.playStatus === "LEAVE_AFTER_HAND",
                  playStatus: accounted.playStatus ?? candidate.playStatus,
                  reservedAwayEndsAt: null,
                  stack: accounted.stack,
                  version: accounted.version,
                }
                : candidate),
          }));
          await accounting.requestLeave(current.userId, {
            expectedStateVersion: runtime.stateVersion,
            operationId: stableOperationId(`reserved-away-expiry:${roomId}:${current.gameSessionId}:${deadline.toISOString()}`),
            roomId,
          }, { ...mutation, participatingInHand: participating });
          const committed = mutation.committedState();
          if (committed) {
            applyRuntimeAuthority(runtime, committed);
            changed = true;
          }
        });
        if (changed) {
          await broadcastRoom(roomId);
          await controllerFor(roomId).evaluateStart();
          options.logger?.info({ roomId, seatId: seat.seatId }, "reserved-away seat expired");
        }
      } catch (error: unknown) {
        options.logger?.error({ roomId, seatId: seat.seatId, ...(error instanceof Error ? { errorName: error.name } : {}) }, "reserved-away expiry failed");
      }
    }));
  }

  function syncReservedAwayTasks(runtime: TableRuntime): void {
    for (const seat of runtime.seats.values()) syncReservedAwayTask(runtime.room.roomId, seat);
  }

  async function recoverTables(): Promise<RealtimeRecoveryReport> {
    const candidates = await options.database.room.findMany({
      select: { id: true },
      where: {
        OR: [
          { status: "CLOSING" },
          { tableSeats: { some: {} } },
          { snapshot: { isNot: null } },
        ],
      },
    });
    let degradedRooms = 0;
    let recoveredRooms = 0;
    for (const candidate of candidates) {
      try {
        const room = await options.database.room.findUniqueOrThrow({ where: { id: candidate.id } });
        const runtime = await options.runtimes.getOrCreate(roomConfig(room));
        if (!await hydrateTableRuntime(runtime, () => loadRuntimeSnapshot(candidate.id))) continue;
        syncReservedAwayTasks(runtime);
        const recoveredHand = runtime.currentHand;
        if (recoveredHand) {
          options.logger?.info({
            handId: recoveredHand.state.handId,
            roomId: candidate.id,
            snapshotRevision: runtime.snapshotRevision,
            stateVersion: runtime.stateVersion,
          }, "abrupt recovery detected");
          if (recoveredHand.turnDeadlineAt) {
            options.logger?.info({
              expired: recoveredHand.turnDeadlineAt.getTime() <= clock.now().getTime(),
              handId: recoveredHand.state.handId,
              roomId: candidate.id,
            }, "deadline recovered");
          }
          if (recoveredHand.state.status === "finished") {
            options.logger?.info({ handId: recoveredHand.state.handId, roomId: candidate.id }, "hand settlement resumed");
          }
        }
        if (runtime.room.status === "CLOSING") {
          options.logger?.info({ roomId: candidate.id }, "room closing resumed");
        }
        await controllerFor(candidate.id).resumeRecoveredState();
        await snapshots.markRecoveryReady(
          candidate.id,
          runtime.status,
          runtime.snapshotRevision,
          runtime.stateVersion,
        );
        if (runtime.room.status === "CLOSING") await options.runtimes.notify(candidate.id);
        recoveredRooms += 1;
        options.logger?.info({
          roomId: candidate.id,
          snapshotRevision: runtime.snapshotRevision,
          stateVersion: runtime.stateVersion,
        }, "runtime recovered");
      } catch (error: unknown) {
        const runtime = options.runtimes.get(candidate.id);
        if (runtime?.status === "PERSISTENCE_ERROR") {
          recoveredRooms += 1;
          options.logger?.error({ roomId: candidate.id, reason: "persistence-error-preserved" }, "runtime recovered in persistence error");
          continue;
        }
        degradedRooms += 1;
        const safeReason = error instanceof SnapshotValidationError ? error.reason : "recovery-failed";
        try { await snapshots.markRecoveryError(candidate.id, safeReason); } catch { /* keep the original safe recovery result */ }
        const room = await options.database.room.findUnique({ where: { id: candidate.id } });
        if (room) {
          const runtime = await options.runtimes.getOrCreate(roomConfig(room));
          runtime.status = "RECOVERY_ERROR";
          runtime.hydrated = true;
        }
        options.logger?.error({ roomId: candidate.id, reason: safeReason }, "snapshot validation failed");
      }
    }
    cleanupEligibleRuntimes();
    return { degradedRooms, recoveredRooms };
  }

  async function recoverRoom(roomId: string): Promise<RealtimeRecoveryReport> {
    const snapshot = await options.database.tableSnapshot.findUnique({ select: { id: true }, where: { roomId } });
    if (!snapshot) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
    const existing = options.runtimes.get(roomId);
    if (existing?.status === "RECOVERY_ERROR") {
      await existing.queue.run(() => {
        existing.hydrated = false;
      });
    }
    const report = await recoverTables();
    const recovered = options.runtimes.get(roomId);
    if (!recovered || recovered.status === "RECOVERY_ERROR") {
      throw new ApiError(409, "RECOVERY_RETRY_FAILED", "恢复重试未能完成");
    }
    return report;
  }

  function cleanupEligibleRuntimes(): void {
    for (const roomId of options.runtimes.evictEligible()) {
      controllers.get(roomId)?.dispose();
      controllers.delete(roomId);
      options.logger?.info({ roomId }, "runtime evicted");
    }
  }

  function commandError(error: unknown, socket: TableSocket, roomId: string) {
    const runtime = options.runtimes.get(roomId);
    const latestState = runtime ? projectTableStateForUser(runtime, socket.data.identity.user.id) : undefined;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = String((error as { readonly code?: unknown }).code);
      const allowed = [
        "ROOM_ACCESS_DENIED", "ROOM_NOT_OPEN", "TABLE_NOT_AVAILABLE", "SEAT_OUT_OF_RANGE", "SEAT_OCCUPIED",
        "USER_ALREADY_SEATED", "BUY_IN_OUT_OF_RANGE", "INSUFFICIENT_WALLET_BALANCE", "BUY_IN_DURING_HAND",
        "PLAYER_NOT_SEATED", "PLAYER_NOT_ACTIVE", "LEAVE_AFTER_HAND_SET", "NOT_PLAYER_TURN", "HAND_ID_MISMATCH",
        "STALE_STATE", "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS", "ACTION_IDEMPOTENCY_CONFLICT", "ILLEGAL_ACTION", "PERSISTENCE_ERROR", "SNAPSHOT_CONFLICT", "RECOVERY_ERROR", "TABLE_CLOSING", "TABLE_CLOSED",
        "ROOM_OWNER_REQUIRED", "TABLE_START_NOT_ALLOWED", "AUTOPILOT_NOT_AVAILABLE", "RESERVED_AWAY_NOT_AVAILABLE", "HAND_REVIEW_IN_PROGRESS", "HAND_REVIEW_CLOSED", "CARDS_ALREADY_PUBLIC", "TIME_EXTENSION_NOT_AVAILABLE",
        "SQUID_LEAVE_CONFIRMATION_REQUIRED", "SQUID_RESERVED_AWAY_DISABLED",
      ] as const;
      if ((allowed as readonly string[]).includes(code)) {
        if (code === "SNAPSHOT_CONFLICT") {
          options.logger?.error({ code, roomId, userId: socket.data.identity.user.id }, "snapshot conflict");
        } else if (code === "ACTION_IDEMPOTENCY_CONFLICT") {
          options.logger?.error({ code, roomId, userId: socket.data.identity.user.id }, "action receipt conflict");
        }
        return safeError(code as RealtimeError["code"], error instanceof Error ? error.message : "操作失败", runtime?.stateVersion, code === "STALE_STATE" || code === "SNAPSHOT_CONFLICT" ? latestState : undefined);
      }
    }
    options.logger?.error({ err: error, roomId, userId: socket.data.identity.user.id }, "table command failed");
    return safeError("TABLE_NOT_AVAILABLE", "牌桌操作失败", runtime?.stateVersion);
  }

  function isSnapshotConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
      && (error as { readonly code?: unknown }).code === "SNAPSHOT_CONFLICT";
  }

  async function recoverSnapshotConflict(roomId: string, error: unknown): Promise<void> {
    if (!isSnapshotConflict(error) || !options.runtimes.get(roomId)) return;
    await controllerFor(roomId).resynchronizeAuthority();
  }

  async function reportedErrorAfterSnapshotConflict(roomId: string, error: unknown): Promise<unknown> {
    try {
      await recoverSnapshotConflict(roomId, error);
      return error;
    } catch (reloadError: unknown) {
      return reloadError;
    }
  }

  async function requireFreshOperation(
    runtime: NonNullable<ReturnType<TableRuntimeManager["get"]>>,
    userId: string,
    scope: "TABLE_SEAT_TAKE" | "TABLE_BUY_IN" | "TABLE_SIT_OUT" | "TABLE_RETURN" | "TABLE_LEAVE",
    operationId: string,
    expectedStateVersion: number,
  ): Promise<boolean> {
    if (runtime.status === "RECOVERY_ERROR") {
      const error = new Error("牌桌恢复失败，已暂停操作") as Error & { code: string };
      error.code = "RECOVERY_ERROR";
      throw error;
    }
    const replay = await options.database.requestIdempotency.findUnique({
      select: { id: true },
      where: { scope_actorId_key: { actorId: userId, key: operationId, scope } },
    });
    if (!replay && runtime.status === "PERSISTENCE_ERROR") {
      const error = new Error("牌桌结算异常，已冻结状态变更") as Error & { code: string };
      error.code = "PERSISTENCE_ERROR";
      throw error;
    }
    if (!replay && expectedStateVersion !== runtime.stateVersion) {
      const error = new Error("牌桌状态已更新") as Error & { code: string };
      error.code = "STALE_STATE";
      throw error;
    }
    return replay !== null;
  }

  options.runtimes.onChange(async (roomId) => {
    if (shuttingDown) return;
    const initialRoom = await options.database.room.findUnique({ where: { id: roomId } });
    if (!initialRoom) return;
    const runtime = await options.runtimes.getOrCreate(roomConfig(initialRoom));
    if (!await hydrateTableRuntime(runtime, async () => loadRuntimeSnapshot(roomId))) return;
    let shouldEvaluate = false;
    await runtime.queue.run(async () => {
      const room = await options.database.room.findUnique({ where: { id: roomId } });
      if (!room) return;
      const profileRows = await options.database.tableSeat.findMany({
        include: { user: { select: { avatarId: true, nickname: true } } },
        where: { roomId },
      });
      let profileChanged = false;
      for (const row of profileRows) {
        const seat = runtime.seats.get(row.seatIndex);
        const avatarId = AvatarIdSchema.parse(row.user.avatarId);
        if (seat?.userId === row.userId && (seat.avatarId !== avatarId || seat.nickname !== row.user.nickname)) {
          runtime.seats.set(row.seatIndex, { ...seat, avatarId, nickname: row.user.nickname });
          profileChanged = true;
        }
      }
      if (profileChanged) runtime.markPresentationChanged();
      const persistenceFailed = runtime.status === "PERSISTENCE_ERROR";
      const roomStartedClosing = runtime.room.status !== "CLOSING" && room.status === "CLOSING";
      runtime.room = roomConfig(room);
      if (roomStartedClosing) options.logger?.info({ roomId }, "room closing");
      if (persistenceFailed) {
        await broadcastRoom(roomId);
        return;
      } else if (room.status === "CLOSING") {
        runtime.status = runtime.currentHand ? "CLOSING" : runtime.postHandReview ? "POST_HAND_REVIEW" : runtime.status;
        if (!runtime.currentHand && !runtime.postHandReview) {
          try {
            const closedAt = clock.now();
            const previous = captureRuntimeAuthority(runtime);
            const committed = await options.database.$transaction(async (transaction) => {
              await transaction.$queryRaw<Array<{ readonly id: string }>>`
                SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
              `;
              await finalizeRoomGameSessions(transaction, {
                closedAt,
                reason: `room-close:${roomId}:idle`,
                roomId,
              });
              const latestRoom = await transaction.room.update({
                data: { closedAt, status: "CLOSED" },
                where: { id: roomId },
              });
              return snapshots.persistRoomLifecycle({ ...previous, seats: [] }, roomConfig(latestRoom), transaction);
            });
            applyRuntimeAuthority(runtime, committed);
            const latestRoom = committed.room;
            if (latestRoom.status !== "CLOSED") throw new Error("room close did not commit");
            options.logger?.info({ roomId }, "room closed");
          } catch (error: unknown) {
            runtime.status = "CLOSING";
            options.logger?.error({ err: error, roomId }, "room closing seat release failed");
          }
        }
      } else if (room.status === "CLOSED") {
        runtime.status = "CLOSED";
      } else if (!runtime.currentHand) {
        runtime.status = room.nextHandPaused ? "PAUSED" : "IDLE";
        shouldEvaluate = true;
      }
      await broadcastRoom(roomId);
    });
    if (shouldEvaluate) await controllerFor(roomId).evaluateStart();
    cleanupEligibleRuntimes();
  });

  io.on("connection", (socket) => {
    const sessionId = socket.data.identity.sessionId;
    const ids = sessionSockets.get(sessionId) ?? new Set<string>();
    ids.add(socket.id);
    sessionSockets.set(sessionId, ids);
    void sessions.getSessionExpiry(sessionId).then((expiresAt) => {
      if (!socket.connected) return;
      if (!expiresAt || expiresAt.getTime() <= clock.now().getTime()) {
        socket.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        socket.disconnect(true);
        return;
      }
      socket.data.sessionExpiryTask = scheduler.schedule(expiresAt, () => {
        if (socket.connected) {
          socket.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
          socket.disconnect(true);
        }
      });
    }).catch(() => {
      options.logger?.error({ userId: socket.data.identity.user.id }, "socket session expiry lookup failed");
      if (socket.connected) {
        socket.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
        socket.disconnect(true);
      }
    });
    socket.use(async (event, next) => {
      const acknowledge = event.at(-1);
      const eventName = event[0];
      const commandNow = clock.now().getTime();
      socket.data.commandTimestamps = socket.data.commandTimestamps.filter(
        (timestamp) => commandNow - timestamp < 10_000,
      );
      if (socket.data.commandTimestamps.length >= SOCKET_COMMANDS_PER_TEN_SECONDS) {
        if (typeof acknowledge === "function") acknowledge(safeError("RATE_LIMITED", "实时命令过于频繁"));
        return;
      }
      socket.data.commandTimestamps.push(commandNow);
      const userId = socket.data.identity.user.id;
      if (!commandsByUser.take(userId, commandNow)) {
        if (typeof acknowledge === "function") acknowledge(safeError("RATE_LIMITED", "账号实时命令过于频繁"));
        return;
      }
      if (typeof eventName !== "string" || !KNOWN_CLIENT_EVENTS.has(eventName)) {
        if (typeof acknowledge === "function") acknowledge(safeError("UNKNOWN_EVENT", "不支持的实时命令"));
        return;
      }
      let payloadBytes: number;
      try {
        payloadBytes = Buffer.byteLength(JSON.stringify(event.slice(1).filter((value) => typeof value !== "function")), "utf8");
      } catch {
        if (typeof acknowledge === "function") acknowledge(safeError("INVALID_REQUEST", "请求格式无效"));
        return;
      }
      if (payloadBytes > SOCKET_MAX_PAYLOAD_BYTES) {
        if (typeof acknowledge === "function") acknowledge(safeError("PAYLOAD_TOO_LARGE", "实时请求内容过大"));
        return;
      }
      const rawCommand = event[1];
      const operationId = typeof rawCommand === "object"
        && rawCommand !== null
        && !Array.isArray(rawCommand)
        && typeof (rawCommand as { readonly operationId?: unknown }).operationId === "string"
        ? (rawCommand as { readonly operationId: string }).operationId
        : undefined;
      const lifecycleToken = operationId === undefined ? undefined : `${eventName}:${operationId}`;
      if (SEAT_LIFECYCLE_EVENTS.has(eventName) && !seatCommandsByUser.take(userId, commandNow, lifecycleToken)) {
        if (typeof acknowledge === "function") acknowledge(safeError("RATE_LIMITED", "座位状态操作过于频繁，请稍后再试"));
        return;
      }
      if (shuttingDown) {
        if (typeof acknowledge === "function") acknowledge(safeError("TABLE_NOT_AVAILABLE", "服务器正在安全停机"));
        return;
      }
      try {
        if (!await sessions.isSessionActive(socket.data.identity.sessionId)) {
          const acknowledge = event.at(-1);
          if (typeof acknowledge === "function") acknowledge(safeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
          next(new Error("SOCKET_AUTH_REQUIRED"));
          socket.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
          socket.disconnect(true);
          return;
        }
        const payload = event[1];
        if (
          TRACED_CLIENT_EVENTS.has(eventName)
          && typeof acknowledge === "function"
          && typeof payload === "object"
          && payload !== null
          && !Array.isArray(payload)
          && typeof (payload as { readonly roomId?: unknown }).roomId === "string"
        ) {
          const command = payload as { readonly handId?: unknown; readonly roomId: string };
          const receivedAt = clock.now();
          event[event.length - 1] = (result: unknown) => {
            acknowledge(result);
            const write = diagnosticLog.recordCommand({
              acknowledgement: result,
              actorUserId: socket.data.identity.user.id,
              eventName,
              ...(typeof command.handId === "string" ? { handId: command.handId } : {}),
              payload,
              receivedAt,
              roomId: command.roomId,
            }).then(() => undefined).catch(() => {
              options.logger?.error({ eventName, roomId: command.roomId, userId: socket.data.identity.user.id }, "diagnostic command trace write failed");
            }).finally(() => {
              pendingDiagnosticWrites.delete(write);
            });
            pendingDiagnosticWrites.add(write);
          };
        }
        next();
      } catch {
        next(new Error("SOCKET_AUTH_REQUIRED"));
        socket.disconnect(true);
      }
    });
    socket.on("table:subscribe", (payload, acknowledge) => {
      void subscribe(socket, payload, acknowledge).catch(() => {
        options.logger?.error({ userId: socket.data.identity.user.id }, "table subscribe failed");
        if (socket.connected) acknowledge(safeError("TABLE_NOT_AVAILABLE", "牌桌当前不可用"));
      });
    });
    socket.on("table:request-state", (payload, acknowledge) => {
      void subscribe(socket, payload, acknowledge, true).catch(() => {
        options.logger?.error({ userId: socket.data.identity.user.id }, "table state request failed");
        if (socket.connected) acknowledge(safeError("TABLE_NOT_AVAILABLE", "牌桌当前不可用"));
      });
    });
    socket.on("room:chat-send", (payload, acknowledge) => {
      void (async () => {
        const parsed = RoomChatSendSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "聊天内容格式无效")); return; }
        const { clientMessageId, content, roomId } = parsed.data;
        if (!socket.data.subscribedRooms.has(roomId)) {
          acknowledge(safeError("ROOM_ACCESS_DENIED", "请先进入该房间"));
          return;
        }
        const commandNow = clock.now();
        if (!chatMessagesByUser.take(socket.data.identity.user.id, commandNow.getTime(), `${roomId}:${clientMessageId}`)) {
          acknowledge(safeError("RATE_LIMITED", "聊天发送过于频繁，请稍后再试"));
          return;
        }
        const runtime = options.runtimes.get(roomId);
        if (!runtime) { acknowledge(safeError("TABLE_NOT_AVAILABLE", "牌桌当前不可用")); return; }
        const membership = await options.database.roomMember.findUnique({
          select: { user: { select: { nickname: true } } },
          where: { roomId_userId: { roomId, userId: socket.data.identity.user.id } },
        });
        if (!membership) {
          acknowledge(safeError("ROOM_ACCESS_DENIED", "无权访问该房间"));
          return;
        }
        const seatIndex = [...runtime.seats.values()].find((seat) => seat.userId === socket.data.identity.user.id)?.seatIndex ?? null;
        const recipients = await roomChatRecipients(roomId);
        const message: RoomChatMessage = {
          content,
          createdAt: commandNow.toISOString(),
          id: randomUUID(),
          roomId,
          sender: {
            nickname: membership.user.nickname,
            seatIndex,
            userId: socket.data.identity.user.id,
          },
        };
        const appended = roomChat.append(clientMessageId, message);
        if (appended.inserted) for (const target of recipients) target.emit("room:chat-message", appended.message);
        acknowledge(safeSuccess(appended.message, runtime.stateVersion));
      })().catch(() => {
        options.logger?.error({ roomId: payload.roomId, userId: socket.data.identity.user.id }, "room chat send failed");
        if (socket.connected) acknowledge(safeError("TABLE_NOT_AVAILABLE", "聊天发送失败"));
      });
    });
    socket.on("seat:take", (payload, acknowledge) => {
      void (async () => {
        const parsed = SeatTakeSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const result = await runtime.queue.run(async () => {
            const replay = await requireFreshOperation(runtime, socket.data.identity.user.id, "TABLE_SEAT_TAKE", parsed.data.operationId, parsed.data.expectedStateVersion);
            const currentUser = await options.database.user.findUnique({
              select: { avatarId: true, nickname: true },
              where: { id: socket.data.identity.user.id },
            });
            if (!currentUser) throw new Error("SOCKET_AUTH_REQUIRED");
            const previous = captureRuntimeAuthority(runtime);
            const mutation = snapshotMutation(previous, (accounted: SeatAccountingResult) => advanceRuntimeAuthority(previous, {
              seats: [...previous.seats, {
                avatarId: AvatarIdSchema.parse(currentUser.avatarId),
                gameSessionId: accounted.gameSessionId,
                nextActionAutoCallCurrentBet: null,
                nextActionAutopilotArmed: false,
                nickname: currentUser.nickname,
                playStatus: accounted.playStatus,
                reservedAwayEndsAt: null,
                seatId: accounted.seatId,
                seatIndex: accounted.seatIndex,
                stack: accounted.stack,
                squidMarked: false,
                squidRoundParticipant: previous.room.specialMode === "SQUID" && !(previous.room.squidSettlementPending ?? false),
                trusteeshipEnabled: false,
                userId: socket.data.identity.user.id,
                version: accounted.version,
              }].sort((left, right) => left.seatIndex - right.seatIndex),
            }));
            const accounted = await accounting.takeSeat(socket.data.identity.user.id, parsed.data, mutation);
            const committed = mutation.committedState();
            if (accounted.seatId !== null && !replay && committed) {
              applyRuntimeAuthority(runtime, committed);
              await broadcastRoom(parsed.data.roomId);
            }
            return accounted;
          });
          await controllerFor(parsed.data.roomId).evaluateStart();
          options.logger?.info({ roomId: parsed.data.roomId, seatIndex: result.seatIndex, userId: socket.data.identity.user.id }, "seat taken");
          acknowledge(safeSuccess(result, runtime.stateVersion));
        } catch (error: unknown) {
          const reportedError = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reportedError, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("stack:buy-in", (payload, acknowledge) => {
      void (async () => {
        const parsed = BuyInCommandSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const result = await runtime.queue.run(async () => {
            const replay = await requireFreshOperation(runtime, socket.data.identity.user.id, "TABLE_BUY_IN", parsed.data.operationId, parsed.data.expectedStateVersion);
            const participatingInHand = runtime.currentHand?.state.players.some(
              (player) => player.playerId === socket.data.identity.user.id,
            ) ?? false;
            const previous = captureRuntimeAuthority(runtime);
            const mutation = snapshotMutation(previous, (accounted: SeatAccountingResult) => advanceRuntimeAuthority(previous, {
              seats: previous.seats.map((seat) => seat.seatIndex === accounted.seatIndex
                ? {
                  ...seat,
                  nextActionAutoCallCurrentBet: accounted.playStatus === "ACTIVE" ? null : seat.nextActionAutoCallCurrentBet ?? null,
                  nextActionAutopilotArmed: accounted.playStatus === "ACTIVE" ? false : seat.nextActionAutopilotArmed ?? false,
                  playStatus: accounted.playStatus,
                  reservedAwayEndsAt: accounted.playStatus === "RESERVED_AWAY" ? seat.reservedAwayEndsAt ?? null : null,
                  stack: accounted.stack,
                  version: accounted.version,
                }
                : seat),
            }));
            const accounted = await accounting.buyIn(socket.data.identity.user.id, parsed.data, {
              ...mutation,
              handInProgress: participatingInHand,
            });
            const committed = mutation.committedState();
            if (!replay && committed) {
              applyRuntimeAuthority(runtime, committed);
              await broadcastRoom(parsed.data.roomId);
            }
            return accounted;
          });
          options.logger?.info({ amount: parsed.data.amount, roomId: parsed.data.roomId, userId: socket.data.identity.user.id }, "buy-in");
          acknowledge(safeSuccess(result, runtime.stateVersion));
        } catch (error: unknown) {
          const reportedError = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reportedError, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("seat:sit-out", (payload, acknowledge) => {
      void handleSeatOperation(socket, payload, acknowledge, "sit-out");
    });
    socket.on("seat:return", (payload, acknowledge) => {
      void handleSeatOperation(socket, payload, acknowledge, "return");
    });
    socket.on("seat:leave", (payload, acknowledge) => {
      void handleSeatOperation(socket, payload, acknowledge, "leave");
    });
    socket.on("table:start", (payload, acknowledge) => {
      void (async () => {
        const parsed = TableStartSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const userId = socket.data.identity.user.id;
          const committed = await runtime.queue.run(async () => {
            const connectedUserIds = new Set([...runtime.seats.values()].filter((seat) => runtime.isConnected(seat.userId)).map((seat) => seat.userId));
            return lifecycleCommands.startTable(captureRuntimeAuthority(runtime), userId, parsed.data, connectedUserIds, clock.now());
          });
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).evaluateStart();
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("hand:arm-next-action-autopilot", (payload, acknowledge) => {
      void (async () => {
        const parsed = NextActionAutopilotSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.armNextAction(captureRuntimeAuthority(runtime), socket.data.identity.user.id, parsed.data));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).refreshTimers();
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("hand:cancel-next-action-autopilot", (payload, acknowledge) => {
      void (async () => {
        const parsed = NextActionAutopilotCancelSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.cancelNextAction(captureRuntimeAuthority(runtime), socket.data.identity.user.id, parsed.data));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).refreshTimers();
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("seat:reserve-away", (payload, acknowledge) => {
      void (async () => {
        const parsed = ReserveAwaySchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.reserveAway(captureRuntimeAuthority(runtime), socket.data.identity.user.id, parsed.data, clock.now()));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === socket.data.identity.user.id);
          if (seat) syncReservedAwayTask(parsed.data.roomId, seat);
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).refreshTimers();
          await controllerFor(parsed.data.roomId).evaluateStart();
          acknowledge(safeSuccess(committed.data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("seat:set-trusteeship", (payload, acknowledge) => {
      void (async () => {
        const parsed = TrusteeshipSetSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.setTrusteeship(
            captureRuntimeAuthority(runtime),
            socket.data.identity.user.id,
            parsed.data,
          ));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).refreshTimers();
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("hand:reveal-own-cards", (payload, acknowledge) => {
      void (async () => {
        const parsed = RevealOwnCardsSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.revealOwnCards(captureRuntimeAuthority(runtime), socket.data.identity.user.id, parsed.data));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("hand:buy-time-extension", (payload, acknowledge) => {
      void (async () => {
        const parsed = BuyTimeExtensionSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const committed = await runtime.queue.run(() => lifecycleCommands.buyTimeExtension(
            captureRuntimeAuthority(runtime),
            socket.data.identity.user.id,
            parsed.data,
            clock.now(),
          ));
          if (committed.state) applyRuntimeAuthority(runtime, committed.state);
          else await controllerFor(parsed.data.roomId).resynchronizeAuthority();
          await broadcastRoom(parsed.data.roomId);
          await controllerFor(parsed.data.roomId).refreshTimers();
          const data = { ...committed.data, alreadyProcessed: committed.alreadyProcessed, stateVersion: committed.stateVersion };
          acknowledge(safeSuccess(data, committed.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("hand:choose-runout-count", (payload, acknowledge) => {
      void (async () => {
        const parsed = RunoutChoiceSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          const result = await controllerFor(parsed.data.roomId).submitRunoutChoice(socket.data.identity.user.id, parsed.data);
          await broadcastRoom(parsed.data.roomId);
          acknowledge(safeSuccess(result, result.stateVersion));
        } catch (error: unknown) {
          const reported = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
          acknowledge(commandError(reported, socket, parsed.data.roomId));
        }
      })();
    });
    socket.on("action:submit", (payload, acknowledge) => {
      void (async () => {
        const parsed = ActionSubmitSchema.safeParse(payload);
        if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
        const runtime = options.runtimes.get(parsed.data.roomId);
        try {
          if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
          if (runtime.status === "RECOVERY_ERROR") {
            const error = new Error("牌桌恢复失败，已暂停操作") as Error & { code: string };
            error.code = "RECOVERY_ERROR";
            throw error;
          }
          const result = await controllerFor(parsed.data.roomId).submitAction(socket.data.identity.user.id, parsed.data);
          if (result.alreadyProcessed) {
            options.logger?.info({
              handId: parsed.data.handId,
              requestId: parsed.data.clientActionId,
              roomId: parsed.data.roomId,
              stateVersion: result.stateVersion,
              userId: socket.data.identity.user.id,
            }, "action receipt replayed");
          }
          options.logger?.info({ actionType: parsed.data.action.type, handId: parsed.data.handId, roomId: parsed.data.roomId, stateVersion: result.stateVersion, userId: socket.data.identity.user.id }, "player action");
          acknowledge(safeSuccess(result, result.stateVersion));
        } catch (error: unknown) { acknowledge(commandError(error, socket, parsed.data.roomId)); }
      })();
    });
    socket.on("disconnect", (disconnectReason) => {
      socket.data.sessionExpiryTask?.cancel();
      const remaining = sessionSockets.get(socket.data.identity.sessionId);
      remaining?.delete(socket.id);
      if (remaining?.size === 0) sessionSockets.delete(socket.data.identity.sessionId);
      const userRemaining = userSockets.get(socket.data.identity.user.id);
      userRemaining?.delete(socket.id);
      if (userRemaining?.size === 0) userSockets.delete(socket.data.identity.user.id);
      for (const roomId of socket.data.subscribedRooms) {
        const runtime = options.runtimes.get(roomId);
        if (runtime) {
          if (shuttingDown) {
            const presenceVersionBefore = runtime.presenceVersion;
            const userConnectedBefore = runtime.isConnected(socket.data.identity.user.id);
            runtime.removePresence(socket.data.identity.user.id, socket.id);
            queueConnectionProbe({
              eventName: "SOCKET_DISCONNECTED",
              payload: {
                connectionId: socket.id,
                disconnectReason,
                presenceVersionAfter: runtime.presenceVersion,
                presenceVersionBefore,
                serverShuttingDown: true,
                userConnectedAfter: runtime.isConnected(socket.data.identity.user.id),
                userConnectedBefore,
                userId: socket.data.identity.user.id,
              },
              roomId,
              stateVersion: runtime.stateVersion,
            });
            continue;
          }
          // Capture the existing controller before yielding. Concurrent disconnect
          // cleanup may evict this now-empty runtime; a captured disposed controller
          // safely no-ops, whereas looking it up again would race with that eviction.
          const controller = controllerFor(roomId);
          void (async () => {
            await runtime.queue.run(() => {
              const presenceVersionBefore = runtime.presenceVersion;
              const userConnectedBefore = runtime.isConnected(socket.data.identity.user.id);
              runtime.removePresence(socket.data.identity.user.id, socket.id);
              queueConnectionProbe({
                eventName: "SOCKET_DISCONNECTED",
                payload: {
                  connectionId: socket.id,
                  disconnectReason,
                  presenceVersionAfter: runtime.presenceVersion,
                  presenceVersionBefore,
                  serverShuttingDown: false,
                  userConnectedAfter: runtime.isConnected(socket.data.identity.user.id),
                  userConnectedBefore,
                  userId: socket.data.identity.user.id,
                },
                roomId,
                stateVersion: runtime.stateVersion,
              });
            });
            await controller.refreshTimers();
            await broadcastRoom(roomId);
            await controller.evaluateStart();
            cleanupEligibleRuntimes();
          })().catch(() => {
            options.logger?.error({ roomId, userId: socket.data.identity.user.id }, "socket disconnect cleanup failed");
          });
        }
      }
      options.logger?.info({ userId: socket.data.identity.user.id }, "socket disconnected");
    });
  });

  const sessionControl: RealtimeSessionControl = {
    async disconnectSession(sessionId) {
      for (const socketId of sessionSockets.get(sessionId) ?? []) {
        const target = io.sockets.sockets.get(socketId);
        if (target) {
          target.emit("table:error", realtimeError("SOCKET_AUTH_REQUIRED", "登录状态已失效，请重新登录"));
          target.disconnect(true);
        }
      }
    },
  };
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const controller of controllers.values()) controller.dispose();
    for (const task of reservedAwayTasks.values()) task.cancel();
    await options.runtimes.whenIdle();
    controllers.clear();
    pendingBroadcastStage.clear();
    reservedAwayTasks.clear();
    sessionSockets.clear();
    userSockets.clear();
    connectionAttemptsByIp.clear();
    connectionAttemptsByUser.clear();
    commandsByUser.clear();
    chatMessagesByUser.clear();
    seatCommandsByUser.clear();
    roomChat.clear();
    await io.close();
    await Promise.allSettled([...pendingDiagnosticWrites]);
    pendingDiagnosticWrites.clear();
    await diagnosticLog.flush();
    options.runtimes.close();
  }
  const realtime = Object.assign(io, { recoverRoom, recoverTables, sessionControl, shutdown });

  async function handleSeatOperation(
    socket: TableSocket,
    payload: unknown,
    acknowledge: (result: CommandAcknowledgement<SeatOperationResult>) => void,
    action: "sit-out" | "return" | "leave",
  ): Promise<void> {
    const parsed = (action === "leave" ? SeatLeaveSchema : SeatOperationSchema).safeParse(payload);
    if (!parsed.success) { acknowledge(safeError("INVALID_REQUEST", "请求格式无效")); return; }
    const runtime = options.runtimes.get(parsed.data.roomId);
    try {
      if (!runtime) throw new Error("TABLE_NOT_AVAILABLE");
      const userId = socket.data.identity.user.id;
      const operationNow = clock.now();
      const leavePayload = parsed.data as typeof parsed.data & { readonly confirmSquidPenalty?: boolean };
      const confirmSquidPenalty = action === "leave" && leavePayload.confirmSquidPenalty === true;
      const scope = action === "sit-out" ? "TABLE_SIT_OUT" : action === "return" ? "TABLE_RETURN" : "TABLE_LEAVE";
      const result = await runtime.queue.run(async () => {
        const replay = await requireFreshOperation(runtime, userId, scope, parsed.data.operationId, parsed.data.expectedStateVersion);
        const handPlayer = runtime.currentHand?.state.players.find((player) => player.playerId === userId);
        const previous = captureRuntimeAuthority(runtime);
        const actorSeat = previous.seats.find((seat) => seat.userId === userId);
        const graceActive = previous.room.squidRoundGraceEndsAt !== null
          && previous.room.squidRoundGraceEndsAt !== undefined
          && operationNow.getTime() < previous.room.squidRoundGraceEndsAt.getTime();
        const squidLeaveMustWaitForHand = action === "leave"
          && runtime.currentHand !== null
          && previous.room.specialMode === "SQUID"
          && previous.room.tableStartedAt !== null
          && previous.room.tableStartedAt !== undefined
          && !graceActive
          && actorSeat?.squidRoundParticipant === true;
        const seatCandidate = (accounted: SeatAccountingResult) => advanceRuntimeAuthority(previous, {
          seats: previous.seats.map((seat) => seat.seatIndex === accounted.seatIndex
            ? {
              ...seat,
              nextActionAutoCallCurrentBet: null,
              nextActionAutopilotArmed: false,
              playStatus: accounted.playStatus,
              reservedAwayEndsAt: accounted.playStatus === "RESERVED_AWAY" ? seat.reservedAwayEndsAt ?? null : null,
              stack: accounted.stack,
              version: accounted.version,
            }
            : seat),
        });
        const leaveCandidate = (accounted: LeaveAccountingResult) => {
          const squidPenaltyApplies = previous.room.specialMode === "SQUID"
            && previous.room.tableStartedAt !== null
            && previous.room.tableStartedAt !== undefined
            && !graceActive
            && actorSeat?.squidRoundParticipant === true;
          let room = previous.room;
          let seats = accounted.seatId === null
            ? previous.seats.filter((seat) => seat.seatIndex !== accounted.seatIndex)
            : previous.seats.map((seat) => seat.seatIndex === accounted.seatIndex && accounted.playStatus !== null
              ? { ...seat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: accounted.playStatus === "LEAVE_AFTER_HAND", playStatus: accounted.playStatus, stack: accounted.stack, version: accounted.version }
              : seat);
          if (squidPenaltyApplies && actorSeat && squidLeaveMustWaitForHand) {
            if (actorSeat.squidMarked) {
              seats = seats.map((seat) => seat.userId === userId ? { ...seat, squidMarked: false, squidRoundParticipant: false } : seat);
            } else {
              seats = seats.map((seat) => seat.userId !== userId && seat.squidRoundParticipant && !seat.squidMarked
                ? { ...seat, squidMarked: true, version: seat.version + 1 }
                : seat);
              room = { ...room, squidSettlementPending: true };
            }
          } else if (squidPenaltyApplies && actorSeat && !squidLeaveMustWaitForHand && !actorSeat.squidMarked) {
            const recipients = previous.seats.filter((seat) => seat.userId !== userId && seat.squidRoundParticipant);
            if (recipients.length > 0) {
              const stake = previous.room.squidStake ?? 0;
              const recipientIds = new Set(recipients.map((seat) => seat.userId));
              seats = seats.map((seat) => ({
                ...seat,
                squidMarked: false,
                squidRoundParticipant: true,
                stack: seat.stack + (recipientIds.has(seat.userId) ? stake : 0),
                version: seat.version + 1,
              }));
              room = {
                ...room,
                squidRoundGraceEndsAt: new Date(operationNow.getTime() + 10_000),
                squidRoundNumber: (room.squidRoundNumber ?? 1) + 1,
                squidSettlementPending: false,
              };
            }
          }
          return advanceRuntimeAuthority(previous, { room, seats });
        };
        const mutation = action === "leave"
          ? snapshotMutation(previous, leaveCandidate)
          : snapshotMutation(previous, seatCandidate);
        const accounted = action === "sit-out"
          ? await accounting.setSitOut(userId, parsed.data, { ...mutation as AccountingMutationHooks<SeatAccountingResult>, participatingInHand: handPlayer !== undefined })
          : action === "return"
            ? await accounting.returnToPlay(userId, parsed.data, { ...mutation as AccountingMutationHooks<SeatAccountingResult>, handInProgress: runtime.currentHand !== null, now: clock.now() })
            : await accounting.requestLeave(userId, {
              expectedStateVersion: parsed.data.expectedStateVersion,
              operationId: parsed.data.operationId,
              roomId: parsed.data.roomId,
            }, {
              ...mutation as AccountingMutationHooks<LeaveAccountingResult>,
              confirmSquidPenalty,
              now: operationNow,
              participatingInHand: handPlayer !== undefined || squidLeaveMustWaitForHand,
            });
        const committed = mutation.committedState();
        if (!replay && committed) {
          applyRuntimeAuthority(runtime, committed);
          await broadcastRoom(parsed.data.roomId);
        }
        return accounted;
      });
      const latestSeat = [...runtime.seats.values()].find((seat) => seat.userId === userId);
      if (latestSeat) syncReservedAwayTask(parsed.data.roomId, latestSeat);
      await controllerFor(parsed.data.roomId).refreshTimers();
      await controllerFor(parsed.data.roomId).evaluateStart();
      const deferredLeave = action === "leave" && "deferred" in result && result.deferred;
      options.logger?.info({ roomId: parsed.data.roomId, userId, ...(deferredLeave ? { deferred: true } : {}) }, action === "sit-out" ? "sit-out" : action === "return" ? "return" : deferredLeave ? "leave-after-hand" : "seat-closed");
      acknowledge(safeSuccess(result, runtime.stateVersion));
    } catch (error: unknown) {
      const reportedError = await reportedErrorAfterSnapshotConflict(parsed.data.roomId, error);
      acknowledge(commandError(reportedError, socket, parsed.data.roomId));
    }
  }

  return realtime;
}
