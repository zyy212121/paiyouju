import { createHash } from "node:crypto";
import { PROTOCOL_VERSION, tableDiamondFees } from "@paiyouju/shared";

import { MAX_POINTS } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { applyWalletMutationInTransaction } from "../wallet/wallet.service.js";
import { deleteRoomDataInTransaction } from "../../operations/room-data-deletion.js";
import { deleteAdministratorRoomLog } from "../tables/room-file-diagnostic-log.js";
import {
  SnapshotValidationError,
  validateTableSnapshot,
  type SnapshotRecord,
} from "../tables/snapshot/snapshot-codec.js";
import { TableSnapshotPayloadSchema } from "../tables/snapshot/snapshot-schema.js";
import { sanitizeAuditMetadata } from "./admin-audit.js";
import type {
  AdminDestructiveActionInput,
  AdminListQuery,
  AdminRoomActionInput,
  AdminTestBotLeaseClaimInput,
  AdminTestBotLeaseInput,
  AdminWalletAdjustmentInput,
} from "./admin.schemas.js";

export interface AdminRequestContext {
  readonly actorUserId: string;
  readonly ipAddressSummary: string | null;
  readonly requestId: string;
  readonly userAgentSummary: string | null;
}

export interface AdminServiceOptions {
  readonly activeSockets?: () => number;
  readonly applicationVersion?: string;
  readonly clock?: () => Date;
  readonly eventLoopDelay?: () => {
    readonly maximumMs: number;
    readonly meanMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
  };
  readonly runtimeSummary?: () => {
    readonly actionCacheSize: number;
    readonly activeRuntimes: number;
    readonly activeRuntimeTimers: number;
    readonly degradedRooms: number;
    readonly recoveryComplete: boolean;
  };
  readonly roomLifecycleAction?: (
    roomId: string,
    action: "CLOSE" | "PAUSE" | "RESUME",
  ) => Promise<unknown>;
  readonly retryRecovery?: (roomId: string) => Promise<unknown>;
  readonly removeClosedRuntime?: (roomId: string) => boolean | Promise<boolean>;
}

const TEST_BOT_LEASE_DURATION_MS = 3 * 60_000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function requestHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function maskPhone(phoneNumber: string | null): string | null {
  return phoneNumber === null
    ? null
    : `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-4)}`;
}

function handIdFromLedgerMetadata(metadata: Prisma.JsonValue | null): string | null {
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") return null;
  const handId = (metadata as Record<string, Prisma.JsonValue>).handId;
  return typeof handId === "string" && handId.length > 0 && handId.length <= 128 ? handId : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "P2002";
}

interface AdjustmentResponse {
  readonly balanceAfter: number;
  readonly balanceBefore: number;
  readonly ledgerEntryId: string;
  readonly operationId: string;
  readonly replayed: boolean;
  readonly signedAmount: number;
  readonly targetUserId: string;
}

function parseStoredAdjustment(value: Prisma.JsonValue | null): AdjustmentResponse | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.balanceAfter !== "number"
    || typeof candidate.balanceBefore !== "number"
    || typeof candidate.ledgerEntryId !== "string"
    || typeof candidate.operationId !== "string"
    || typeof candidate.signedAmount !== "number"
    || typeof candidate.targetUserId !== "string"
  ) return null;
  return {
    balanceAfter: candidate.balanceAfter,
    balanceBefore: candidate.balanceBefore,
    ledgerEntryId: candidate.ledgerEntryId,
    operationId: candidate.operationId,
    replayed: true,
    signedAmount: candidate.signedAmount,
    targetUserId: candidate.targetUserId,
  };
}

export function createAdminService(
  database: DatabaseClient,
  options: AdminServiceOptions = {},
) {
  const clock = options.clock ?? (() => new Date());

  async function validateRecoverySnapshot(roomId: string) {
    const snapshot = await database.tableSnapshot.findUnique({
      include: {
        room: {
          include: {
            tableSeats: {
              include: { user: { select: { nickname: true } } },
              orderBy: { seatIndex: "asc" },
            },
          },
        },
      },
      where: { roomId },
    });
    if (!snapshot) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
    try {
      const parsedPayload = TableSnapshotPayloadSchema.safeParse(snapshot.payload);
      if (!parsedPayload.success) {
        throw new SnapshotValidationError(
          "牌桌快照验证失败",
          `payload-schema:${parsedPayload.error.issues[0]?.path.join(".") || "root"}`,
        );
      }
      for (const seat of snapshot.room.tableSeats) {
        if (seat.pendingShowCardIndices.some((index) => index !== 0 && index !== 1)) {
          throw new SnapshotValidationError("牌桌快照验证失败", "seat-pending-show-index");
        }
      }
      validateTableSnapshot(
        {
          ...snapshot,
          runtimeStatus: snapshot.runtimeStatus === "RECOVERY_ERROR"
            ? parsedPayload.data.status
            : snapshot.runtimeStatus,
        } as unknown as SnapshotRecord,
        {
          room: {
            actionTimeSeconds: snapshot.room.actionTimeSeconds,
            bigBlind: snapshot.room.bigBlind,
            durationMinutes: snapshot.room.durationMinutes,
            expiresAt: snapshot.room.expiresAt,
            maximumBuyIn: snapshot.room.maximumBuyIn,
            maxSeats: snapshot.room.maxSeats,
            minimumBuyIn: snapshot.room.minimumBuyIn,
            name: snapshot.room.name,
            nextHandPaused: snapshot.room.nextHandPaused,
            ownerId: snapshot.room.ownerId,
            paidCardRevealCost: snapshot.room.paidCardRevealCost,
            paidCardRevealEnabled: snapshot.room.paidCardRevealEnabled,
            requiresManualStart: snapshot.room.requiresManualStart,
            roomCode: snapshot.room.roomCode,
            roomId: snapshot.room.id,
            smallBlind: snapshot.room.smallBlind,
            status: snapshot.room.status,
            tableStartedAt: snapshot.room.tableStartedAt,
          },
          seats: snapshot.room.tableSeats.map((seat) => ({
            gameSessionId: seat.gameSessionId,
            nickname: seat.user.nickname,
            nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet,
            nextActionAutopilotArmed: seat.nextActionAutopilotArmed,
            pendingShowCardIndices: seat.pendingShowCardIndices as Array<0 | 1>,
            playStatus: seat.playStatus,
            reservedAwayEndsAt: seat.reservedAwayEndsAt,
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            stack: seat.stack,
            userId: seat.userId,
            version: seat.version,
          })),
        },
      );
      return { runtimeStatus: parsedPayload.data.status, safeErrorCode: null, valid: true as const };
    } catch (error: unknown) {
      const safeErrorCode = error instanceof SnapshotValidationError
        ? error.reason.slice(0, 200)
        : "recovery-validation-failed";
      return { runtimeStatus: "RECOVERY_ERROR" as const, safeErrorCode, valid: false as const };
    }
  }

  async function recordRecoveryAudit(
    roomId: string,
    action: "REVALIDATE" | "RETRY",
    input: AdminRoomActionInput,
    context: AdminRequestContext,
    result: Readonly<Record<string, unknown>>,
  ) {
    await database.auditLog.create({
      data: {
        action: `ADMIN_RECOVERY_${action}`,
        actorRole: "ADMIN",
        actorUserId: context.actorUserId,
        ipAddressSummary: context.ipAddressSummary,
        metadata: sanitizeAuditMetadata(result),
        operationId: input.operationId,
        reason: input.reason,
        requestId: context.requestId,
        roomId,
        targetId: roomId,
        targetType: "TABLE_SNAPSHOT",
        userAgentSummary: context.userAgentSummary,
      },
    });
  }

  async function findReplay(
    actorUserId: string,
    operationId: string,
    fingerprint: string,
  ): Promise<AdjustmentResponse | null> {
    const receipt = await database.requestIdempotency.findUnique({
      where: {
        scope_actorId_key: {
          actorId: actorUserId,
          key: operationId,
          scope: "ADMIN_WALLET_ADJUSTMENT",
        },
      },
    });
    if (!receipt) return null;
    if (receipt.requestHash !== fingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
    }
    const replay = parseStoredAdjustment(receipt.response);
    if (!replay) {
      throw new ApiError(409, "IDEMPOTENCY_RESULT_UNAVAILABLE", "幂等结果不可用");
    }
    return replay;
  }

  return {
    async dashboard() {
      const now = clock();
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      const [
        usersTotal,
        activeUserRows,
        onlineUserRows,
        openRooms,
        closingRooms,
        closedRooms,
        archivedRooms,
        activeTableRows,
        handsInProgress,
        postHandReview,
        reservedAway,
        bustedWaitingRebuy,
        recoveryErrorRooms,
        handsCompleted24h,
        paidReveals24h,
        hypotheticalRunouts24h,
        actionExtensions24h,
        walletAggregate,
        tableStackAggregate,
        migrationRows,
      ] = await Promise.all([
        database.user.count(),
        database.userSession.groupBy({
          by: ["userId"],
          where: { OR: [{ createdAt: { gte: since } }, { lastSeenAt: { gte: since } }] },
        }),
        database.userSession.groupBy({
          by: ["userId"],
          where: { expiresAt: { gt: now }, revokedAt: null },
        }),
        database.room.count({ where: { status: "OPEN" } }),
        database.room.count({ where: { status: "CLOSING" } }),
        database.room.count({ where: { status: "CLOSED" } }),
        database.room.count({ where: { archivedAt: { not: null } } }),
        database.tableSeat.groupBy({ by: ["roomId"] }),
        database.tableSnapshot.count({ where: { activeHandId: { not: null } } }),
        database.tableSnapshot.count({ where: { runtimeStatus: "POST_HAND_REVIEW" } }),
        database.tableSeat.count({ where: { playStatus: "RESERVED_AWAY" } }),
        database.tableSeat.count({ where: { playStatus: "BUSTED_WAITING_REBUY" } }),
        database.tableSnapshot.count({ where: { recoveryStatus: "ERROR" } }),
        database.handRecord.count({ where: { finishedAt: { gte: since } } }),
        database.paidHandRevealPurchase.count({ where: { createdAt: { gte: since } } }),
        database.hypotheticalRunoutPurchase.count({ where: { createdAt: { gte: since } } }),
        database.walletLedgerEntry.count({
          where: { createdAt: { gte: since }, type: "ACTION_TIME_EXTENSION" },
        }),
        database.wallet.aggregate({ _sum: { balance: true } }),
        database.tableSeat.aggregate({ _sum: { stack: true } }),
        database.$queryRaw<Array<{ readonly count: bigint }>>`
          SELECT COUNT(*)::BIGINT AS count
          FROM "_prisma_migrations"
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        `,
      ]);
      const runtime = options.runtimeSummary?.() ?? {
        actionCacheSize: 0,
        activeRuntimes: activeTableRows.length,
        activeRuntimeTimers: 0,
        degradedRooms: recoveryErrorRooms,
        recoveryComplete: true,
      };
      return {
        actionExtensions24h,
        actionCacheSize: runtime.actionCacheSize,
        activeRuntimes: runtime.activeRuntimes,
        activeRuntimeTimers: runtime.activeRuntimeTimers,
        activeSockets: options.activeSockets?.() ?? 0,
        activeTables: activeTableRows.length,
        activeUsers24h: activeUserRows.length,
        applicationVersion: options.applicationVersion ?? "0.0.0",
        archivedRooms,
        bustedWaitingRebuy,
        closedRooms,
        closingRooms,
        databaseStatus: "ready" as const,
        degradedRooms: runtime.degradedRooms,
        handsCompleted24h,
        handsInProgress,
        hypotheticalRunouts24h,
        migrationCount: Number(migrationRows[0]?.count ?? 0n),
        migrationStatus: "ready" as const,
        onlineUsers: onlineUserRows.length,
        openRooms,
        paidReveals24h,
        postHandReview,
        recoveryComplete: runtime.recoveryComplete,
        recoveryErrorRooms,
        reservedAway,
        tableStackTotal: tableStackAggregate._sum.stack ?? 0,
        uptimeSeconds: Math.floor(process.uptime()),
        usersTotal,
        walletTotalBalance: walletAggregate._sum.balance ?? 0,
      };
    },

    async listUsers(query: AdminListQuery) {
      const cursor = query.cursor;
      const search = query.search;
      const users = await database.user.findMany({
        include: {
          _count: { select: { handPlayerRecords: true } },
          tableSeats: {
            include: { room: { select: { id: true, name: true, roomCode: true } } },
            take: 1,
          },
          wallet: { select: { balance: true } },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(cursor === undefined ? {} : { id: { gt: cursor } }),
          ...(search === undefined
            ? {}
            : {
                OR: [
                  { id: search },
                  { nickname: { contains: search, mode: "insensitive" } },
                  { username: { contains: search, mode: "insensitive" } },
                  ...(/^\d{11}$/u.test(search)
                    ? [{ phoneNumber: search }]
                    : /^\d{4}$/u.test(search)
                      ? [{ phoneNumber: { endsWith: search } }]
                      : []),
                ],
              }),
        },
      });
      const hasMore = users.length > query.limit;
      const page = users.slice(0, query.limit);
      return {
        items: page.map((user) => {
          const seat = user.tableSeats[0];
          return {
            createdAt: user.createdAt,
            currentRoom: seat?.room ?? null,
            currentSeat: seat?.seatIndex ?? null,
            handsPlayed: user._count.handPlayerRecords,
            id: user.id,
            lastActive: user.updatedAt,
            nickname: user.nickname,
            phoneMasked: maskPhone(user.phoneNumber),
            isTestBot: user.isTestBot,
            testBotOrdinal: user.testBotOrdinal,
            role: user.role,
            username: user.username,
            walletBalance: user.wallet?.balance ?? 0,
          };
        }),
        nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
      };
    },

    async getUser(userId: string) {
      const user = await database.user.findUnique({
        include: {
          gameSessions: {
            orderBy: { startedAt: "desc" },
            select: {
              endedAt: true,
              id: true,
              roomId: true,
              seatIndex: true,
              startedAt: true,
              status: true,
              totalBuyIn: true,
              totalCashOut: true,
            },
            take: 25,
          },
          handPlayerRecords: {
            orderBy: { createdAt: "desc" },
            select: {
              committed: true,
              createdAt: true,
              endingStack: true,
              folded: true,
              handId: true,
              netResult: true,
              roomId: true,
              startingStack: true,
            },
            take: 25,
          },
          hypotheticalRunoutPurchases: {
            orderBy: { createdAt: "desc" },
            select: { cost: true, createdAt: true, handId: true, id: true, roomId: true },
            take: 25,
          },
          paidHandRevealPurchases: {
            orderBy: { createdAt: "desc" },
            select: { cost: true, createdAt: true, handId: true, id: true, roomId: true },
            take: 25,
          },
          sessions: {
            select: { expiresAt: true, revokedAt: true },
          },
          tableSeats: {
            include: { room: { select: { id: true, name: true, roomCode: true } } },
            take: 1,
          },
          wallet: {
            include: {
              entries: {
                orderBy: { sequence: "desc" },
                select: {
                  balanceAfter: true,
                  balanceBefore: true,
                  createdAt: true,
                  id: true,
                  relatedGameSessionId: true,
                  relatedHandId: true,
                  relatedRoomId: true,
                  sequence: true,
                  signedAmount: true,
                  type: true,
                },
                take: 25,
              },
            },
          },
        },
        where: { id: userId },
      });
      if (!user) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
      const now = clock();
      const seat = user.tableSeats[0];
      return {
        activeSessionCount: user.sessions.filter(
          (session) => session.revokedAt === null && session.expiresAt > now,
        ).length,
        createdAt: user.createdAt,
        currentRoom: seat?.room ?? null,
        currentSeat: seat?.seatIndex ?? null,
        gameSessions: user.gameSessions,
        handHistory: user.handPlayerRecords,
        hypotheticalRunoutPurchases: user.hypotheticalRunoutPurchases,
        id: user.id,
        nickname: user.nickname,
        paidHandRevealPurchases: user.paidHandRevealPurchases,
        phoneMasked: maskPhone(user.phoneNumber),
        isTestBot: user.isTestBot,
        testBotLeaseExpiresAt: user.testBotLeaseExpiresAt,
        testBotOrdinal: user.testBotOrdinal,
        role: user.role,
        updatedAt: user.updatedAt,
        username: user.username,
        wallet: user.wallet === null
          ? null
          : {
              balance: user.wallet.balance,
              entries: user.wallet.entries,
              updatedAt: user.wallet.updatedAt,
              version: user.wallet.version,
            },
      };
    },

    async listRooms(query: AdminListQuery) {
      const rooms = await database.room.findMany({
        include: {
          _count: { select: { members: true, tableSeats: true } },
          owner: { select: { id: true, nickname: true, role: true, username: true } },
          snapshot: {
            select: {
              activeHandId: true,
              activeHandNumber: true,
              lastRecoveryError: true,
              recoveryStatus: true,
              runtimeStatus: true,
              snapshotRevision: true,
              stateVersion: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : {
                OR: [
                  { id: query.search },
                  { roomCode: query.search },
                  { name: { contains: query.search, mode: "insensitive" } },
                ],
              }),
        },
      });
      const page = rooms.slice(0, query.limit);
      const now = clock();
      return {
        items: page.map((room) => ({
          actionTimeSeconds: room.actionTimeSeconds,
          archived: room.archivedAt !== null,
          archivedAt: room.archivedAt,
          bigBlind: room.bigBlind,
          closeRequestedAt: room.closeRequestedAt,
          createdAt: room.createdAt,
          currentHandId: room.snapshot?.activeHandId ?? null,
          currentHandNumber: room.snapshot?.activeHandNumber ?? null,
          durationMinutes: room.durationMinutes,
          expiredPendingCurrentHand:
            room.expiresAt <= now && room.snapshot?.activeHandId !== null,
          expiresAt: room.expiresAt,
          id: room.id,
          maxSeats: room.maxSeats,
          memberCount: room._count.members,
          name: room.name,
          nextHandPaused: room.nextHandPaused,
          owner: room.owner,
          recoveryStatus: room.snapshot?.recoveryStatus ?? "READY",
          remainingSeconds: Math.max(0, Math.ceil((room.expiresAt.getTime() - now.getTime()) / 1_000)),
          roomCode: room.roomCode,
          runtimeStatus: room.snapshot?.runtimeStatus ?? (room.status === "CLOSED" ? "CLOSED" : "IDLE"),
          seatCount: room._count.tableSeats,
          smallBlind: room.smallBlind,
          snapshotRevision: room.snapshot?.snapshotRevision ?? 0,
          stateVersion: room.snapshot?.stateVersion ?? 0,
          status: room.status,
          updatedAt: room.snapshot?.updatedAt ?? room.updatedAt,
        })),
        nextCursor: rooms.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async getRoom(roomId: string) {
      const result = await this.listRooms({ limit: 2, search: roomId });
      const room = result.items.find((candidate) => candidate.id === roomId);
      if (!room) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
      return room;
    },

    async listTables(query: AdminListQuery) {
      const snapshots = await database.tableSnapshot.findMany({
        include: {
          room: {
            include: {
              tableSeats: {
                orderBy: { seatIndex: "asc" },
                select: {
                  playStatus: true,
                  seatIndex: true,
                  user: { select: { id: true, nickname: true, username: true } },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : { OR: [{ roomId: query.search }, { activeHandId: query.search }] }),
        },
      });
      const page = snapshots.slice(0, query.limit);
      return {
        items: page.map((snapshot) => ({
          actionDeadline: snapshot.turnDeadlineAt,
          activePlayers: snapshot.room.tableSeats.filter((seat) => seat.playStatus === "ACTIVE").length,
          bustedWaitingRebuy: snapshot.room.tableSeats.filter((seat) => seat.playStatus === "BUSTED_WAITING_REBUY").length,
          currentActor: null,
          currentStreet: null,
          handId: snapshot.activeHandId,
          handNumber: snapshot.activeHandNumber,
          postHandReview: snapshot.runtimeStatus === "POST_HAND_REVIEW",
          reservedAway: snapshot.room.tableSeats.filter((seat) => seat.playStatus === "RESERVED_AWAY").length,
          room: { id: snapshot.room.id, name: snapshot.room.name, roomCode: snapshot.room.roomCode },
          roomExpiresAt: snapshot.room.expiresAt,
          runtimeStatus: snapshot.runtimeStatus,
          seatCount: snapshot.room.tableSeats.length,
          seats: snapshot.room.tableSeats,
          snapshotRevision: snapshot.snapshotRevision,
          stateVersion: snapshot.stateVersion,
        })),
        nextCursor: snapshots.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async listGames(query: AdminListQuery) {
      const games = await database.gameSession.findMany({
        include: {
          room: { select: { id: true, name: true, roomCode: true } },
          user: { select: { id: true, nickname: true, username: true } },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : { OR: [{ id: query.search }, { roomId: query.search }, { userId: query.search }] }),
        },
      });
      const page = games.slice(0, query.limit);
      return {
        items: page.map((game) => ({
          endedAt: game.endedAt,
          id: game.id,
          room: game.room,
          seatIndex: game.seatIndex,
          startedAt: game.startedAt,
          status: game.status,
          totalBuyIn: game.totalBuyIn,
          totalCashOut: game.totalCashOut,
          user: game.user,
        })),
        nextCursor: games.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async getGame(gameSessionId: string) {
      const game = await database.gameSession.findUnique({
        include: {
          handPlayerRecords: {
            orderBy: { createdAt: "desc" },
            select: {
              committed: true,
              endingStack: true,
              folded: true,
              handId: true,
              netResult: true,
              startingStack: true,
            },
            take: 100,
          },
          room: { select: { id: true, name: true, roomCode: true } },
          tableStackEntries: {
            orderBy: { sequence: "desc" },
            select: {
              createdAt: true,
              handId: true,
              id: true,
              sequence: true,
              signedAmount: true,
              stackAfter: true,
              stackBefore: true,
              type: true,
            },
            take: 100,
          },
          user: { select: { id: true, nickname: true, username: true } },
        },
        where: { id: gameSessionId },
      });
      if (!game) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
      return game;
    },

    async listHands(query: AdminListQuery) {
      const hands = await database.handRecord.findMany({
        include: {
          _count: { select: { actions: true, players: true, pots: true } },
          room: { select: { id: true, name: true, roomCode: true } },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : { OR: [{ id: query.search }, { roomId: query.search }] }),
        },
      });
      const page = hands.slice(0, query.limit);
      return {
        items: page.map((hand) => ({
          actionCount: hand._count.actions,
          bigBlindAmount: hand.bigBlindAmount,
          board: hand.board,
          finishReason: hand.finishReason,
          finishedAt: hand.finishedAt,
          handNumber: hand.handNumber,
          id: hand.id,
          playerCount: hand._count.players,
          potCount: hand._count.pots,
          room: hand.room,
          startedAt: hand.startedAt,
        })),
        nextCursor: hands.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async getHand(handId: string, context: AdminRequestContext) {
      const hand = await database.handRecord.findUnique({
        include: {
          actions: { orderBy: { sequence: "asc" } },
          hypotheticalRunout: true,
          players: {
            include: { user: { select: { id: true, nickname: true, username: true } } },
            orderBy: { seatIndex: "asc" },
          },
          pots: { orderBy: { potIndex: "asc" } },
          room: { select: { id: true, name: true, roomCode: true } },
        },
        where: { id: handId },
      });
      if (!hand) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
      await database.auditLog.create({
        data: {
          action: "ADMIN_VIEW_FULL_HAND",
          actorRole: "ADMIN",
          actorUserId: context.actorUserId,
          handId: hand.id,
          ipAddressSummary: context.ipAddressSummary,
          metadata: sanitizeAuditMetadata({ finishReason: hand.finishReason, handNumber: hand.handNumber }),
          requestId: context.requestId,
          roomId: hand.roomId,
          targetId: hand.id,
          targetType: "COMPLETED_HAND",
          userAgentSummary: context.userAgentSummary,
        },
      });
      return {
        actions: hand.actions,
        bigBlindAmount: hand.bigBlindAmount,
        board: hand.board,
        finishReason: hand.finishReason,
        finishedAt: hand.finishedAt,
        fullBoard: hand.fullBoard,
        handNumber: hand.handNumber,
        hypotheticalRunout: hand.hypotheticalRunout,
        id: hand.id,
        players: hand.players.map((player) => ({
          allIn: player.allIn,
          committed: player.committed,
          endingStack: player.endingStack,
          folded: player.folded,
          holeCards: player.holeCards,
          holeCardsPublic: player.holeCardsPublic,
          holeCardsPublicReason: player.holeCardsPublicReason,
          netResult: player.netResult,
          pendingShowSelectedAt: player.voluntarilyRevealedAt,
          seatIndex: player.seatIndex,
          startingStack: player.startingStack,
          user: player.user,
          voluntarilyRevealedCardIndices: player.voluntarilyRevealedCardIndices,
        })),
        pots: hand.pots,
        reviewEndsAt: hand.reviewEndsAt,
        room: hand.room,
        startedAt: hand.startedAt,
      };
    },

    async listWalletLedger(query: AdminListQuery) {
      const entries = await database.walletLedgerEntry.findMany({
        include: { user: { select: { id: true, nickname: true, username: true } } },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : { OR: [{ id: query.search }, { userId: query.search }, { relatedRoomId: query.search }, { relatedHandId: query.search }] }),
        },
      });
      const page = entries.slice(0, query.limit);
      return {
        items: page.map((entry) => ({
          balanceAfter: entry.balanceAfter,
          balanceBefore: entry.balanceBefore,
          createdAt: entry.createdAt,
          id: entry.id,
          relatedGameSessionId: entry.relatedGameSessionId,
          relatedHandId: entry.relatedHandId,
          relatedRoomId: entry.relatedRoomId,
          sequence: entry.sequence,
          signedAmount: entry.signedAmount,
          type: entry.type,
          user: entry.user,
        })),
        nextCursor: entries.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async listPointActions(query: AdminListQuery) {
      const [reveals, runouts, extensions, entryFees] = await Promise.all([
        database.paidHandRevealPurchase.findMany({
          include: { hand: true, buyer: { select: { id: true, nickname: true, username: true } }, walletLedgerEntry: true },
          orderBy: { createdAt: "desc" },
          take: query.limit,
        }),
        database.hypotheticalRunoutPurchase.findMany({
          include: { hand: true, buyer: { select: { id: true, nickname: true, username: true } }, walletLedgerEntry: true },
          orderBy: { createdAt: "desc" },
          take: query.limit,
        }),
        database.walletLedgerEntry.findMany({
          include: { relatedHand: true, user: { select: { id: true, nickname: true, username: true } } },
          orderBy: { createdAt: "desc" },
          take: query.limit,
          where: { type: "ACTION_TIME_EXTENSION" },
        }),
        database.walletLedgerEntry.findMany({
          include: { relatedHand: true, user: { select: { id: true, nickname: true, username: true } } },
          orderBy: { createdAt: "desc" },
          take: query.limit,
          where: { type: "HAND_ENTRY_FEE" },
        }),
      ]);
      const metadataHandIds = [...new Set([...extensions, ...entryFees]
        .map((item) => handIdFromLedgerMetadata(item.metadata))
        .filter((handId): handId is string => handId !== null))];
      const extensionHands = metadataHandIds.length === 0
        ? []
        : await database.handRecord.findMany({
            select: { bigBlindAmount: true, id: true },
            where: { id: { in: metadataHandIds } },
          });
      const extensionHandById = new Map(extensionHands.map((hand) => [hand.id, hand]));
      const items = [
        ...reveals.map((item) => ({
          actionType: "PAID_HAND_REVEAL" as const,
          bigBlind: item.hand.bigBlindAmount,
          cost: item.cost,
          createdAt: item.createdAt,
          expectedCost: item.hand.paidCardRevealCost,
          handId: item.handId,
          id: item.id,
          operationId: item.idempotencyKey,
          roomId: item.roomId,
          user: item.buyer,
          validationStatus: item.cost === item.hand.paidCardRevealCost ? "VALID" as const : "INVALID" as const,
          walletLedger: { id: item.walletLedgerEntry.id, signedAmount: item.walletLedgerEntry.signedAmount, type: item.walletLedgerEntry.type },
        })),
        ...runouts.map((item) => ({
          actionType: "HYPOTHETICAL_RUNOUT" as const,
          bigBlind: item.hand.bigBlindAmount,
          cost: item.cost,
          createdAt: item.createdAt,
          expectedCost: tableDiamondFees().hypotheticalRunout,
          handId: item.handId,
          id: item.id,
          operationId: item.idempotencyKey,
          roomId: item.roomId,
          user: item.buyer,
          validationStatus: item.cost === tableDiamondFees().hypotheticalRunout ? "VALID" as const : "INVALID" as const,
          walletLedger: { id: item.walletLedgerEntry.id, signedAmount: item.walletLedgerEntry.signedAmount, type: item.walletLedgerEntry.type },
        })),
        ...extensions.map((item) => {
          const metadataHandId = handIdFromLedgerMetadata(item.metadata);
          const hand = item.relatedHand ?? (metadataHandId === null ? null : extensionHandById.get(metadataHandId) ?? null);
          const expected = hand === null ? null : tableDiamondFees().actionTimeExtension;
          const cost = -item.signedAmount;
          return {
            actionType: "ACTION_TIME_EXTENSION" as const,
            bigBlind: hand?.bigBlindAmount ?? null,
            cost,
            createdAt: item.createdAt,
            expectedCost: expected,
            handId: item.relatedHandId ?? metadataHandId,
            id: item.id,
            operationId: item.idempotencyKey,
            roomId: item.relatedRoomId,
            user: item.user,
            validationStatus: expected === null ? "MISSING_HAND" as const : cost === expected ? "VALID" as const : "INVALID" as const,
            walletLedger: { id: item.id, signedAmount: item.signedAmount, type: item.type },
          };
        }),
        ...entryFees.map((item) => {
          const metadataHandId = handIdFromLedgerMetadata(item.metadata);
          const hand = item.relatedHand ?? (metadataHandId === null ? null : extensionHandById.get(metadataHandId) ?? null);
          const expected = tableDiamondFees().handEntry;
          const cost = -item.signedAmount;
          return {
            actionType: "HAND_ENTRY_FEE" as const,
            bigBlind: hand?.bigBlindAmount ?? null,
            cost,
            createdAt: item.createdAt,
            expectedCost: expected,
            handId: item.relatedHandId ?? metadataHandId,
            id: item.id,
            operationId: item.idempotencyKey,
            roomId: item.relatedRoomId,
            user: item.user,
            validationStatus: metadataHandId === null || item.relatedRoomId === null || item.relatedGameSessionId === null
              ? "MISSING_HAND" as const
              : cost === expected ? "VALID" as const : "INVALID" as const,
            walletLedger: { id: item.id, signedAmount: item.signedAmount, type: item.type },
          };
        }),
      ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
      const filtered = query.search === undefined
        ? items
        : items.filter((item) => [item.id, item.handId, item.roomId, item.user.id].includes(query.search!));
      return { items: filtered.slice(0, query.limit), nextCursor: null };
    },

    async listPaidReveals(query: AdminListQuery) {
      const purchases = await database.paidHandRevealPurchase.findMany({
        include: {
          buyer: { select: { id: true, nickname: true, username: true } },
          walletLedgerEntry: { select: { id: true, signedAmount: true, type: true } },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined ? {} : { OR: [{ id: query.search }, { buyerUserId: query.search }, { handId: query.search }] }),
        },
      });
      const page = purchases.slice(0, query.limit);
      return { items: page, nextCursor: purchases.length > query.limit ? page.at(-1)?.id ?? null : null };
    },

    async listHypotheticalRunouts(query: AdminListQuery) {
      const runouts = await database.handHypotheticalRunout.findMany({
        include: {
          hand: {
            include: {
              hypotheticalRunoutPurchases: {
                include: {
                  buyer: { select: { id: true, nickname: true, username: true } },
                  walletLedgerEntry: { select: { id: true, signedAmount: true, type: true } },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined ? {} : { OR: [{ id: query.search }, { handId: query.search }] }),
        },
      });
      const page = runouts.slice(0, query.limit);
      return {
        items: page.map((runout) => ({
          cards: runout.cards,
          createdAt: runout.createdAt,
          generationSource: runout.generationSource,
          handId: runout.handId,
          id: runout.id,
          purchases: runout.hand.hypotheticalRunoutPurchases,
        })),
        nextCursor: runouts.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async listAuditLogs(query: AdminListQuery) {
      const logs = await database.auditLog.findMany({
        include: { actor: { select: { id: true, nickname: true, username: true } } },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined
            ? {}
            : { OR: [{ id: query.search }, { actorUserId: query.search }, { action: query.search }, { targetId: query.search }, { targetUserId: query.search }, { roomId: query.search }, { handId: query.search }] }),
        },
      });
      const page = logs.slice(0, query.limit);
      return {
        items: page.map((log) => ({
          action: log.action,
          actor: log.actor,
          actorRole: log.actorRole,
          createdAt: log.createdAt,
          handId: log.handId,
          id: log.id,
          ipAddressSummary: log.ipAddressSummary,
          operationId: log.operationId,
          reason: log.reason,
          requestId: log.requestId,
          roomId: log.roomId,
          targetId: log.targetId,
          targetType: log.targetType,
          targetUserId: log.targetUserId,
          userAgentSummary: log.userAgentSummary,
        })),
        nextCursor: logs.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async listRecovery(query: AdminListQuery) {
      const snapshots = await database.tableSnapshot.findMany({
        include: { room: { select: { id: true, roomCode: true, status: true } } },
        orderBy: { id: "asc" },
        take: query.limit + 1,
        where: {
          ...(query.cursor === undefined ? {} : { id: { gt: query.cursor } }),
          ...(query.search === undefined ? {} : { OR: [{ roomId: query.search }, { activeHandId: query.search }] }),
        },
      });
      const page = snapshots.slice(0, query.limit);
      return {
        items: page.map((snapshot) => ({
          lastErrorSummary: snapshot.lastRecoveryError === null ? null : "快照验证失败，请重新验证",
          recoveryStatus: snapshot.recoveryStatus,
          room: snapshot.room,
          runtimeStatus: snapshot.runtimeStatus,
          safeErrorCode: snapshot.lastRecoveryError === null ? null : snapshot.lastRecoveryError.slice(0, 80).replace(/[^a-z0-9:_-]/giu, "-"),
          schemaVersion: snapshot.schemaVersion,
          snapshotRevision: snapshot.snapshotRevision,
          stateVersion: snapshot.stateVersion,
          updatedAt: snapshot.updatedAt,
        })),
        nextCursor: snapshots.length > query.limit ? page.at(-1)?.id ?? null : null,
      };
    },

    async revalidateRecovery(
      roomId: string,
      input: AdminRoomActionInput,
      context: AdminRequestContext,
    ) {
      const result = await validateRecoverySnapshot(roomId);
      if (result.valid) {
        await database.tableSnapshot.update({
          data: { lastRecoveryError: null, recoveryStatus: "READY", runtimeStatus: result.runtimeStatus },
          where: { roomId },
        });
      } else {
        await database.tableSnapshot.update({
          data: { lastRecoveryError: result.safeErrorCode, recoveryStatus: "ERROR", runtimeStatus: "RECOVERY_ERROR" },
          where: { roomId },
        });
      }
      await recordRecoveryAudit(roomId, "REVALIDATE", input, context, result);
      return result;
    },

    async retryRecovery(
      roomId: string,
      input: AdminRoomActionInput,
      context: AdminRequestContext,
    ) {
      const validation = await validateRecoverySnapshot(roomId);
      if (!validation.valid) {
        await database.tableSnapshot.update({
          data: { lastRecoveryError: validation.safeErrorCode, recoveryStatus: "ERROR", runtimeStatus: "RECOVERY_ERROR" },
          where: { roomId },
        });
        await recordRecoveryAudit(roomId, "RETRY", input, context, validation);
        throw new ApiError(409, "RECOVERY_SNAPSHOT_INVALID", "快照未通过安全验证");
      }
      await database.tableSnapshot.update({
        data: { lastRecoveryError: null, recoveryStatus: "READY", runtimeStatus: validation.runtimeStatus },
        where: { roomId },
      });
      const hydration = options.retryRecovery
        ? await options.retryRecovery(roomId)
        : { status: "REVALIDATED_ONLY" };
      const result = { hydration, valid: true as const };
      await recordRecoveryAudit(roomId, "RETRY", input, context, result);
      return result;
    },

    async system() {
      const [dashboard, postgresRows, connectionRows] = await Promise.all([
        this.dashboard(),
        database.$queryRaw<Array<{ readonly postgresVersion: string }>>`
          SELECT current_setting('server_version') AS "postgresVersion"
        `,
        database.$queryRaw<Array<{ readonly active: number; readonly idle: number; readonly total: number }>>`
          SELECT
            COUNT(*) FILTER (WHERE state = 'active')::INTEGER AS active,
            COUNT(*) FILTER (WHERE state = 'idle')::INTEGER AS idle,
            COUNT(*)::INTEGER AS total
          FROM pg_stat_activity
          WHERE datname = current_database()
        `,
      ]);
      return {
        actionCacheSize: dashboard.actionCacheSize,
        activeRuntimes: dashboard.activeRuntimes,
        activeRuntimeTimers: dashboard.activeRuntimeTimers,
        activeSockets: dashboard.activeSockets,
        applicationVersion: dashboard.applicationVersion,
        completedHands: dashboard.handsCompleted24h,
        databaseStatus: dashboard.databaseStatus,
        databaseConnections: connectionRows[0] ?? { active: 0, idle: 0, total: 0 },
        degradedRooms: dashboard.degradedRooms,
        eventLoopDelayMs: options.eventLoopDelay?.() ?? null,
        migrationCount: dashboard.migrationCount,
        migrationStatus: dashboard.migrationStatus,
        memoryUsage: {
          arrayBuffers: process.memoryUsage().arrayBuffers,
          external: process.memoryUsage().external,
          heapTotal: process.memoryUsage().heapTotal,
          heapUsed: process.memoryUsage().heapUsed,
          rss: process.memoryUsage().rss,
        },
        nodeVersion: process.versions.node,
        openRooms: dashboard.openRooms,
        playingTables: dashboard.handsInProgress,
        postgresVersion: postgresRows[0]?.postgresVersion ?? "unknown",
        postHandReviewTables: dashboard.postHandReview,
        protocolVersion: PROTOCOL_VERSION,
        recoveryComplete: dashboard.recoveryComplete,
        reservedAwayPlayers: dashboard.reservedAway,
        bustedWaitingRebuyPlayers: dashboard.bustedWaitingRebuy,
        uptimeSeconds: dashboard.uptimeSeconds,
      };
    },

    async mutateRoom(
      roomId: string,
      action: "CLOSE" | "PAUSE" | "RESUME",
      input: AdminRoomActionInput,
      context: AdminRequestContext,
    ) {
      const fingerprint = requestHash({ action, reason: input.reason, roomId });
      const replay = await database.auditLog.findUnique({
        where: { actorUserId_operationId: { actorUserId: context.actorUserId, operationId: input.operationId } },
      });
      if (replay) {
        const metadata = replay.metadata;
        const storedFingerprint = metadata !== null && !Array.isArray(metadata) && typeof metadata === "object"
          ? (metadata as Record<string, unknown>).requestHash
          : undefined;
        if (storedFingerprint !== fingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
        }
        return { replayed: true, room: await this.getRoom(roomId) };
      }
      const actor = await database.user.findUnique({ select: { role: true }, where: { id: context.actorUserId } });
      if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
      if (!options.roomLifecycleAction) {
        throw new ApiError(503, "ADMIN_ROOM_CONTROL_UNAVAILABLE", "房间控制暂不可用");
      }
      const room = await options.roomLifecycleAction(roomId, action);
      try {
        await database.auditLog.create({
          data: {
            action: `ADMIN_ROOM_${action}`,
            actorRole: "ADMIN",
            actorUserId: context.actorUserId,
            ipAddressSummary: context.ipAddressSummary,
            metadata: sanitizeAuditMetadata({ requestHash: fingerprint }),
            operationId: input.operationId,
            reason: input.reason,
            requestId: context.requestId,
            roomId,
            targetId: roomId,
            targetType: "ROOM",
            userAgentSummary: context.userAgentSummary,
          },
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) throw error;
        const concurrent = await database.auditLog.findUnique({
          where: { actorUserId_operationId: { actorUserId: context.actorUserId, operationId: input.operationId } },
        });
        const metadata = concurrent?.metadata;
        const storedFingerprint = metadata !== null && !Array.isArray(metadata) && typeof metadata === "object"
          ? (metadata as Record<string, unknown>).requestHash
          : undefined;
        if (storedFingerprint !== fingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
        }
        return { replayed: true, room: await this.getRoom(roomId) };
      }
      return { replayed: false, room };
    },

    async claimTestBots(
      input: AdminTestBotLeaseClaimInput,
      actorUserId: string,
    ) {
      const now = clock();
      const leaseExpiresAt = new Date(now.getTime() + TEST_BOT_LEASE_DURATION_MS);
      return database.$transaction(async (transaction) => {
        const actor = await transaction.user.findUnique({ select: { role: true }, where: { id: actorUserId } });
        if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
        const bots = await transaction.$queryRaw<Array<{
          readonly id: string;
          readonly nickname: string;
          readonly testBotLeaseExpiresAt: Date | null;
          readonly testBotLeaseId: string | null;
          readonly testBotOrdinal: number;
          readonly username: string;
        }>>`
          SELECT "id", "nickname", "username", "testBotOrdinal", "testBotLeaseId", "testBotLeaseExpiresAt"
          FROM "User"
          WHERE "isTestBot" = TRUE
          ORDER BY "testBotOrdinal"
          FOR UPDATE
        `;
        const replay = bots.filter((bot) => bot.testBotLeaseId === input.leaseId);
        if (replay.length > 0) {
          if (replay.length !== input.count) throw new ApiError(409, "TEST_BOT_LEASE_CONFLICT", "机器人租约数量不一致");
          await transaction.user.updateMany({
            data: { testBotLeaseExpiresAt: leaseExpiresAt },
            where: { testBotLeaseId: input.leaseId },
          });
          return { accounts: replay, leaseExpiresAt, leaseId: input.leaseId, replayed: true };
        }
        const available = bots.filter((bot) => (
          bot.testBotLeaseId === null
          || bot.testBotLeaseExpiresAt === null
          || bot.testBotLeaseExpiresAt <= now
        )).slice(0, input.count);
        if (available.length !== input.count) {
          throw new ApiError(409, "TEST_BOT_ACCOUNTS_UNAVAILABLE", "没有足够的空闲机器人账户");
        }
        for (const bot of available) {
          await transaction.userSession.updateMany({
            data: { revokedAt: now },
            where: { userId: bot.id, revokedAt: null },
          });
          const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId: bot.id } });
          const refill = MAX_POINTS - wallet.balance;
          if (refill > 0) {
            const entry = await applyWalletMutationInTransaction(transaction, {
              idempotencyKey: `test-bot-lease-refill:${bot.id}:${input.leaseId}`,
              metadata: { leaseId: input.leaseId, source: "test-bot-lease" },
              signedAmount: refill,
              type: "ADMIN_ADJUSTMENT",
              userId: bot.id,
            });
            if (!entry) throw new ApiError(409, "WALLET_CONCURRENT_UPDATE", "机器人钻石正在更新");
          }
          await transaction.user.update({
            data: { testBotLeaseExpiresAt: leaseExpiresAt, testBotLeaseId: input.leaseId },
            where: { id: bot.id },
          });
        }
        return { accounts: available, leaseExpiresAt, leaseId: input.leaseId, replayed: false };
      });
    },

    async heartbeatTestBots(input: AdminTestBotLeaseInput, actorUserId: string) {
      const actor = await database.user.findUnique({ select: { role: true }, where: { id: actorUserId } });
      if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
      const leaseExpiresAt = new Date(clock().getTime() + TEST_BOT_LEASE_DURATION_MS);
      const updated = await database.user.updateMany({
        data: { testBotLeaseExpiresAt: leaseExpiresAt },
        where: { isTestBot: true, testBotLeaseId: input.leaseId },
      });
      if (updated.count === 0) throw new ApiError(409, "TEST_BOT_LEASE_EXPIRED", "机器人账户租约已经失效");
      return { accountCount: updated.count, leaseExpiresAt, leaseId: input.leaseId };
    },

    async releaseTestBots(input: AdminTestBotLeaseInput, actorUserId: string) {
      return database.$transaction(async (transaction) => {
        const actor = await transaction.user.findUnique({ select: { role: true }, where: { id: actorUserId } });
        if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
        const bots = await transaction.user.findMany({
          select: { id: true },
          where: { isTestBot: true, testBotLeaseId: input.leaseId },
        });
        if (bots.length === 0) return { accountCount: 0, leaseId: input.leaseId };
        const userIds = bots.map((bot) => bot.id);
        await transaction.userSession.updateMany({
          data: { revokedAt: clock() },
          where: { userId: { in: userIds }, revokedAt: null },
        });
        await transaction.user.updateMany({
          data: { testBotLeaseExpiresAt: null, testBotLeaseId: null },
          where: { id: { in: userIds }, testBotLeaseId: input.leaseId },
        });
        return { accountCount: bots.length, leaseId: input.leaseId };
      });
    },

    async deleteRoomData(
      roomId: string,
      input: AdminDestructiveActionInput,
      context: AdminRequestContext,
    ) {
      const fingerprint = requestHash({ reason: input.reason, roomId });
      const existing = await database.auditLog.findUnique({
        where: { actorUserId_operationId: { actorUserId: context.actorUserId, operationId: input.operationId } },
      });
      if (existing) {
        const metadata = existing.metadata;
        if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object" || (metadata as Record<string, unknown>).requestHash !== fingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
        }
        return { deletedRoomId: roomId, replayed: true };
      }
      const room = await database.room.findUnique({ select: { roomCode: true, status: true }, where: { id: roomId } });
      if (!room) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
      if (room.status !== "CLOSED") throw new ApiError(409, "ROOM_DELETE_REQUIRES_CLOSED", "请先安全关闭房间再删除数据");
      if (options.removeClosedRuntime && !await options.removeClosedRuntime(roomId)) {
        throw new ApiError(409, "ROOM_RUNTIME_STILL_ACTIVE", "房间运行状态尚未释放，请稍后重试");
      }
      const result = await database.$transaction(async (transaction) => {
        const actor = await transaction.user.findUnique({ select: { role: true }, where: { id: context.actorUserId } });
        if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
        `;
        const locked = await transaction.room.findUnique({ select: { status: true }, where: { id: roomId } });
        if (!locked) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
        if (locked.status !== "CLOSED") throw new ApiError(409, "ROOM_DELETE_REQUIRES_CLOSED", "请先安全关闭房间再删除数据");
        const deleted = await deleteRoomDataInTransaction(transaction, [roomId]);
        await transaction.auditLog.create({
          data: {
            action: "ADMIN_ROOM_DATA_DELETED",
            actorRole: "ADMIN",
            actorUserId: context.actorUserId,
            ipAddressSummary: context.ipAddressSummary,
            metadata: sanitizeAuditMetadata({ handsDeleted: deleted.hands, requestHash: fingerprint, roomCode: room.roomCode }),
            operationId: input.operationId,
            reason: input.reason,
            requestId: context.requestId,
            targetId: roomId,
            targetType: "ROOM",
            userAgentSummary: context.userAgentSummary,
          },
        });
        return deleted;
      });
      await deleteAdministratorRoomLog(room.roomCode, roomId);
      return { deletedHands: result.hands, deletedRoomId: roomId, replayed: false };
    },

    async deleteUserData(
      targetUserId: string,
      input: AdminDestructiveActionInput,
      context: AdminRequestContext,
    ) {
      if (targetUserId === context.actorUserId) throw new ApiError(409, "ADMIN_SELF_DELETE_FORBIDDEN", "不能删除当前管理员账户");
      const fingerprint = requestHash({ reason: input.reason, targetUserId });
      const existing = await database.auditLog.findUnique({
        where: { actorUserId_operationId: { actorUserId: context.actorUserId, operationId: input.operationId } },
      });
      if (existing) {
        const metadata = existing.metadata;
        if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object" || (metadata as Record<string, unknown>).requestHash !== fingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
        }
        return { deletedUserId: targetUserId, replayed: true };
      }
      return database.$transaction(async (transaction) => {
        const actor = await transaction.user.findUnique({ select: { role: true }, where: { id: context.actorUserId } });
        if (actor?.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "User" WHERE "id" = ${targetUserId} FOR UPDATE
        `;
        const target = await transaction.user.findUnique({
          select: {
            _count: { select: { gameSessions: true, roomMemberships: true, tableSeats: true } },
            role: true,
            username: true,
          },
          where: { id: targetUserId },
        });
        if (!target) throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
        if (target.role === "ADMIN") throw new ApiError(409, "ADMIN_DELETE_FORBIDDEN", "管理员账户不能通过玩家删除功能移除");
        const ownedRooms = await transaction.room.count({ where: { ownerId: targetUserId } });
        if (ownedRooms > 0 || target._count.roomMemberships > 0 || target._count.gameSessions > 0 || target._count.tableSeats > 0) {
          throw new ApiError(409, "USER_HAS_ROOM_DATA", "请先删除该玩家关联的房间数据");
        }
        await transaction.room.updateMany({ data: { archivedByUserId: null }, where: { archivedByUserId: targetUserId } });
        await transaction.auditLog.deleteMany({ where: { OR: [{ actorUserId: targetUserId }, { targetUserId }] } });
        await transaction.requestIdempotency.deleteMany({ where: { actorId: targetUserId } });
        await transaction.userSession.deleteMany({ where: { userId: targetUserId } });
        await transaction.walletLedgerEntry.deleteMany({ where: { userId: targetUserId } });
        await transaction.wallet.deleteMany({ where: { userId: targetUserId } });
        await transaction.user.delete({ where: { id: targetUserId } });
        await transaction.auditLog.create({
          data: {
            action: "ADMIN_USER_DATA_DELETED",
            actorRole: "ADMIN",
            actorUserId: context.actorUserId,
            ipAddressSummary: context.ipAddressSummary,
            metadata: sanitizeAuditMetadata({ requestHash: fingerprint, username: target.username }),
            operationId: input.operationId,
            reason: input.reason,
            requestId: context.requestId,
            targetId: targetUserId,
            targetType: "USER",
            userAgentSummary: context.userAgentSummary,
          },
        });
        return { deletedUserId: targetUserId, replayed: false };
      });
    },

    async adjustWallet(
      targetUserId: string,
      input: AdminWalletAdjustmentInput,
      context: AdminRequestContext,
    ): Promise<AdjustmentResponse> {
      const fingerprint = requestHash({
        reason: input.reason,
        signedAmount: input.signedAmount,
        targetUserId,
      });
      const replay = await findReplay(context.actorUserId, input.operationId, fingerprint);
      if (replay) return replay;

      try {
        return await database.$transaction(async (transaction) => {
          const actor = await transaction.user.findUnique({
            select: { role: true },
            where: { id: context.actorUserId },
          });
          if (actor?.role !== "ADMIN") {
            throw new ApiError(403, "ADMIN_REQUIRED", "需要管理员权限");
          }
          const targetExists = await transaction.user.count({ where: { id: targetUserId } });
          if (targetExists === 0) {
            throw new ApiError(404, "ADMIN_TARGET_NOT_FOUND", "目标不存在");
          }
          const entry = await applyWalletMutationInTransaction(transaction, {
            idempotencyKey: `admin-adjustment:${context.actorUserId}:${input.operationId}`,
            metadata: {
              actorUserId: context.actorUserId,
              operationId: input.operationId,
              reason: input.reason,
            },
            signedAmount: input.signedAmount,
            type: "ADMIN_ADJUSTMENT",
            userId: targetUserId,
          });
          if (!entry) {
            throw new ApiError(409, "WALLET_CONCURRENT_UPDATE", "钻石账户正在更新，请重试");
          }
          const result: AdjustmentResponse = {
            balanceAfter: entry.balanceAfter,
            balanceBefore: entry.balanceBefore,
            ledgerEntryId: entry.id,
            operationId: input.operationId,
            replayed: false,
            signedAmount: entry.signedAmount,
            targetUserId,
          };
          await transaction.auditLog.create({
            data: {
              action: "ADMIN_WALLET_ADJUSTMENT",
              actorRole: "ADMIN",
              actorUserId: context.actorUserId,
              ipAddressSummary: context.ipAddressSummary,
              metadata: sanitizeAuditMetadata({
                balanceAfter: entry.balanceAfter,
                balanceBefore: entry.balanceBefore,
                ledgerEntryId: entry.id,
                signedAmount: entry.signedAmount,
              }),
              operationId: input.operationId,
              reason: input.reason,
              requestId: context.requestId,
              targetId: targetUserId,
              targetType: "USER_WALLET",
              targetUserId,
              userAgentSummary: context.userAgentSummary,
            },
          });
          await transaction.requestIdempotency.create({
            data: {
              actorId: context.actorUserId,
              key: input.operationId,
              requestHash: fingerprint,
              resourceId: entry.id,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "ADMIN_WALLET_ADJUSTMENT",
            },
          });
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const concurrentReplay = await findReplay(
            context.actorUserId,
            input.operationId,
            fingerprint,
          );
          if (concurrentReplay) return concurrentReplay;
        }
        throw error;
      }
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
