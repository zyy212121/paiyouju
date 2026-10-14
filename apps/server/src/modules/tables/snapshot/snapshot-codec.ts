import {
  assertHandStateInvariants,
  parseCard,
  serializeCard,
  type DomainEvent,
  type HandState,
  type PlayerHandState,
  type Pot,
  type PotAward,
  type SettlementResult,
} from "@paiyouju/poker-core";

import type { CompletedActionInput } from "../hand-persistence.service.js";
import type { TableRuntime } from "../runtime/table-runtime.js";
import type { RuntimeAuthorityState } from "../runtime/runtime-authority-state.js";
import type { RuntimeHand, RuntimePostHandReview, RuntimeRoomConfig, RuntimeSeat, RuntimeStatus } from "../runtime/types.js";
import {
  LEGACY_TABLE_SNAPSHOT_SCHEMA_VERSION,
  PRE_BOMB_POT_TABLE_SNAPSHOT_SCHEMA_VERSION,
  PRE_SHORT_DECK_TABLE_SNAPSHOT_SCHEMA_VERSION,
  PRE_SQUID_TABLE_SNAPSHOT_SCHEMA_VERSION,
  PRE_RUN_IT_TWICE_TABLE_SNAPSHOT_SCHEMA_VERSION,
  TABLE_SNAPSHOT_SCHEMA_VERSION,
  TableSnapshotPayloadSchema,
  type TableSnapshotPayload,
} from "./snapshot-schema.js";

export class SnapshotValidationError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = "SnapshotValidationError";
  }
}

export interface SnapshotRecordInput {
  readonly activeHandId: string | null;
  readonly activeHandNumber: number | null;
  readonly payload: TableSnapshotPayload;
  readonly recoveryStatus: "PENDING" | "READY" | "ERROR";
  readonly runtimeStatus: RuntimeStatus;
  readonly schemaVersion: number;
  readonly startDeadlineAt: Date | null;
  readonly stateVersion: number;
  readonly turnDeadlineAt: Date | null;
}

export interface UnvalidatedSnapshotRecord extends Omit<SnapshotRecordInput, "payload" | "runtimeStatus"> {
  readonly payload: PrismaJsonValue;
  readonly runtimeStatus: string;
}

type PrismaJsonValue = string | number | boolean | null | { readonly [key: string]: PrismaJsonValue | undefined } | readonly PrismaJsonValue[];

export interface SnapshotRecord extends UnvalidatedSnapshotRecord {
  readonly id: string;
  readonly roomId: string;
  readonly snapshotRevision: number;
}

export interface SnapshotRelations {
  readonly room: RuntimeRoomConfig;
  readonly seats: readonly RuntimeSeat[];
}

export interface RecoveredTableSnapshot {
  readonly currentHand: RuntimeHand | null;
  readonly handNumber: number;
  readonly lastButtonSeat: number | null;
  readonly lastCompletedHand: RuntimeHand | null;
  readonly postHandReview: RuntimePostHandReview | null;
  readonly room: RuntimeRoomConfig;
  readonly seats: readonly RuntimeSeat[];
  readonly snapshotRevision: number;
  readonly startCountdownAt: Date | null;
  readonly stateVersion: number;
  readonly status: RuntimeStatus;
}

function fail(reason: string): never {
  throw new SnapshotValidationError("牌桌快照验证失败", reason);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeTableSnapshotPayload(
  payload: unknown,
  room: Pick<RuntimeRoomConfig, "durationMinutes" | "expiresAt">,
): unknown {
  if (!isJsonObject(payload)) return payload;
  const snapshotRoom = payload.room;
  if (snapshotRoom === undefined || !isJsonObject(snapshotRoom)) return payload;
  return {
    ...payload,
    room: {
      ...snapshotRoom,
      durationMinutes: snapshotRoom.durationMinutes ?? room.durationMinutes,
      expiresAt: snapshotRoom.expiresAt ?? room.expiresAt.toISOString(),
    },
  };
}

function serializeEvent(event: DomainEvent) {
  return {
    ...(event.amount === undefined ? {} : { amount: event.amount }),
    ...(event.cards === undefined ? {} : { cards: event.cards.map(serializeCard) }),
    eventType: event.eventType,
    handId: event.handId,
    ...(event.playerId === undefined ? {} : { playerId: event.playerId }),
    ...(event.potIndex === undefined ? {} : { potIndex: event.potIndex }),
    ...(event.runoutCount === undefined ? {} : { runoutCount: event.runoutCount }),
    ...(event.runoutIndex === undefined ? {} : { runoutIndex: event.runoutIndex }),
    ...(event.seatIndex === undefined ? {} : { seatIndex: event.seatIndex }),
    stateVersion: event.stateVersion,
    ...(event.street === undefined ? {} : { street: event.street }),
    ...(event.winners === undefined ? {} : { winners: [...event.winners] }),
  };
}

function serializePot(pot: Pot) {
  return {
    amount: pot.amount,
    contributors: [...pot.contributors],
    eligiblePlayers: [...pot.eligiblePlayers],
  };
}

function serializeAward(pot: PotAward) {
  return {
    ...serializePot(pot),
    amountPerWinner: pot.amountPerWinner,
    awards: { ...pot.awards },
    oddChipRecipients: [...pot.oddChipRecipients],
    winners: [...pot.winners],
  };
}

function serializeHandState(state: HandState) {
  return {
    actionHistory: state.actionHistory.map(serializeEvent),
    bigBlindSeat: state.bigBlindSeat,
    board: state.board.map(serializeCard),
    bombPotBlind: state.bombPotBlind ?? null,
    buttonSeat: state.buttonSeat,
    config: { ...state.config },
    currentActorSeat: state.currentActorSeat,
    currentBet: state.currentBet,
    deck: state.deck.map(serializeCard),
    handId: state.handId,
    lastFullRaiseSize: state.lastFullRaiseSize,
    players: state.players.map((player) => ({
      ...player,
      holeCards: player.holeCards.map(serializeCard) as [string, string],
    })),
    pots: state.pots.map(serializePot),
    settlement: state.settlement === null ? null : {
      awardsByPlayer: { ...state.settlement.awardsByPlayer },
      finalStacks: { ...state.settlement.finalStacks },
      pots: state.settlement.pots.map(serializeAward),
      revealedPlayers: [...state.settlement.revealedPlayers],
      uncalledReturnsByPlayer: { ...state.settlement.uncalledReturnsByPlayer },
      winners: [...state.settlement.winners],
      ...(state.settlement.runouts === undefined ? {} : {
        runouts: state.settlement.runouts.map((runout) => ({
          awardsByPlayer: { ...runout.awardsByPlayer },
          board: runout.board.map(serializeCard),
          pots: runout.pots.map(serializeAward),
          runoutIndex: runout.runoutIndex,
          winners: [...runout.winners],
        })) as [unknown, unknown],
      }),
    },
    ...(state.runoutBoards === undefined ? {} : { runoutBoards: state.runoutBoards.map((board) => board.map(serializeCard)) as [[string, string, string, string, string], [string, string, string, string, string]] }),
    ...(state.runoutSharedCardCount === undefined ? {} : { runoutSharedCardCount: state.runoutSharedCardCount }),
    smallBlindSeat: state.smallBlindSeat,
    stateVersion: state.stateVersion,
    status: state.status,
    street: state.street,
  };
}

function serializeAction(action: CompletedActionInput) {
  return {
    ...action,
    automaticReason: action.automatic ? action.automaticReason ?? "TURN_TIMEOUT" : null,
    createdAt: action.createdAt.toISOString(),
  };
}

function serializeRuntimeHand(hand: RuntimeHand) {
  return {
    actions: hand.actions.map(serializeAction),
    handNumber: hand.handNumber,
    paidCardRevealCost: hand.paidCardRevealCost,
    paidCardRevealEnabled: hand.paidCardRevealEnabled,
    runoutChoicesByUser: { ...(hand.runoutChoicesByUser ?? {}) },
    runoutVote: !hand.runoutVote ? null : {
      choicesByUser: { ...hand.runoutVote.choicesByUser },
      deadlineAt: hand.runoutVote.deadlineAt.toISOString(),
      eligibleUserIds: [...hand.runoutVote.eligibleUserIds] as [string, string],
    },
    startedAt: hand.startedAt.toISOString(),
    state: serializeHandState(hand.state),
    turnDeadlineAt: hand.turnDeadlineAt?.toISOString() ?? null,
  };
}

function snapshotPayload(runtime: Pick<RuntimeAuthorityState, "currentHand" | "handNumber" | "lastButtonSeat" | "lastCompletedHand" | "postHandReview" | "room" | "seats" | "startCountdownAt" | "stateVersion" | "status">): TableSnapshotPayload {
  const plain = {
    currentHand: runtime.currentHand === null ? null : serializeRuntimeHand(runtime.currentHand),
    handNumber: runtime.handNumber,
    lastButtonSeat: runtime.lastButtonSeat,
    lastCompletedHand: runtime.lastCompletedHand === null ? null : serializeRuntimeHand(runtime.lastCompletedHand),
    postHandReview: !runtime.postHandReview ? null : {
      endsAt: runtime.postHandReview.endsAt.toISOString(),
      hand: serializeRuntimeHand(runtime.postHandReview.hand),
      voluntarilyRevealedCardIndicesByUser: runtime.postHandReview.voluntarilyRevealedCardIndicesByUser,
      voluntarilyRevealedUserIds: [...runtime.postHandReview.voluntarilyRevealedUserIds],
    },
    room: {
      actionTimeSeconds: runtime.room.actionTimeSeconds,
      bigBlind: runtime.room.bigBlind,
      bombPotBlindMultiplier: runtime.room.bombPotBlindMultiplier ?? null,
      bombPotIntervalMinutes: runtime.room.bombPotIntervalMinutes ?? null,
      bombPotNextAt: runtime.room.bombPotNextAt?.toISOString() ?? null,
      durationMinutes: runtime.room.durationMinutes,
      expiresAt: runtime.room.expiresAt.toISOString(),
      initialBuyIn: runtime.room.initialBuyIn
        ?? Math.min(runtime.room.maximumBuyIn, Math.max(runtime.room.minimumBuyIn, runtime.room.bigBlind * 100)),
      maximumBuyIn: runtime.room.maximumBuyIn,
      maxSeats: runtime.room.maxSeats,
      minimumBuyIn: runtime.room.minimumBuyIn,
      name: runtime.room.name,
      nextHandPaused: runtime.room.nextHandPaused,
      ...(runtime.room.ownerId ? { ownerId: runtime.room.ownerId } : {}),
      paidCardRevealCost: runtime.room.paidCardRevealCost ?? 0,
      paidCardRevealEnabled: runtime.room.paidCardRevealEnabled ?? false,
      roomCode: runtime.room.roomCode,
      roomId: runtime.room.roomId,
      requiresManualStart: runtime.room.requiresManualStart ?? true,
      runItTwiceEnabled: runtime.room.runItTwiceEnabled ?? false,
      smallBlind: runtime.room.smallBlind,
      specialMode: runtime.room.specialMode ?? "NORMAL",
      status: runtime.room.status,
      squidRoundGraceEndsAt: runtime.room.squidRoundGraceEndsAt?.toISOString() ?? null,
      squidRoundNumber: runtime.room.squidRoundNumber ?? 1,
      squidSettlementPending: runtime.room.squidSettlementPending ?? false,
      squidStake: runtime.room.squidStake ?? null,
      tableStartedAt: runtime.room.tableStartedAt?.toISOString() ?? null,
    },
    seats: [...runtime.seats].sort((left, right) => left.seatIndex - right.seatIndex).map((seat) => ({
      avatarId: seat.avatarId,
      gameSessionId: seat.gameSessionId,
      nickname: seat.nickname,
      nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet ?? null,
      nextActionAutopilotArmed: seat.nextActionAutopilotArmed ?? false,
      pendingShowCardIndices: [...(seat.pendingShowCardIndices ?? [])],
      playStatus: seat.playStatus,
      reservedAwayEndsAt: seat.reservedAwayEndsAt?.toISOString() ?? null,
      seatId: seat.seatId,
      seatIndex: seat.seatIndex,
      stack: seat.stack,
      squidMarked: seat.squidMarked ?? false,
      squidRoundParticipant: seat.squidRoundParticipant ?? false,
      trusteeshipEnabled: seat.trusteeshipEnabled ?? false,
      userId: seat.userId,
      version: seat.version,
    })),
    startCountdownAt: runtime.startCountdownAt?.toISOString() ?? null,
    stateVersion: runtime.stateVersion,
    status: runtime.status,
  };
  const parsed = TableSnapshotPayloadSchema.safeParse(plain);
  if (!parsed.success) fail(`serialize:${parsed.error.issues[0]?.path.join(".") ?? "payload"}`);
  return parsed.data;
}

export function serializeTableSnapshot(runtime: TableRuntime): SnapshotRecordInput {
  const payload = snapshotPayload({ ...runtime, seats: [...runtime.seats.values()] });
  return {
    activeHandId: runtime.currentHand?.state.handId ?? null,
    activeHandNumber: runtime.currentHand?.handNumber ?? null,
    payload,
    recoveryStatus: "READY",
    runtimeStatus: runtime.status,
    schemaVersion: TABLE_SNAPSHOT_SCHEMA_VERSION,
    startDeadlineAt: runtime.startCountdownAt,
    stateVersion: runtime.stateVersion,
    turnDeadlineAt: runtime.currentHand?.turnDeadlineAt ?? null,
  };
}

export function serializeRuntimeAuthority(state: RuntimeAuthorityState): SnapshotRecordInput {
  const payload = snapshotPayload(state);
  return {
    activeHandId: state.currentHand?.state.handId ?? null,
    activeHandNumber: state.currentHand?.handNumber ?? null,
    payload,
    recoveryStatus: "READY",
    runtimeStatus: state.status,
    schemaVersion: TABLE_SNAPSHOT_SCHEMA_VERSION,
    startDeadlineAt: state.startCountdownAt,
    stateVersion: state.stateVersion,
    turnDeadlineAt: state.currentHand?.turnDeadlineAt ?? null,
  };
}

type SerializedState = NonNullable<TableSnapshotPayload["currentHand"]>["state"];
type SerializedEvent = SerializedState["actionHistory"][number];
type SerializedPlayer = SerializedState["players"][number];
type SerializedPot = SerializedState["pots"][number];
type SerializedAward = NonNullable<SerializedState["settlement"]>["pots"][number];

function hydrateEvent(event: SerializedEvent): DomainEvent {
  return {
    ...(event.amount === undefined ? {} : { amount: event.amount }),
    ...(event.cards === undefined ? {} : { cards: event.cards.map(parseCard) }),
    eventType: event.eventType,
    handId: event.handId,
    ...(event.playerId === undefined ? {} : { playerId: event.playerId }),
    ...(event.potIndex === undefined ? {} : { potIndex: event.potIndex }),
    ...(event.runoutCount === undefined ? {} : { runoutCount: event.runoutCount }),
    ...(event.runoutIndex === undefined ? {} : { runoutIndex: event.runoutIndex }),
    ...(event.seatIndex === undefined ? {} : { seatIndex: event.seatIndex }),
    stateVersion: event.stateVersion,
    ...(event.street === undefined ? {} : { street: event.street }),
    ...(event.winners === undefined ? {} : { winners: event.winners }),
  };
}

function hydratePlayer(player: SerializedPlayer): PlayerHandState {
  return { ...player, holeCards: [parseCard(player.holeCards[0]), parseCard(player.holeCards[1])] };
}

function hydratePot(pot: SerializedPot): Pot {
  return { ...pot, contributors: pot.contributors, eligiblePlayers: pot.eligiblePlayers };
}

function hydrateAward(pot: SerializedAward): PotAward {
  return { ...hydratePot(pot), amountPerWinner: pot.amountPerWinner, awards: pot.awards, oddChipRecipients: pot.oddChipRecipients, winners: pot.winners };
}

function hydrateSettlement(settlement: NonNullable<SerializedState["settlement"]>): SettlementResult {
  const { runouts, ...singleBoardSettlement } = settlement;
  if (runouts === undefined) return { ...singleBoardSettlement, pots: singleBoardSettlement.pots.map(hydrateAward) };
  const hydrateRunout = (runout: (typeof runouts)[number]) => ({
    ...runout,
    board: runout.board.map(parseCard),
    pots: runout.pots.map(hydrateAward),
  });
  return {
    ...singleBoardSettlement,
    pots: singleBoardSettlement.pots.map(hydrateAward),
    runouts: [hydrateRunout(runouts[0]), hydrateRunout(runouts[1])],
  };
}

function hydrateState(state: SerializedState): HandState {
  const { bombPotBlind, runoutBoards, runoutSharedCardCount, ...singleBoardState } = state;
  const config: HandState["config"] = singleBoardState.config.variant === undefined
    ? {
        bigBlind: singleBoardState.config.bigBlind,
        maxSeats: singleBoardState.config.maxSeats,
        smallBlind: singleBoardState.config.smallBlind,
      }
    : { ...singleBoardState.config, variant: singleBoardState.config.variant };
  const hydrated: HandState = {
    ...singleBoardState,
    actionHistory: singleBoardState.actionHistory.map(hydrateEvent),
    board: singleBoardState.board.map(parseCard),
    config,
    deck: singleBoardState.deck.map(parseCard),
    players: singleBoardState.players.map(hydratePlayer),
    pots: singleBoardState.pots.map(hydratePot),
    settlement: singleBoardState.settlement === null ? null : hydrateSettlement(singleBoardState.settlement),
    ...(bombPotBlind === null ? {} : { bombPotBlind }),
  };
  if (runoutBoards === undefined) return hydrated;
  return {
    ...hydrated,
    runoutBoards: [runoutBoards[0].map(parseCard), runoutBoards[1].map(parseCard)],
    ...(runoutSharedCardCount === undefined ? {} : { runoutSharedCardCount }),
  };
}

function hydrateHand(hand: NonNullable<TableSnapshotPayload["currentHand"]>): RuntimeHand {
  return {
    actions: hand.actions.map((action) => ({ ...action, createdAt: new Date(action.createdAt) })),
    handNumber: hand.handNumber,
    paidCardRevealCost: hand.paidCardRevealCost,
    paidCardRevealEnabled: hand.paidCardRevealEnabled,
    runoutChoicesByUser: hand.runoutChoicesByUser,
    runoutVote: hand.runoutVote === null ? null : {
      choicesByUser: hand.runoutVote.choicesByUser,
      deadlineAt: new Date(hand.runoutVote.deadlineAt),
      eligibleUserIds: hand.runoutVote.eligibleUserIds,
    },
    startedAt: new Date(hand.startedAt),
    state: hydrateState(hand.state),
    turnDeadlineAt: hand.turnDeadlineAt === null ? null : new Date(hand.turnDeadlineAt),
  };
}

function equalRoom(left: RuntimeRoomConfig, right: RuntimeRoomConfig): boolean {
  const authority = (room: RuntimeRoomConfig) => ({
    actionTimeSeconds: room.actionTimeSeconds,
    bigBlind: room.bigBlind,
    bombPotBlindMultiplier: room.bombPotBlindMultiplier ?? null,
    bombPotIntervalMinutes: room.bombPotIntervalMinutes ?? null,
    bombPotNextAt: room.bombPotNextAt?.toISOString() ?? null,
    durationMinutes: room.durationMinutes,
    expiresAt: room.expiresAt.toISOString(),
    initialBuyIn: room.initialBuyIn
      ?? Math.min(room.maximumBuyIn, Math.max(room.minimumBuyIn, room.bigBlind * 100)),
    maximumBuyIn: room.maximumBuyIn,
    maxSeats: room.maxSeats,
    minimumBuyIn: room.minimumBuyIn,
    name: room.name,
    nextHandPaused: room.nextHandPaused,
    ownerId: room.ownerId ?? null,
    roomCode: room.roomCode,
    roomId: room.roomId,
    requiresManualStart: room.requiresManualStart ?? true,
    runItTwiceEnabled: room.runItTwiceEnabled ?? false,
    smallBlind: room.smallBlind,
    specialMode: room.specialMode ?? "NORMAL",
    status: room.status,
    squidRoundGraceEndsAt: room.squidRoundGraceEndsAt?.toISOString() ?? null,
    squidRoundNumber: room.squidRoundNumber ?? 1,
    squidSettlementPending: room.squidSettlementPending ?? false,
    squidStake: room.squidStake ?? null,
    tableStartedAt: room.tableStartedAt?.toISOString() ?? null,
  });
  return JSON.stringify(authority(left)) === JSON.stringify(authority(right));
}

function validateRelations(payload: TableSnapshotPayload, relations: SnapshotRelations, legacy: boolean): void {
  const ownerId = payload.room.ownerId ?? relations.room.ownerId;
  const payloadRoom: RuntimeRoomConfig = {
    actionTimeSeconds: payload.room.actionTimeSeconds,
    bigBlind: payload.room.bigBlind,
    bombPotBlindMultiplier: payload.room.bombPotBlindMultiplier,
    bombPotIntervalMinutes: payload.room.bombPotIntervalMinutes,
    bombPotNextAt: payload.room.bombPotNextAt === null ? null : new Date(payload.room.bombPotNextAt),
    durationMinutes: payload.room.durationMinutes,
    expiresAt: new Date(payload.room.expiresAt),
    initialBuyIn: payload.room.initialBuyIn
      ?? relations.room.initialBuyIn
      ?? Math.min(relations.room.maximumBuyIn, Math.max(relations.room.minimumBuyIn, relations.room.bigBlind * 100)),
    maximumBuyIn: payload.room.maximumBuyIn,
    maxSeats: payload.room.maxSeats,
    minimumBuyIn: payload.room.minimumBuyIn,
    name: payload.room.name,
    nextHandPaused: payload.room.nextHandPaused,
    ...(ownerId ? { ownerId } : {}),
    paidCardRevealCost: payload.room.paidCardRevealCost,
    paidCardRevealEnabled: payload.room.paidCardRevealEnabled,
    requiresManualStart: payload.room.requiresManualStart,
    runItTwiceEnabled: payload.room.runItTwiceEnabled,
    roomCode: payload.room.roomCode,
    roomId: payload.room.roomId,
    smallBlind: payload.room.smallBlind,
    specialMode: payload.room.specialMode,
    status: payload.room.status,
    squidRoundGraceEndsAt: payload.room.squidRoundGraceEndsAt === null ? null : new Date(payload.room.squidRoundGraceEndsAt),
    squidRoundNumber: payload.room.squidRoundNumber,
    squidSettlementPending: payload.room.squidSettlementPending,
    squidStake: payload.room.squidStake,
    tableStartedAt: payload.room.tableStartedAt === null ? null : new Date(payload.room.tableStartedAt),
  };
  if (!equalRoom(payloadRoom, relations.room)) fail("room-mismatch");
  const databaseSeats = [...relations.seats].sort((left, right) => left.seatIndex - right.seatIndex);
  const withoutNickname = (seat: RuntimeSeat) => ({
    gameSessionId: seat.gameSessionId,
    nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet ?? null,
    nextActionAutopilotArmed: seat.nextActionAutopilotArmed ?? false,
    pendingShowCardIndices: [...(seat.pendingShowCardIndices ?? [])],
    playStatus: seat.playStatus,
    reservedAwayEndsAt: seat.reservedAwayEndsAt?.toISOString() ?? null,
    seatId: seat.seatId,
    seatIndex: seat.seatIndex,
    stack: seat.stack,
    squidMarked: seat.squidMarked ?? false,
    squidRoundParticipant: seat.squidRoundParticipant ?? false,
    trusteeshipEnabled: seat.trusteeshipEnabled ?? false,
    userId: seat.userId,
    version: seat.version,
  });
  const hydratedPayloadSeats: RuntimeSeat[] = payload.seats.map((seat) => ({
    ...seat,
    reservedAwayEndsAt: seat.reservedAwayEndsAt === null ? null : new Date(seat.reservedAwayEndsAt),
  }));
  // Version 1 could not represent lifecycle flags; the migration backfills their defaults.
  if (legacy && databaseSeats.some((seat) => (seat.nextActionAutopilotArmed ?? false) || (seat.nextActionAutoCallCurrentBet ?? null) !== null || seat.reservedAwayEndsAt)) fail("legacy-seat-lifecycle-mismatch");
  if (JSON.stringify(hydratedPayloadSeats.map(withoutNickname)) !== JSON.stringify(databaseSeats.map(withoutNickname))) fail("seat-relation-mismatch");
  if (new Set(payload.seats.map((seat) => seat.seatIndex)).size !== payload.seats.length) fail("duplicate-seat-index");
  if (new Set(payload.seats.map((seat) => seat.userId)).size !== payload.seats.length) fail("duplicate-seat-user");
  if (new Set(payload.seats.map((seat) => seat.gameSessionId)).size !== payload.seats.length) fail("duplicate-game-session");
}

export function validateTableSnapshot(record: SnapshotRecord, relations: SnapshotRelations): TableSnapshotPayload {
  if (![LEGACY_TABLE_SNAPSHOT_SCHEMA_VERSION, PRE_SQUID_TABLE_SNAPSHOT_SCHEMA_VERSION, PRE_RUN_IT_TWICE_TABLE_SNAPSHOT_SCHEMA_VERSION, PRE_SHORT_DECK_TABLE_SNAPSHOT_SCHEMA_VERSION, PRE_BOMB_POT_TABLE_SNAPSHOT_SCHEMA_VERSION, TABLE_SNAPSHOT_SCHEMA_VERSION].includes(record.schemaVersion as 1 | 2 | 3 | 4 | 5 | 6)) fail("unsupported-schema-version");
  const parsed = TableSnapshotPayloadSchema.safeParse(normalizeTableSnapshotPayload(record.payload, relations.room));
  if (!parsed.success) fail(`payload-schema:${parsed.error.issues[0]?.path.join(".") ?? "root"}`);
  const payload = parsed.data;
  if (record.roomId !== payload.room.roomId || record.roomId !== relations.room.roomId) fail("room-id-mismatch");
  if (record.stateVersion !== payload.stateVersion) fail("state-version-mismatch");
  const recoveryErrorOverlay = record.recoveryStatus === "ERROR" && record.runtimeStatus === "RECOVERY_ERROR";
  if (!recoveryErrorOverlay && record.runtimeStatus !== payload.status) fail("runtime-status-mismatch");
  if ((record.startDeadlineAt?.toISOString() ?? null) !== payload.startCountdownAt) fail("start-deadline-mismatch");
  const hand = payload.currentHand;
  if ((record.activeHandId ?? null) !== (hand?.state.handId ?? null)) fail("active-hand-id-mismatch");
  if ((record.activeHandNumber ?? null) !== (hand?.handNumber ?? null)) fail("active-hand-number-mismatch");
  if ((record.turnDeadlineAt?.toISOString() ?? null) !== (hand?.turnDeadlineAt ?? null)) fail("turn-deadline-mismatch");
  if (hand && !["PLAYING", "CLOSING", "PERSISTENCE_ERROR"].includes(payload.status)) fail("active-hand-runtime-status");
  if (!hand && ["PLAYING"].includes(payload.status)) fail("missing-active-hand");
  validateRelations(payload, relations, record.schemaVersion === LEGACY_TABLE_SNAPSHOT_SCHEMA_VERSION);
  if (hand) {
    const state = hydrateState(hand.state);
    try { assertHandStateInvariants(state); } catch { fail("poker-invariant"); }
    if (hand.state.handId !== record.activeHandId || hand.handNumber !== record.activeHandNumber) fail("hand-header-mismatch");
    if (hand.actions.some((action, index) => action.sequence !== index + 1)) fail("action-sequence");
    const seatByUser = new Map(payload.seats.map((seat) => [seat.userId, seat]));
    for (const player of state.players) {
      const seat = seatByUser.get(player.playerId);
      if (!seat || seat.seatIndex !== player.seatIndex || seat.stack !== player.startingStack) fail("active-hand-seat-accounting");
    }
    const seatTotal = state.players.reduce((sum, player) => sum + player.startingStack, 0);
    const playerTotal = state.players.reduce((sum, player) => sum + player.stack + player.committedThisHand, 0);
    if (state.status !== "finished" && seatTotal !== playerTotal) fail("active-hand-chip-conservation");
  }
  if (payload.postHandReview) {
    const review = payload.postHandReview;
    const participants = new Set(review.hand.state.players.map((player) => player.playerId));
    if (review.voluntarilyRevealedUserIds.some((userId) => !participants.has(userId))) fail("review-reveal-non-participant");
    if (new Set(review.voluntarilyRevealedUserIds).size !== review.voluntarilyRevealedUserIds.length) fail("duplicate-review-reveal");
    for (const [userId, indices] of Object.entries(review.voluntarilyRevealedCardIndicesByUser)) {
      if (!participants.has(userId)) fail("review-card-reveal-non-participant");
      if (new Set(indices).size !== indices.length) fail("duplicate-review-card-index");
    }
  }
  return payload;
}

export function deserializeTableSnapshot(record: SnapshotRecord, relations: SnapshotRelations): RecoveredTableSnapshot {
  const payload = validateTableSnapshot(record, relations);
  const nicknameBySeat = new Map(relations.seats.map((seat) => [seat.seatIndex, seat.nickname]));
  const avatarBySeat = new Map(relations.seats.map((seat) => [seat.seatIndex, seat.avatarId]));
  return {
    currentHand: payload.currentHand === null ? null : hydrateHand(payload.currentHand),
    handNumber: payload.handNumber,
    lastButtonSeat: payload.lastButtonSeat,
    lastCompletedHand: payload.lastCompletedHand === null ? null : hydrateHand(payload.lastCompletedHand),
    postHandReview: payload.postHandReview === null ? null : {
      endsAt: new Date(payload.postHandReview.endsAt),
      hand: hydrateHand(payload.postHandReview.hand),
      voluntarilyRevealedCardIndicesByUser: Object.keys(payload.postHandReview.voluntarilyRevealedCardIndicesByUser).length > 0
        ? payload.postHandReview.voluntarilyRevealedCardIndicesByUser
        : Object.fromEntries(payload.postHandReview.voluntarilyRevealedUserIds.map((userId) => [userId, [0, 1] as const])),
      voluntarilyRevealedUserIds: payload.postHandReview.voluntarilyRevealedUserIds,
    },
    room: {
      ...relations.room,
      bombPotBlindMultiplier: payload.room.bombPotBlindMultiplier,
      bombPotIntervalMinutes: payload.room.bombPotIntervalMinutes,
      bombPotNextAt: payload.room.bombPotNextAt === null ? null : new Date(payload.room.bombPotNextAt),
      specialMode: payload.room.specialMode,
      runItTwiceEnabled: payload.room.runItTwiceEnabled,
      squidRoundGraceEndsAt: payload.room.squidRoundGraceEndsAt === null
        ? null
        : new Date(payload.room.squidRoundGraceEndsAt),
      squidRoundNumber: payload.room.squidRoundNumber,
      squidSettlementPending: payload.room.squidSettlementPending,
      squidStake: payload.room.squidStake,
    },
    seats: payload.seats.map((seat) => ({
      ...seat,
      avatarId: avatarBySeat.get(seat.seatIndex) ?? seat.avatarId,
      nickname: nicknameBySeat.get(seat.seatIndex) ?? seat.nickname,
      reservedAwayEndsAt: seat.reservedAwayEndsAt === null ? null : new Date(seat.reservedAwayEndsAt),
    })),
    snapshotRevision: record.snapshotRevision,
    startCountdownAt: payload.startCountdownAt === null ? null : new Date(payload.startCountdownAt),
    stateVersion: payload.stateVersion,
    status: payload.status,
  };
}
