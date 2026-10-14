import { z } from "zod";
import { AvatarIdSchema } from "./avatar.js";
import {
  isBombPotIntervalMinutes,
} from "./bomb-pot.js";

import {
  RoomChatMessageSchema,
  type RoomChatHistory,
  type RoomChatMessage,
  type RoomChatSend,
} from "./room-chat.js";

export const PROTOCOL_VERSION = 9 as const;

export const RealtimeErrorCodeSchema = z.enum([
  "SOCKET_AUTH_REQUIRED", "ROOM_ACCESS_DENIED", "ROOM_NOT_OPEN", "TABLE_NOT_AVAILABLE",
  "SEAT_OUT_OF_RANGE", "SEAT_OCCUPIED", "USER_ALREADY_SEATED", "BUY_IN_OUT_OF_RANGE",
  "INSUFFICIENT_WALLET_BALANCE", "BUY_IN_DURING_HAND", "PLAYER_NOT_SEATED", "PLAYER_NOT_ACTIVE",
  "LEAVE_AFTER_HAND_SET", "NOT_PLAYER_TURN", "HAND_ID_MISMATCH", "STALE_STATE",
  "IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS", "ACTION_IDEMPOTENCY_CONFLICT",
  "ILLEGAL_ACTION", "PERSISTENCE_ERROR", "SNAPSHOT_CONFLICT", "RECOVERY_ERROR",
  "TABLE_CLOSING", "TABLE_CLOSED", "INVALID_REQUEST",
  "ROOM_OWNER_REQUIRED", "TABLE_START_NOT_ALLOWED", "AUTOPILOT_NOT_AVAILABLE",
  "RESERVED_AWAY_NOT_AVAILABLE", "HAND_REVIEW_IN_PROGRESS", "HAND_REVIEW_CLOSED",
  "CARDS_ALREADY_PUBLIC",
  "TIME_EXTENSION_NOT_AVAILABLE",
  "SQUID_LEAVE_CONFIRMATION_REQUIRED", "SQUID_RESERVED_AWAY_DISABLED",
  "RUNOUT_CHOICE_NOT_AVAILABLE",
  "UNKNOWN_EVENT", "PAYLOAD_TOO_LARGE", "RATE_LIMITED",
]);

export const RoomIdSchema = z.string().min(1).max(64);
export const IdentifierSchema = z.string().uuid();
export const StateVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const CardCodeSchema = z.string().regex(/^[2-9TJQKA][cdhs]$/);
const NonNegativePointsSchema = z.number().int().min(0).max(2_000_000_000);
const PositivePointsSchema = z.number().int().min(1).max(2_000_000_000);
const SignedPointsSchema = z.number().int().min(-2_000_000_000).max(2_000_000_000);
const SeatIndexSchema = z.number().int().min(0).max(8);
const StreetSchema = z.enum(["preflop", "flop", "turn", "river", "showdown"]);
const PlayStatusSchema = z.enum([
  "ACTIVE", "SIT_OUT", "SIT_OUT_AFTER_HAND", "LEAVE_AFTER_HAND",
  "RESERVED_AWAY", "BUSTED_WAITING_REBUY",
]);
const RuntimeStatusSchema = z.enum([
  "IDLE", "START_COUNTDOWN", "PLAYING", "POST_HAND_REVIEW", "PAUSED", "CLOSING",
  "PERSISTENCE_ERROR", "RECOVERY_ERROR", "CLOSED",
]);
const TableRunStateSchema = z.enum([
  "WAITING_FOR_OWNER", "RUNNING", "PAUSED", "STOPPED_INSUFFICIENT_PLAYERS",
  "CLOSING", "CLOSED", "ERROR",
]);

const OperationEnvelopeSchema = z.object({
  expectedStateVersion: StateVersionSchema,
  operationId: IdentifierSchema,
  roomId: RoomIdSchema,
}).strict();

export const TableSubscribeSchema = z.object({ roomId: RoomIdSchema }).strict();
export const TableRequestStateSchema = TableSubscribeSchema;
export const SeatTakeSchema = OperationEnvelopeSchema.extend({
  buyInAmount: PositivePointsSchema,
  seatIndex: SeatIndexSchema,
}).strict();
export const BuyInCommandSchema = OperationEnvelopeSchema.extend({ amount: PositivePointsSchema }).strict();
export const SeatOperationSchema = OperationEnvelopeSchema;
export const SeatLeaveSchema = OperationEnvelopeSchema.extend({
  confirmSquidPenalty: z.boolean().optional(),
}).strict();
export const TableStartSchema = OperationEnvelopeSchema;
export const TrusteeshipSetSchema = OperationEnvelopeSchema.extend({ enabled: z.boolean() }).strict();
export const NextActionAutopilotModeSchema = z.enum(["CHECK_OR_FOLD", "CALL"]);
export const NextActionAutopilotSchema = OperationEnvelopeSchema.extend({
  mode: NextActionAutopilotModeSchema,
}).strict();
export const NextActionAutopilotCancelSchema = OperationEnvelopeSchema;
export const ReserveAwaySchema = OperationEnvelopeSchema;
export const RevealOwnCardsSchema = OperationEnvelopeSchema.extend({
  cardIndex: z.union([z.literal(0), z.literal(1)]),
  handId: IdentifierSchema,
}).strict();
export const BuyTimeExtensionSchema = OperationEnvelopeSchema.extend({
  handId: IdentifierSchema,
}).strict();
export const RunoutChoiceSchema = OperationEnvelopeSchema.extend({
  choice: z.enum(["ONCE", "TWICE"]),
  handId: IdentifierSchema,
}).strict();

export const PlayerIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }).strict(),
  z.object({ type: z.literal("check") }).strict(),
  z.object({ type: z.literal("call") }).strict(),
  z.object({ amount: PositivePointsSchema, type: z.literal("bet") }).strict(),
  z.object({ raiseTo: PositivePointsSchema, type: z.literal("raiseTo") }).strict(),
  z.object({ type: z.literal("allIn") }).strict(),
]);

export const ActionSubmitSchema = z.object({
  action: PlayerIntentSchema,
  clientActionId: IdentifierSchema,
  expectedStateVersion: StateVersionSchema,
  handId: IdentifierSchema,
  roomId: RoomIdSchema,
}).strict();

export const LegalActionProjectionSchema = z.object({
  allInTo: NonNegativePointsSchema.nullable(),
  callAmount: NonNegativePointsSchema,
  canAllIn: z.boolean(),
  canBet: z.boolean(),
  canCall: z.boolean(),
  canCheck: z.boolean(),
  canFold: z.boolean(),
  canRaise: z.boolean(),
  maximumBet: NonNegativePointsSchema.nullable(),
  maximumRaiseTo: NonNegativePointsSchema.nullable(),
  minimumBet: NonNegativePointsSchema.nullable(),
  minimumRaiseTo: NonNegativePointsSchema.nullable(),
}).strict();

function projectedAction<T extends string, S extends z.ZodRawShape>(eventType: T, shape: S) {
  return z.object({ eventType: z.literal(eventType), stateVersion: StateVersionSchema, ...shape }).strict();
}

const PlayerActionProjectionShape = { playerId: z.string().min(1), street: StreetSchema };
const PaidPlayerActionProjectionShape = { amount: NonNegativePointsSchema, ...PlayerActionProjectionShape };

export const ProjectedActionSchema = z.discriminatedUnion("eventType", [
  projectedAction("HAND_STARTED", {}),
  projectedAction("BUTTON_ASSIGNED", { seatIndex: SeatIndexSchema }),
  projectedAction("BLIND_POSTED", { amount: NonNegativePointsSchema, playerId: z.string().min(1), seatIndex: SeatIndexSchema }),
  projectedAction("HOLE_CARDS_DEALT", {}),
  projectedAction("PLAYER_FOLDED", PlayerActionProjectionShape),
  projectedAction("PLAYER_CHECKED", PlayerActionProjectionShape),
  projectedAction("PLAYER_CALLED", PaidPlayerActionProjectionShape),
  projectedAction("PLAYER_BET", PaidPlayerActionProjectionShape),
  projectedAction("PLAYER_RAISED", PaidPlayerActionProjectionShape),
  projectedAction("PLAYER_ALL_IN", PaidPlayerActionProjectionShape),
  projectedAction("UNCALLED_BET_RETURNED", { amount: NonNegativePointsSchema, playerId: z.string().min(1) }),
  projectedAction("STREET_ADVANCED", { street: StreetSchema }),
  projectedAction("BOARD_DEALT", { runoutIndex: z.union([z.literal(1), z.literal(2)]).optional(), street: StreetSchema }),
  projectedAction("SHOWDOWN_STARTED", {}),
  projectedAction("CARDS_REVEALED", {}),
  projectedAction("POT_AWARDED", { amount: NonNegativePointsSchema, potIndex: z.number().int().min(0), runoutIndex: z.union([z.literal(1), z.literal(2)]).optional(), winners: z.array(z.string().min(1)) }),
  projectedAction("RUNOUT_CHOICE_STARTED", {}),
  projectedAction("RUNOUT_CHOICE_RESOLVED", { runoutCount: z.union([z.literal(1), z.literal(2)]) }),
  projectedAction("HAND_FINISHED", { runoutCount: z.union([z.literal(1), z.literal(2)]).optional() }),
]);

export const SeatProjectionSchema = z.object({
  avatarId: AvatarIdSchema.optional(),
  committedThisHand: NonNegativePointsSchema.optional(),
  committedThisStreet: NonNegativePointsSchema,
  connected: z.boolean(),
  hasFolded: z.boolean(),
  isAllIn: z.boolean(),
  isBigBlind: z.boolean(),
  isCurrentActor: z.boolean(),
  isDealer: z.boolean(),
  isSmallBlind: z.boolean(),
  nickname: z.string().min(1).max(40),
  playStatus: PlayStatusSchema,
  publicHandLabel: z.string().min(1).max(40).nullable(),
  reservedAwayEndsAt: z.iso.datetime({ offset: true }).nullable(),
  seatIndex: SeatIndexSchema,
  stack: NonNegativePointsSchema,
  startingStack: NonNegativePointsSchema.nullable(),
  squidMarked: z.boolean(),
  squidRoundParticipant: z.boolean(),
  userId: z.string().min(1),
  voluntarilyRevealed: z.boolean(),
  voluntarilyRevealedCardIndices: z.array(z.union([z.literal(0), z.literal(1)])).max(2).optional(),
}).strict();

export const NextActionAutopilotProjectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("CHECK_OR_FOLD") }).strict(),
  z.object({
    callAmount: PositivePointsSchema,
    currentBet: PositivePointsSchema,
    mode: z.literal("CALL"),
  }).strict(),
]);

export const HandProjectionSchema = z.object({
  actionHistory: z.array(ProjectedActionSchema),
  board: z.array(CardCodeSchema).max(5),
  bombPotBlind: PositivePointsSchema.nullable().optional(),
  currentActorSeat: SeatIndexSchema.nullable(),
  currentBet: NonNegativePointsSchema,
  handId: IdentifierSchema,
  handNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  legalActions: LegalActionProjectionSchema.nullable(),
  mainPot: NonNegativePointsSchema,
  ownHoleCards: z.array(CardCodeSchema).max(2),
  publicHoleCardSlots: z.record(
    z.string().min(1),
    z.tuple([CardCodeSchema.nullable(), CardCodeSchema.nullable()]),
  ).optional(),
  publicHoleCards: z.record(z.string().min(1), z.array(CardCodeSchema).length(2)),
  runoutBoards: z.tuple([z.array(CardCodeSchema).length(5), z.array(CardCodeSchema).length(5)]).nullable(),
  runoutResults: z.tuple([
    z.object({
      ownNetResult: SignedPointsSchema.nullable(),
      runoutIndex: z.literal(1),
      totalPot: NonNegativePointsSchema,
      winnerUserIds: z.array(z.string().min(1)).max(9),
    }).strict(),
    z.object({
      ownNetResult: SignedPointsSchema.nullable(),
      runoutIndex: z.literal(2),
      totalPot: NonNegativePointsSchema,
      winnerUserIds: z.array(z.string().min(1)).max(9),
    }).strict(),
  ]).nullable(),
  runoutVote: z.object({
    deadlineAt: z.iso.datetime({ offset: true }),
    eligibleUserIds: z.array(z.string().min(1)).length(2),
    ownChoice: z.enum(["ONCE", "TWICE"]).nullable(),
    respondedUserIds: z.array(z.string().min(1)).max(2),
  }).strict().nullable(),
  sidePots: z.array(NonNegativePointsSchema),
  street: StreetSchema,
  turnDeadlineAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const OwnHandSummarySchema = z.object({
  category: z.enum([
    "HIGH_CARD", "ONE_PAIR", "TWO_PAIR", "THREE_OF_A_KIND", "STRAIGHT",
    "FLUSH", "FULL_HOUSE", "FOUR_OF_A_KIND", "STRAIGHT_FLUSH", "PREFLOP",
  ]),
  label: z.string().min(1).max(40),
}).strict();

export const LastHandSummaryProjectionSchema = z.object({
  handId: IdentifierSchema,
  handNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownNetResult: z.number().int().min(-2_000_000_000).max(2_000_000_000).nullable(),
  voluntarilyRevealedUserIds: z.array(z.string().min(1)).max(9),
  winnerUserIds: z.array(z.string().min(1)).max(9),
}).strict();

export const TableStateProjectionSchema = z.object({
  bustedRebuyRequired: z.boolean(),
  canOwnerStart: z.boolean(),
  canRevealOwnCards: z.boolean(),
  hand: HandProjectionSchema.nullable(),
  lastHandSummary: LastHandSummaryProjectionSchema.nullable(),
  nextActionAutopilot: NextActionAutopilotProjectionSchema.nullable(),
  nextActionAutopilotArmed: z.boolean(),
  ownHandSummary: OwnHandSummarySchema.nullable(),
  pendingShowCardIndices: z.array(z.union([z.literal(0), z.literal(1)])).max(2),
  postHandReviewEndsAt: z.iso.datetime({ offset: true }).nullable(),
  presenceVersion: StateVersionSchema,
  protocolVersion: z.literal(PROTOCOL_VERSION),
  recipient: z.object({ isOwner: z.boolean(), userId: z.string().min(1) }).strict(),
  reservedAwayEndsAt: z.iso.datetime({ offset: true }).nullable(),
  room: z.object({
    actionTimeSeconds: z.number().int().min(1).max(300),
    bigBlind: PositivePointsSchema,
    bombPotBlindMultiplier: z.number().int().min(1).max(10).nullable().optional(),
    bombPotIntervalMinutes: z.number().int()
      .refine(isBombPotIntervalMinutes)
      .nullable()
      .optional(),
    bombPotNextAt: z.iso.datetime({ offset: true }).nullable().optional(),
    durationMinutes: z.number().int().min(30).max(180),
    expiresAt: z.iso.datetime({ offset: true }),
    initialBuyIn: PositivePointsSchema,
    maximumBuyIn: PositivePointsSchema,
    maxSeats: z.number().int().min(2).max(9),
    minimumBuyIn: PositivePointsSchema,
    name: z.string().min(1).max(80),
    nextHandPaused: z.boolean(),
    pointFeeRates: z.object({
      actionTimeExtension: PositivePointsSchema,
      handEntry: PositivePointsSchema,
      hypotheticalRunout: PositivePointsSchema,
      paidHandReveal: PositivePointsSchema,
    }).strict(),
    requiresManualStart: z.boolean(),
    runItTwiceEnabled: z.boolean(),
    roomCode: z.string().min(1).max(32),
    roomId: RoomIdSchema,
    smallBlind: PositivePointsSchema,
    specialMode: z.enum(["NORMAL", "SQUID", "SHORT_DECK", "BOMB_POT"]),
    status: z.enum(["OPEN", "CLOSING", "CLOSED"]),
    squidRoundGraceEndsAt: z.iso.datetime({ offset: true }).nullable(),
    squidRoundNumber: z.number().int().positive(),
    squidStake: PositivePointsSchema.nullable(),
    tableStartedAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict(),
  runtimeStatus: RuntimeStatusSchema,
  seats: z.array(SeatProjectionSchema).max(9),
  startCountdownAt: z.iso.datetime({ offset: true }).nullable(),
  stateVersion: StateVersionSchema,
  tableRunState: TableRunStateSchema,
  trusteeshipEnabled: z.boolean(),
}).strict();

export const PresenceProjectionSchema = z.object({
  presenceVersion: StateVersionSchema,
  roomId: RoomIdSchema,
  users: z.array(z.object({ connected: z.boolean(), userId: z.string().min(1) }).strict()),
}).strict();

export const TableEventSchema = z.discriminatedUnion("type", [
  z.object({ event: ProjectedActionSchema, roomId: RoomIdSchema, stateVersion: StateVersionSchema, type: z.literal("HAND_EVENT") }).strict(),
  z.object({ roomId: RoomIdSchema, runtimeStatus: RuntimeStatusSchema, stateVersion: StateVersionSchema, type: z.literal("RUNTIME_STATUS_CHANGED") }).strict(),
  z.object({ recoveryStatus: z.enum(["PENDING", "READY", "ERROR"]), roomId: RoomIdSchema, type: z.literal("RECOVERY_STATUS_CHANGED") }).strict(),
]);

const CommandErrorSchema = z.object({ code: RealtimeErrorCodeSchema, message: z.string() }).strict();
export const RealtimeErrorSchema = CommandErrorSchema.extend({
  latestState: TableStateProjectionSchema.optional(),
  requestId: IdentifierSchema,
  stateVersion: StateVersionSchema.optional(),
}).strict();

export const SeatAccountingResultSchema = z.object({
  gameSessionId: z.string().min(1),
  playStatus: PlayStatusSchema,
  roomId: RoomIdSchema,
  seatId: z.string().min(1),
  seatIndex: SeatIndexSchema,
  stack: NonNegativePointsSchema,
  version: StateVersionSchema,
  walletBalance: NonNegativePointsSchema,
}).strict();

export const DetachedStackAccountingResultSchema = z.object({
  gameSessionId: z.string().min(1),
  roomId: RoomIdSchema,
  seatId: z.null(),
  stack: NonNegativePointsSchema,
  walletBalance: NonNegativePointsSchema,
}).strict();

export const BuyInAccountingResultSchema = z.union([SeatAccountingResultSchema, DetachedStackAccountingResultSchema]);

export const LeaveAccountingResultSchema = z.object({
  cashOutAmount: NonNegativePointsSchema,
  deferred: z.boolean(),
  gameSessionId: z.string().min(1),
  playStatus: z.literal("LEAVE_AFTER_HAND").nullable(),
  roomId: RoomIdSchema,
  seatId: z.string().min(1).nullable(),
  seatIndex: SeatIndexSchema,
  stack: NonNegativePointsSchema,
  version: StateVersionSchema,
  walletBalance: NonNegativePointsSchema,
}).strict();

export const SeatOperationResultSchema = z.union([SeatAccountingResultSchema, LeaveAccountingResultSchema]);

export const ActionCommandResultSchema = z.object({
  alreadyProcessed: z.boolean(),
  events: z.array(ProjectedActionSchema),
  stateVersion: StateVersionSchema,
}).strict();

export const LifecycleCommandResultSchema = z.object({
  alreadyProcessed: z.boolean(),
  stateVersion: StateVersionSchema,
}).strict();

export const ActionTimeExtensionResultSchema = z.object({
  alreadyProcessed: z.boolean(),
  cost: PositivePointsSchema,
  stateVersion: StateVersionSchema,
  turnDeadlineAt: z.iso.datetime({ offset: true }),
  walletBalance: NonNegativePointsSchema,
}).strict();

export const RunoutChoiceResultSchema = z.object({
  alreadyProcessed: z.boolean(),
  choice: z.enum(["ONCE", "TWICE"]),
  resolvedRunoutCount: z.union([z.literal(1), z.literal(2)]).nullable(),
  stateVersion: StateVersionSchema,
}).strict();

function commandAcknowledgementSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion("ok", [
    z.object({
      data: dataSchema,
      ok: z.literal(true),
      requestId: IdentifierSchema,
      stateVersion: StateVersionSchema,
    }).strict(),
    z.object({
      error: CommandErrorSchema,
      latestState: TableStateProjectionSchema.optional(),
      ok: z.literal(false),
      requestId: IdentifierSchema,
      stateVersion: StateVersionSchema.optional(),
    }).strict(),
  ]);
}

export const CommandAcknowledgementSchemas = {
  "action:submit": commandAcknowledgementSchema(ActionCommandResultSchema),
  "hand:arm-next-action-autopilot": commandAcknowledgementSchema(LifecycleCommandResultSchema),
  "hand:cancel-next-action-autopilot": commandAcknowledgementSchema(LifecycleCommandResultSchema),
  "hand:buy-time-extension": commandAcknowledgementSchema(ActionTimeExtensionResultSchema),
  "hand:reveal-own-cards": commandAcknowledgementSchema(LifecycleCommandResultSchema),
  "hand:choose-runout-count": commandAcknowledgementSchema(RunoutChoiceResultSchema),
  "seat:set-trusteeship": commandAcknowledgementSchema(LifecycleCommandResultSchema),
  "room:chat-send": commandAcknowledgementSchema(RoomChatMessageSchema),
  "seat:leave": commandAcknowledgementSchema(SeatOperationResultSchema),
  "seat:reserve-away": commandAcknowledgementSchema(SeatAccountingResultSchema),
  "seat:return": commandAcknowledgementSchema(SeatOperationResultSchema),
  "seat:sit-out": commandAcknowledgementSchema(SeatOperationResultSchema),
  "seat:take": commandAcknowledgementSchema(SeatAccountingResultSchema),
  "stack:buy-in": commandAcknowledgementSchema(BuyInAccountingResultSchema),
  "table:request-state": commandAcknowledgementSchema(TableStateProjectionSchema),
  "table:start": commandAcknowledgementSchema(LifecycleCommandResultSchema),
  "table:subscribe": commandAcknowledgementSchema(TableStateProjectionSchema),
} as const;

export type PlayerIntent = z.infer<typeof PlayerIntentSchema>;
export type TableSubscribe = z.infer<typeof TableSubscribeSchema>;
export type SeatTakeCommand = z.infer<typeof SeatTakeSchema>;
export type BuyInCommand = z.infer<typeof BuyInCommandSchema>;
export type SeatOperationCommand = z.infer<typeof SeatOperationSchema>;
export type SeatLeaveCommand = z.infer<typeof SeatLeaveSchema>;
export type ActionSubmit = z.infer<typeof ActionSubmitSchema>;
export type TableStartCommand = z.infer<typeof TableStartSchema>;
export type TrusteeshipSetCommand = z.infer<typeof TrusteeshipSetSchema>;
export type NextActionAutopilotCommand = z.infer<typeof NextActionAutopilotSchema>;
export type NextActionAutopilotCancelCommand = z.infer<typeof NextActionAutopilotCancelSchema>;
export type NextActionAutopilotMode = z.infer<typeof NextActionAutopilotModeSchema>;
export type NextActionAutopilotProjection = z.infer<typeof NextActionAutopilotProjectionSchema>;
export type ReserveAwayCommand = z.infer<typeof ReserveAwaySchema>;
export type RevealOwnCardsCommand = z.infer<typeof RevealOwnCardsSchema>;
export type BuyTimeExtensionCommand = z.infer<typeof BuyTimeExtensionSchema>;
export type RunoutChoiceCommand = z.infer<typeof RunoutChoiceSchema>;
export type ProjectedLegalActions = z.infer<typeof LegalActionProjectionSchema>;
export type ProjectedAction = z.infer<typeof ProjectedActionSchema>;
export type ProjectedSeat = z.infer<typeof SeatProjectionSchema>;
export type ProjectedHand = z.infer<typeof HandProjectionSchema>;
export type TableStateProjection = z.infer<typeof TableStateProjectionSchema>;
export type PresenceProjection = z.infer<typeof PresenceProjectionSchema>;
export type TableEvent = z.infer<typeof TableEventSchema>;
export type RealtimeError = z.infer<typeof RealtimeErrorSchema>;
export type SeatAccountingResult = z.infer<typeof SeatAccountingResultSchema>;
export type BuyInAccountingResult = z.infer<typeof BuyInAccountingResultSchema>;
export type LeaveAccountingResult = z.infer<typeof LeaveAccountingResultSchema>;
export type SeatOperationResult = z.infer<typeof SeatOperationResultSchema>;
export type ActionCommandResult = z.infer<typeof ActionCommandResultSchema>;
export type LifecycleCommandResult = z.infer<typeof LifecycleCommandResultSchema>;
export type ActionTimeExtensionResult = z.infer<typeof ActionTimeExtensionResultSchema>;
export type RunoutChoiceResult = z.infer<typeof RunoutChoiceResultSchema>;

export type CommandEventName = keyof typeof CommandAcknowledgementSchemas;
export type CommandAcknowledgementFor<E extends CommandEventName> = z.infer<(typeof CommandAcknowledgementSchemas)[E]>;
export type CommandAcknowledgement<T> =
  | { readonly data: T; readonly ok: true; readonly requestId: string; readonly stateVersion: number }
  | { readonly error: { readonly code: z.infer<typeof RealtimeErrorCodeSchema>; readonly message: string }; readonly latestState?: TableStateProjection; readonly ok: false; readonly requestId: string; readonly stateVersion?: number };

export interface CommandPayloadByEvent {
  readonly "action:submit": ActionSubmit;
  readonly "hand:arm-next-action-autopilot": NextActionAutopilotCommand;
  readonly "hand:cancel-next-action-autopilot": NextActionAutopilotCancelCommand;
  readonly "hand:buy-time-extension": BuyTimeExtensionCommand;
  readonly "hand:reveal-own-cards": RevealOwnCardsCommand;
  readonly "hand:choose-runout-count": RunoutChoiceCommand;
  readonly "room:chat-send": RoomChatSend;
  readonly "seat:leave": SeatLeaveCommand;
  readonly "seat:reserve-away": ReserveAwayCommand;
  readonly "seat:set-trusteeship": TrusteeshipSetCommand;
  readonly "seat:return": SeatOperationCommand;
  readonly "seat:sit-out": SeatOperationCommand;
  readonly "seat:take": SeatTakeCommand;
  readonly "stack:buy-in": BuyInCommand;
  readonly "table:request-state": TableSubscribe;
  readonly "table:start": TableStartCommand;
  readonly "table:subscribe": TableSubscribe;
}

export interface CommandDataByEvent {
  readonly "action:submit": ActionCommandResult;
  readonly "hand:arm-next-action-autopilot": LifecycleCommandResult;
  readonly "hand:cancel-next-action-autopilot": LifecycleCommandResult;
  readonly "hand:buy-time-extension": ActionTimeExtensionResult;
  readonly "hand:reveal-own-cards": LifecycleCommandResult;
  readonly "hand:choose-runout-count": RunoutChoiceResult;
  readonly "room:chat-send": RoomChatMessage;
  readonly "seat:leave": SeatOperationResult;
  readonly "seat:reserve-away": SeatAccountingResult;
  readonly "seat:set-trusteeship": LifecycleCommandResult;
  readonly "seat:return": SeatOperationResult;
  readonly "seat:sit-out": SeatOperationResult;
  readonly "seat:take": SeatAccountingResult;
  readonly "stack:buy-in": BuyInAccountingResult;
  readonly "table:request-state": TableStateProjection;
  readonly "table:start": LifecycleCommandResult;
  readonly "table:subscribe": TableStateProjection;
}

export type CommandAcknowledgementCallback<E extends CommandEventName> =
  (result: CommandAcknowledgement<CommandDataByEvent[E]>) => void;

export type ClientToServerEvents = {
  readonly [E in CommandEventName]: (
    payload: CommandPayloadByEvent[E],
    acknowledge: CommandAcknowledgementCallback<E>,
  ) => void;
};

export interface ServerToClientEvents {
  readonly "connection:status": (status: "connected" | "reconnecting" | "disconnected") => void;
  readonly "presence:update": (presence: PresenceProjection) => void;
  readonly "room:chat-history": (history: RoomChatHistory) => void;
  readonly "room:chat-message": (message: RoomChatMessage) => void;
  readonly "table:error": (error: RealtimeError) => void;
  readonly "table:event": (event: TableEvent) => void;
  readonly "table:state": (state: TableStateProjection) => void;
}

export interface InterServerEvents {
  readonly "table:invalidate": (payload: { readonly roomId: string }) => void;
}

export interface SocketData {
  readonly identity: {
    readonly sessionId: string;
    readonly user: {
      readonly id: string;
      readonly nickname: string;
      readonly role: "USER" | "ADMIN";
    };
  };
  readonly subscribedRooms: Set<string>;
}
