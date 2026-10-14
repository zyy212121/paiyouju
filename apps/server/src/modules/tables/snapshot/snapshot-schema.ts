import { z } from "zod";
import {
  AvatarIdSchema,
  DEFAULT_AVATAR_ID,
  isBombPotIntervalMinutes,
} from "@paiyouju/shared";

export const TABLE_SNAPSHOT_SCHEMA_VERSION = 6 as const;
export const PRE_BOMB_POT_TABLE_SNAPSHOT_SCHEMA_VERSION = 5 as const;
export const PRE_SHORT_DECK_TABLE_SNAPSHOT_SCHEMA_VERSION = 4 as const;
export const PRE_RUN_IT_TWICE_TABLE_SNAPSHOT_SCHEMA_VERSION = 3 as const;
export const PRE_SQUID_TABLE_SNAPSHOT_SCHEMA_VERSION = 2 as const;
export const LEGACY_TABLE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const CardCodeSchema = z.string().regex(/^[2-9TJQKA][cdhs]$/);
const NonNegativeIntegerSchema = z.number().int().min(0).max(2_000_000_000);
const StateVersionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const SeatIndexSchema = z.number().int().min(0).max(8);
const StreetSchema = z.enum(["preflop", "flop", "turn", "river", "showdown"]);

const DomainEventSchema = z.object({
  amount: NonNegativeIntegerSchema.optional(),
  cards: z.array(CardCodeSchema).optional(),
  eventType: z.enum([
    "HAND_STARTED", "BUTTON_ASSIGNED", "BLIND_POSTED", "HOLE_CARDS_DEALT",
    "PLAYER_FOLDED", "PLAYER_CHECKED", "PLAYER_CALLED", "PLAYER_BET",
    "PLAYER_RAISED", "PLAYER_ALL_IN", "UNCALLED_BET_RETURNED", "STREET_ADVANCED",
    "BOARD_DEALT", "SHOWDOWN_STARTED", "CARDS_REVEALED", "POT_AWARDED",
    "RUNOUT_CHOICE_STARTED", "RUNOUT_CHOICE_RESOLVED", "HAND_FINISHED",
  ]),
  handId: z.string().min(1),
  playerId: z.string().min(1).optional(),
  potIndex: z.number().int().min(0).optional(),
  runoutCount: z.union([z.literal(1), z.literal(2)]).optional(),
  runoutIndex: z.union([z.literal(1), z.literal(2)]).optional(),
  seatIndex: SeatIndexSchema.optional(),
  stateVersion: StateVersionSchema,
  street: StreetSchema.optional(),
  winners: z.array(z.string().min(1)).optional(),
}).strict();

const PlayerSchema = z.object({
  committedThisHand: NonNegativeIntegerSchema,
  committedThisStreet: NonNegativeIntegerSchema,
  hasActedThisStreet: z.boolean(),
  hasFolded: z.boolean(),
  holeCards: z.tuple([CardCodeSchema, CardCodeSchema]),
  holeCardsVisibility: z.enum(["private", "showdown", "hidden"]),
  isAllIn: z.boolean(),
  lastActedBetLevel: NonNegativeIntegerSchema.nullable(),
  lastActedFullRaiseSize: NonNegativeIntegerSchema.nullable(),
  playerId: z.string().min(1),
  seatIndex: SeatIndexSchema,
  stack: NonNegativeIntegerSchema,
  startingStack: NonNegativeIntegerSchema,
}).strict();

const PotSchema = z.object({
  amount: NonNegativeIntegerSchema,
  contributors: z.array(z.string().min(1)),
  eligiblePlayers: z.array(z.string().min(1)),
}).strict();

const PotAwardSchema = PotSchema.extend({
  amountPerWinner: NonNegativeIntegerSchema,
  awards: z.record(z.string().min(1), NonNegativeIntegerSchema),
  oddChipRecipients: z.array(z.string().min(1)),
  winners: z.array(z.string().min(1)),
}).strict();

const RunoutSettlementSchema = z.object({
  awardsByPlayer: z.record(z.string().min(1), NonNegativeIntegerSchema),
  board: z.array(CardCodeSchema).length(5),
  pots: z.array(PotAwardSchema),
  runoutIndex: z.union([z.literal(1), z.literal(2)]),
  winners: z.array(z.string().min(1)),
}).strict();

const SettlementSchema = z.object({
  awardsByPlayer: z.record(z.string().min(1), NonNegativeIntegerSchema),
  finalStacks: z.record(z.string().min(1), NonNegativeIntegerSchema),
  pots: z.array(PotAwardSchema),
  revealedPlayers: z.array(z.string().min(1)),
  uncalledReturnsByPlayer: z.record(z.string().min(1), NonNegativeIntegerSchema),
  winners: z.array(z.string().min(1)),
  runouts: z.tuple([RunoutSettlementSchema, RunoutSettlementSchema]).optional(),
}).strict();

export const SerializedHandStateSchema = z.object({
  actionHistory: z.array(DomainEventSchema),
  bigBlindSeat: SeatIndexSchema,
  board: z.array(CardCodeSchema).max(5),
  bombPotBlind: z.number().int().positive().max(2_000_000_000).nullable().default(null),
  buttonSeat: SeatIndexSchema,
  config: z.object({ bigBlind: z.number().int().positive(), maxSeats: z.number().int().min(2).max(9), smallBlind: z.number().int().positive(), variant: z.enum(["STANDARD", "SHORT_DECK"]).optional() }).strict(),
  currentActorSeat: SeatIndexSchema.nullable(),
  currentBet: NonNegativeIntegerSchema,
  deck: z.array(CardCodeSchema),
  handId: z.string().min(1),
  lastFullRaiseSize: NonNegativeIntegerSchema,
  players: z.array(PlayerSchema).min(2).max(9),
  pots: z.array(PotSchema),
  settlement: SettlementSchema.nullable(),
  runoutBoards: z.tuple([z.array(CardCodeSchema).length(5), z.array(CardCodeSchema).length(5)]).optional(),
  runoutSharedCardCount: z.number().int().min(0).max(5).optional(),
  smallBlindSeat: SeatIndexSchema,
  stateVersion: StateVersionSchema,
  status: z.enum(["active", "runout_choice", "finished"]),
  street: StreetSchema,
}).strict();

const CompletedActionSchema = z.object({
  actionType: z.enum(["FOLD", "CHECK", "CALL", "BET", "RAISE_TO", "ALL_IN"]),
  amount: NonNegativeIntegerSchema.nullable(),
  automatic: z.boolean(),
  automaticReason: z.enum(["TURN_TIMEOUT", "NEXT_DECISION_AUTOPILOT", "NEXT_DECISION_AUTO_CALL", "RESERVED_AWAY", "LEAVE_AFTER_HAND", "TRUSTEESHIP"]).nullable().optional(),
  clientActionId: z.string().uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  raiseTo: NonNegativeIntegerSchema.nullable(),
  seatIndex: SeatIndexSchema,
  sequence: z.number().int().positive(),
  stateVersion: StateVersionSchema,
  street: z.enum(["PREFLOP", "FLOP", "TURN", "RIVER", "SHOWDOWN"]),
  userId: z.string().min(1),
}).strict().transform((action) => ({
  ...action,
  automaticReason: action.automatic ? action.automaticReason ?? "TURN_TIMEOUT" : null,
}));

export const RuntimeHandSnapshotSchema = z.object({
  actions: z.array(CompletedActionSchema),
  handNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  paidCardRevealCost: NonNegativeIntegerSchema.default(0),
  paidCardRevealEnabled: z.boolean().default(false),
  runoutChoicesByUser: z.record(z.string().min(1), z.enum(["ONCE", "TWICE"])).default({}),
  runoutVote: z.object({
    choicesByUser: z.record(z.string().min(1), z.enum(["ONCE", "TWICE"])),
    deadlineAt: z.iso.datetime({ offset: true }),
    eligibleUserIds: z.tuple([z.string().min(1), z.string().min(1)]),
  }).strict().nullable().default(null),
  startedAt: z.iso.datetime({ offset: true }),
  state: SerializedHandStateSchema,
  turnDeadlineAt: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((hand, context) => {
  if (hand.paidCardRevealEnabled !== (hand.paidCardRevealCost > 0)) {
    context.addIssue({
      code: "custom",
      message: "paid card reveal must be enabled with a positive cost or disabled with zero cost",
      path: ["paidCardRevealCost"],
    });
  }
});

export const SnapshotRoomSchema = z.object({
  actionTimeSeconds: z.number().int().min(1).max(300),
  bigBlind: z.number().int().positive(),
  bombPotBlindMultiplier: z.number().int().min(1).max(10).nullable().default(null),
  bombPotIntervalMinutes: z.number().int()
    .refine(isBombPotIntervalMinutes)
    .nullable()
    .default(null),
  bombPotNextAt: z.iso.datetime({ offset: true }).nullable().default(null),
  durationMinutes: z.number().int().min(30).max(180),
  expiresAt: z.iso.datetime({ offset: true }),
  initialBuyIn: z.number().int().positive().max(2_000_000_000).optional(),
  maximumBuyIn: z.number().int().positive().max(2_000_000_000),
  maxSeats: z.number().int().min(2).max(9),
  minimumBuyIn: z.number().int().positive().max(2_000_000_000),
  name: z.string().min(1),
  nextHandPaused: z.boolean(),
  ownerId: z.string().min(1).optional(),
  paidCardRevealCost: NonNegativeIntegerSchema.default(0),
  paidCardRevealEnabled: z.boolean().default(false),
  roomCode: z.string().min(1),
  roomId: z.string().min(1),
  requiresManualStart: z.boolean().default(true),
  runItTwiceEnabled: z.boolean().default(false),
  smallBlind: z.number().int().positive(),
  specialMode: z.enum(["NORMAL", "SQUID", "SHORT_DECK", "BOMB_POT"]).default("NORMAL"),
  status: z.enum(["OPEN", "CLOSING", "CLOSED"]),
  squidRoundGraceEndsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  squidRoundNumber: z.number().int().positive().default(1),
  squidSettlementPending: z.boolean().default(false),
  squidStake: NonNegativeIntegerSchema.nullable().default(null),
  tableStartedAt: z.iso.datetime({ offset: true }).nullable().default(null),
}).strict().superRefine((room, context) => {
  if (room.paidCardRevealEnabled !== (room.paidCardRevealCost > 0)) {
    context.addIssue({
      code: "custom",
      message: "paid card reveal must be enabled with a positive cost or disabled with zero cost",
      path: ["paidCardRevealCost"],
    });
  }
  if ((room.specialMode === "SQUID") !== (room.squidStake !== null && room.squidStake > 0)) {
    context.addIssue({ code: "custom", message: "squid rooms require a positive stake", path: ["squidStake"] });
  }
  if (room.specialMode !== "SQUID" && (room.squidRoundGraceEndsAt !== null || room.squidSettlementPending)) {
    context.addIssue({ code: "custom", message: "non-squid rooms cannot carry squid round state", path: ["specialMode"] });
  }
  if (room.specialMode !== "NORMAL" && room.runItTwiceEnabled) {
    context.addIssue({ code: "custom", message: "special modes cannot run twice", path: ["runItTwiceEnabled"] });
  }
  if (room.specialMode === "SHORT_DECK" && room.initialBuyIn !== room.minimumBuyIn) {
    context.addIssue({ code: "custom", message: "short-deck initial stack must equal its lower limit", path: ["initialBuyIn"] });
  }
  if (room.specialMode === "BOMB_POT") {
    if (room.bombPotBlindMultiplier === null || room.bombPotIntervalMinutes === null) {
      context.addIssue({ code: "custom", message: "bomb-pot rooms require interval and blind settings", path: ["bombPotBlindMultiplier"] });
    }
  } else if (room.bombPotBlindMultiplier !== null || room.bombPotIntervalMinutes !== null || room.bombPotNextAt !== null) {
    context.addIssue({ code: "custom", message: "non-bomb rooms cannot carry bomb-pot state", path: ["specialMode"] });
  }
});

export const SnapshotSeatSchema = z.object({
  avatarId: AvatarIdSchema.default(DEFAULT_AVATAR_ID),
  gameSessionId: z.string().min(1),
  nickname: z.string().min(1),
  nextActionAutoCallCurrentBet: z.number().int().positive().nullable().default(null),
  nextActionAutopilotArmed: z.boolean().default(false),
  pendingShowCardIndices: z.array(z.union([z.literal(0), z.literal(1)])).max(2).default([]),
  playStatus: z.enum(["ACTIVE", "SIT_OUT", "SIT_OUT_AFTER_HAND", "LEAVE_AFTER_HAND", "RESERVED_AWAY", "BUSTED_WAITING_REBUY"]),
  reservedAwayEndsAt: z.iso.datetime({ offset: true }).nullable().default(null),
  seatId: z.string().min(1),
  seatIndex: SeatIndexSchema,
  stack: NonNegativeIntegerSchema,
  squidMarked: z.boolean().default(false),
  squidRoundParticipant: z.boolean().default(false),
  trusteeshipEnabled: z.boolean().default(false),
  userId: z.string().min(1),
  version: StateVersionSchema,
}).strict().superRefine((seat, context) => {
  if (!seat.nextActionAutopilotArmed && seat.nextActionAutoCallCurrentBet !== null) {
    context.addIssue({ code: "custom", message: "auto-call binding requires armed pre-action", path: ["nextActionAutoCallCurrentBet"] });
  }
  if (seat.squidMarked && !seat.squidRoundParticipant) {
    context.addIssue({ code: "custom", message: "a squid mark requires round participation", path: ["squidMarked"] });
  }
});

export const TableSnapshotPayloadSchema = z.object({
  currentHand: RuntimeHandSnapshotSchema.nullable(),
  handNumber: StateVersionSchema,
  lastButtonSeat: SeatIndexSchema.nullable(),
  lastCompletedHand: RuntimeHandSnapshotSchema.nullable().default(null),
  postHandReview: z.object({
    endsAt: z.iso.datetime({ offset: true }),
    hand: RuntimeHandSnapshotSchema,
    voluntarilyRevealedCardIndicesByUser: z.record(
      z.string().min(1),
      z.array(z.union([z.literal(0), z.literal(1)])).max(2),
    ).default({}),
    voluntarilyRevealedUserIds: z.array(z.string().min(1)),
  }).strict().nullable().default(null),
  room: SnapshotRoomSchema,
  seats: z.array(SnapshotSeatSchema).max(9),
  startCountdownAt: z.iso.datetime({ offset: true }).nullable(),
  stateVersion: StateVersionSchema,
  status: z.enum(["IDLE", "START_COUNTDOWN", "PLAYING", "POST_HAND_REVIEW", "PAUSED", "CLOSING", "PERSISTENCE_ERROR", "RECOVERY_ERROR", "CLOSED"]),
}).strict().superRefine((payload, context) => {
  if (payload.status === "POST_HAND_REVIEW" && (!payload.postHandReview || payload.currentHand)) {
    context.addIssue({ code: "custom", message: "post-hand review requires one completed review hand", path: ["postHandReview"] });
  }
  if (payload.postHandReview && payload.postHandReview.hand.state.status !== "finished") {
    context.addIssue({ code: "custom", message: "review hand must be finished", path: ["postHandReview", "hand", "state", "status"] });
  }
});

export type TableSnapshotPayload = z.infer<typeof TableSnapshotPayloadSchema>;
