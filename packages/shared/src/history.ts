import { z } from "zod";

import { CardCodeSchema, IdentifierSchema, RoomIdSchema } from "./realtime.js";

export const PointsSchema = z.number().int().min(-2_000_000_000).max(2_000_000_000);
export const NonNegativePointsSchema = PointsSchema.min(0);
export const PositivePointsSchema = PointsSchema.min(1);
export const HistoryCursorSchema = z.string().min(1).max(512);
export const HistoryLimitSchema = z.coerce.number().int().min(1).max(100).default(25);
export const HistoryDateSchema = z.iso.datetime({ offset: true });
export const HistorySeatIndexSchema = z.number().int().min(0).max(8);
export const HandRunoutIndexSchema = z.union([z.literal(1), z.literal(2)]);
export const HistoryErrorCodeSchema = z.enum([
  "CARD_ALREADY_PUBLIC",
  "GAME_SESSION_NOT_FOUND",
  "HAND_ACCESS_DENIED",
  "HAND_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_IN_PROGRESS",
  "INSUFFICIENT_WALLET_BALANCE",
  "INVALID_CURSOR",
  "PAID_REVEAL_DISABLED",
  "HAND_REVIEW_IN_PROGRESS",
  "ALL_CARDS_PUBLIC",
  "HYPOTHETICAL_RUNOUT_NOT_AVAILABLE",
  "PROFILE_NOT_FOUND",
  "REPLAY_NOT_AVAILABLE",
  "TARGET_IS_SELF",
  "TARGET_NOT_IN_HAND",
  "WALLET_NOT_FOUND",
]);

export const GameHistoryQuerySchema = z.object({
  cursor: HistoryCursorSchema.optional(),
  limit: HistoryLimitSchema,
  roomId: RoomIdSchema.optional(),
  status: z.enum(["ACTIVE", "CLOSED"]).optional(),
}).strict();

export const HandHistoryQuerySchema = z.object({
  cursor: HistoryCursorSchema.optional(),
  finishedFrom: HistoryDateSchema.optional(),
  finishedTo: HistoryDateSchema.optional(),
  limit: HistoryLimitSchema,
  result: z.enum(["win", "loss", "break-even"]).optional(),
  roomId: RoomIdSchema.optional(),
}).strict().superRefine((query, context) => {
  if (query.finishedFrom && query.finishedTo && Date.parse(query.finishedFrom) > Date.parse(query.finishedTo)) {
    context.addIssue({ code: "custom", message: "finishedFrom must not be after finishedTo", path: ["finishedFrom"] });
  }
});

export const HandRunoutQuerySchema = z.object({
  runoutIndex: z.coerce.number().pipe(HandRunoutIndexSchema).optional(),
}).strict();

export const RoomHistorySummarySchema = z.object({
  roomCode: z.string().length(6),
  roomId: RoomIdSchema,
  roomName: z.string().min(1).max(80),
}).strict();

export const GameSessionSummarySchema = z.object({
  currentStack: NonNegativePointsSchema.nullable(),
  endedAt: HistoryDateSchema.nullable(),
  gameSessionId: z.string().min(1).max(64),
  handsPlayed: z.number().int().min(0),
  netResult: PointsSchema.nullable(),
  provisionalNetResult: PointsSchema.nullable(),
  room: RoomHistorySummarySchema,
  seatIndex: HistorySeatIndexSchema,
  startedAt: HistoryDateSchema,
  status: z.enum(["ACTIVE", "CLOSED"]),
  totalBuyIn: NonNegativePointsSchema,
  totalCashOut: NonNegativePointsSchema,
}).strict().superRefine((game, context) => {
  if (game.status === "ACTIVE") {
    if (game.endedAt !== null || game.netResult !== null || game.currentStack === null || game.provisionalNetResult === null) {
      context.addIssue({ code: "custom", message: "active game result shape is inconsistent" });
    }
  } else if (game.endedAt === null || game.netResult === null || game.currentStack !== null || game.provisionalNetResult !== null) {
    context.addIssue({ code: "custom", message: "closed game result shape is inconsistent" });
  }
});

export const HistoryPageSchema = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  nextCursor: HistoryCursorSchema.nullable(),
}).strict();

export const HandSummarySchema = z.object({
  board: z.array(CardCodeSchema).max(5),
  displayHandNumber: z.string().regex(/^\d+(?:-[12])?$/),
  finishReason: z.enum(["FOLD_TO_WIN", "SHOWDOWN"]),
  finishedAt: HistoryDateSchema,
  handId: IdentifierSchema,
  handNumber: z.number().int().positive(),
  runoutIndex: HandRunoutIndexSchema.nullable(),
  hiddenOpponentCount: z.number().int().min(0).max(9),
  netResult: PointsSchema.nullable(),
  ownHoleCards: z.tuple([CardCodeSchema, CardCodeSchema]).nullable(),
  paidCardRevealCost: NonNegativePointsSchema,
  paidCardRevealEnabled: z.boolean(),
  room: RoomHistorySummarySchema,
  seatIndex: HistorySeatIndexSchema.nullable(),
  splitPot: z.boolean(),
  startingStack: NonNegativePointsSchema.nullable(),
  endingStack: NonNegativePointsSchema.nullable(),
  viewerParticipated: z.boolean(),
  wonAnyPot: z.boolean().nullable(),
}).strict().superRefine((hand, context) => {
  const privateResultFields = [hand.netResult, hand.ownHoleCards, hand.seatIndex, hand.startingStack, hand.endingStack, hand.wonAnyPot];
  if (hand.viewerParticipated && privateResultFields.some((value) => value === null)) {
    context.addIssue({ code: "custom", message: "participant hand summary requires private result fields" });
  }
  if (!hand.viewerParticipated && privateResultFields.some((value) => value !== null)) {
    context.addIssue({ code: "custom", message: "spectator hand summary cannot carry participant result fields" });
  }
});

export const HoleCardsVisibilitySchema = z.enum([
  "OWN", "PUBLIC_SHOWDOWN", "PUBLIC_VOLUNTARY", "PURCHASED", "HIDDEN",
]);

const HistoryPlayerBaseSchema = z.object({
  allIn: z.boolean(),
  committed: NonNegativePointsSchema,
  endingStack: NonNegativePointsSchema,
  folded: z.boolean(),
  handLabel: z.string().min(1).max(40).nullable(),
  netResult: PointsSchema,
  nickname: z.string().min(1).max(40),
  seatIndex: HistorySeatIndexSchema,
  startingStack: NonNegativePointsSchema,
  userId: z.string().min(1).max(64),
});

export const HandDetailPlayerSchema = z.discriminatedUnion("holeCardsVisibility", [
  HistoryPlayerBaseSchema.extend({
    holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
    holeCardsVisibility: z.literal("OWN"),
  }).strict(),
  HistoryPlayerBaseSchema.extend({
    holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
    holeCardsVisibility: z.literal("PUBLIC_SHOWDOWN"),
  }).strict(),
  HistoryPlayerBaseSchema.extend({
    holeCards: z.tuple([CardCodeSchema.nullable(), CardCodeSchema.nullable()]).refine(
      (cards) => cards.some((card) => card !== null),
      { message: "at least one voluntarily revealed card is required" },
    ),
    holeCardsVisibility: z.literal("PUBLIC_VOLUNTARY"),
  }).strict(),
  HistoryPlayerBaseSchema.extend({
    holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
    holeCardsVisibility: z.literal("PURCHASED"),
  }).strict(),
  HistoryPlayerBaseSchema.extend({
    holeCards: z.null(),
    holeCardsVisibility: z.literal("HIDDEN"),
  }).strict(),
]).superRefine((player, context) => {
  const fullyVisible = player.holeCards !== null && player.holeCards.every((card) => card !== null);
  if (!fullyVisible && player.handLabel !== null) {
    context.addIssue({ code: "custom", message: "hidden or partial hole cards cannot expose a hand label", path: ["handLabel"] });
  }
});

export const HistoryStreetSchema = z.enum(["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]);
export const HistoryEventTypeSchema = z.enum([
  "HAND_STARTED",
  "BLIND_POSTED",
  "PLAYER_FOLDED",
  "PLAYER_CHECKED",
  "PLAYER_CALLED",
  "PLAYER_BET",
  "PLAYER_RAISED",
  "PLAYER_ALL_IN",
  "UNCALLED_BET_RETURNED",
  "FLOP_DEALT",
  "TURN_DEALT",
  "RIVER_DEALT",
  "SHOWDOWN",
  "CARDS_REVEALED",
  "POT_AWARDED",
  "ODD_CHIP_AWARDED",
  "HAND_FINISHED",
]);

export const HistoryEventSchema = z.object({
  actorSeat: HistorySeatIndexSchema.nullable(),
  actorUserId: z.string().min(1).max(64).nullable(),
  amount: NonNegativePointsSchema.nullable(),
  automatic: z.boolean(),
  cards: z.array(CardCodeSchema).max(5).nullable(),
  potIndex: z.number().int().min(0).nullable(),
  raiseTo: NonNegativePointsSchema.nullable(),
  sequence: z.number().int().min(0),
  stateVersion: z.number().int().min(0).nullable(),
  street: HistoryStreetSchema,
  type: HistoryEventTypeSchema,
  visibility: z.enum(["PUBLIC", "PURCHASED_AFTER_HAND"]).nullable(),
  winners: z.array(z.string().min(1).max(64)),
}).strict();

export const HandPotSchema = z.object({
  amount: NonNegativePointsSchema,
  contributors: z.array(z.string().min(1).max(64)),
  eligiblePlayers: z.array(z.string().min(1).max(64)),
  oddChipRecipients: z.array(z.string().min(1).max(64)),
  potIndex: z.number().int().min(0),
  winners: z.array(z.string().min(1).max(64)),
}).strict();

export const HandSettlementSchema = z.object({
  totalCommitted: NonNegativePointsSchema,
  totalPot: NonNegativePointsSchema,
  uncalledReturnTotal: NonNegativePointsSchema,
  winnerUserIds: z.array(z.string().min(1).max(64)),
}).strict();

export const HypotheticalRunoutResultSchema = z.object({
  actualBoard: z.array(CardCodeSchema).max(4),
  cards: z.array(CardCodeSchema).min(1).max(5),
  createdAt: HistoryDateSchema,
  generationSource: z.enum(["ORIGINAL_REMAINING_DECK", "CSPRNG_LEGACY_FALLBACK"]),
  handId: IdentifierSchema,
  simulatedBoard: z.array(CardCodeSchema).length(5),
}).strict().superRefine((result, context) => {
  if (result.actualBoard.length + result.cards.length !== 5) {
    context.addIssue({ code: "custom", message: "hypothetical cards must complete the board", path: ["cards"] });
  }
  if (new Set(result.simulatedBoard).size !== 5) {
    context.addIssue({ code: "custom", message: "hypothetical board cards must be unique", path: ["simulatedBoard"] });
  }
});

export const HandDetailSchema = z.object({
  actions: z.array(HistoryEventSchema),
  bigBlindAmount: PositivePointsSchema,
  bigBlindSeat: HistorySeatIndexSchema,
  board: z.array(CardCodeSchema).max(5),
  bombPotBlindAmount: PositivePointsSchema.nullable().optional(),
  buttonSeat: HistorySeatIndexSchema,
  finishReason: z.enum(["FOLD_TO_WIN", "SHOWDOWN"]),
  finishedAt: HistoryDateSchema,
  handId: IdentifierSchema,
  handNumber: z.number().int().positive(),
  displayHandNumber: z.string().regex(/^\d+(?:-[12])?$/),
  hypotheticalRunout: HypotheticalRunoutResultSchema.nullable(),
  ownResult: PointsSchema.nullable(),
  paidRevealConfig: z.object({
    cost: NonNegativePointsSchema,
    enabled: z.boolean(),
  }).strict(),
  reviewEndsAt: HistoryDateSchema.nullable(),
  players: z.array(HandDetailPlayerSchema).min(2).max(9),
  pots: z.array(HandPotSchema),
  room: RoomHistorySummarySchema,
  runoutIndex: HandRunoutIndexSchema.nullable(),
  settlement: HandSettlementSchema,
  smallBlindAmount: PositivePointsSchema,
  smallBlindSeat: HistorySeatIndexSchema,
  startedAt: HistoryDateSchema,
}).strict();

export const GameSessionDetailSchema = GameSessionSummarySchema.extend({
  hands: z.array(HandSummarySchema),
}).strict();

export const ReplayPlayerSchema = z.object({
  allIn: z.boolean(),
  committed: NonNegativePointsSchema,
  folded: z.boolean(),
  holeCards: z.tuple([CardCodeSchema, CardCodeSchema]).nullable(),
  holeCardsVisibility: HoleCardsVisibilitySchema,
  nickname: z.string().min(1).max(40),
  seatIndex: HistorySeatIndexSchema,
  stack: NonNegativePointsSchema,
  userId: z.string().min(1).max(64),
}).strict().superRefine((player, context) => {
  if (player.holeCardsVisibility === "HIDDEN" && player.holeCards !== null) {
    context.addIssue({ code: "custom", message: "hidden replay player cannot carry hole cards", path: ["holeCards"] });
  }
  if (player.holeCardsVisibility !== "HIDDEN" && player.holeCards === null) {
    context.addIssue({ code: "custom", message: "visible replay player requires hole cards", path: ["holeCards"] });
  }
});

export const ReplayStateSchema = z.object({
  board: z.array(CardCodeSchema).max(5),
  players: z.array(ReplayPlayerSchema).min(2).max(9),
  pot: NonNegativePointsSchema,
  pots: z.array(NonNegativePointsSchema),
  street: HistoryStreetSchema,
  winners: z.array(z.string().min(1).max(64)),
}).strict();

export const ReplayInitialStateSchema = ReplayStateSchema.extend({
  bigBlindSeat: HistorySeatIndexSchema,
  blinds: z.object({
    bigBlind: PositivePointsSchema,
    smallBlind: PositivePointsSchema,
  }).strict(),
  buttonSeat: HistorySeatIndexSchema,
  ownHoleCards: z.tuple([CardCodeSchema, CardCodeSchema]).nullable(),
  publicHoleCardsAtStart: z.array(z.object({
    holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
    userId: z.string().min(1).max(64),
  }).strict()),
  smallBlindSeat: HistorySeatIndexSchema,
  startingStacks: z.array(z.object({
    stack: NonNegativePointsSchema,
    userId: z.string().min(1).max(64),
  }).strict()).min(2).max(9),
}).strict();

export const HandReplaySchema = z.object({
  events: z.array(HistoryEventSchema),
  finalState: ReplayStateSchema,
  handId: IdentifierSchema,
  initialState: ReplayInitialStateSchema,
  schemaVersion: z.literal(1),
}).strict();

export const PaidCardRevealInputSchema = z.object({
  operationId: IdentifierSchema,
  targetUserId: z.string().min(1).max(64),
}).strict();

export const PaidCardRevealResultSchema = z.object({
  alreadyOwned: z.boolean(),
  cost: PositivePointsSchema,
  holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
  operationId: IdentifierSchema,
  paidCardRevealId: z.string().min(1).max(64),
  targetUserId: z.string().min(1).max(64),
  walletBalance: NonNegativePointsSchema,
}).strict();

export const PaidHandRevealInputSchema = z.object({
  operationId: IdentifierSchema,
}).strict();

export const PaidHandRevealResultSchema = z.object({
  alreadyOwned: z.boolean(),
  cost: NonNegativePointsSchema,
  operationId: IdentifierSchema,
  paidHandRevealPurchaseId: z.string().min(1).max(64).nullable(),
  revealedPlayerCount: z.number().int().min(0).max(9),
  walletBalance: NonNegativePointsSchema,
}).strict();

export const HypotheticalRunoutInputSchema = z.object({
  operationId: IdentifierSchema,
}).strict();

export const HypotheticalRunoutPurchaseResultSchema = z.object({
  alreadyOwned: z.boolean(),
  cost: PositivePointsSchema,
  operationId: IdentifierSchema,
  runout: HypotheticalRunoutResultSchema,
  walletBalance: NonNegativePointsSchema,
}).strict();

export type GameHistoryQuery = z.infer<typeof GameHistoryQuerySchema>;
export type HandHistoryQuery = z.infer<typeof HandHistoryQuerySchema>;
export type HandRunoutQuery = z.infer<typeof HandRunoutQuerySchema>;
export type GameSessionSummary = z.infer<typeof GameSessionSummarySchema>;
export type GameSessionDetail = z.infer<typeof GameSessionDetailSchema>;
export type HandSummary = z.infer<typeof HandSummarySchema>;
export type HandDetailPlayer = z.infer<typeof HandDetailPlayerSchema>;
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;
export type HandDetail = z.infer<typeof HandDetailSchema>;
export type ReplayPlayer = z.infer<typeof ReplayPlayerSchema>;
export type ReplayState = z.infer<typeof ReplayStateSchema>;
export type ReplayInitialState = z.infer<typeof ReplayInitialStateSchema>;
export type HandReplay = z.infer<typeof HandReplaySchema>;
export type PaidCardRevealInput = z.infer<typeof PaidCardRevealInputSchema>;
export type PaidCardRevealResult = z.infer<typeof PaidCardRevealResultSchema>;
export type PaidHandRevealInput = z.infer<typeof PaidHandRevealInputSchema>;
export type PaidHandRevealResult = z.infer<typeof PaidHandRevealResultSchema>;
export type HypotheticalRunoutInput = z.infer<typeof HypotheticalRunoutInputSchema>;
export type HypotheticalRunoutResult = z.infer<typeof HypotheticalRunoutResultSchema>;
export type HypotheticalRunoutPurchaseResult = z.infer<typeof HypotheticalRunoutPurchaseResultSchema>;
export type HistoryErrorCode = z.infer<typeof HistoryErrorCodeSchema>;
