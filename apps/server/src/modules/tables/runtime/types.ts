import type { HandState } from "@paiyouju/poker-core";
import type { ActionCommandResult, AvatarId } from "@paiyouju/shared";
import type { CompletedActionInput } from "../hand-persistence.service.js";

export type RuntimeStatus =
  | "IDLE"
  | "START_COUNTDOWN"
  | "PLAYING"
  | "POST_HAND_REVIEW"
  | "PAUSED"
  | "CLOSING"
  | "PERSISTENCE_ERROR"
  | "RECOVERY_ERROR"
  | "CLOSED";

export interface RuntimeRoomConfig {
  readonly actionTimeSeconds: number;
  readonly bigBlind: number;
  readonly bombPotBlindMultiplier?: number | null;
  readonly bombPotIntervalMinutes?: number | null;
  readonly bombPotNextAt?: Date | null;
  readonly durationMinutes: number;
  readonly expiresAt: Date;
  /** Missing only in pre-stack-continuity fixtures and snapshots. */
  readonly initialBuyIn?: number;
  readonly maximumBuyIn: number;
  readonly maxSeats: number;
  readonly minimumBuyIn: number;
  readonly name: string;
  readonly nextHandPaused: boolean;
  /** Missing only while decoding pre-Step-6.5 fixtures/snapshots. */
  readonly ownerId?: string;
  readonly paidCardRevealCost?: number;
  readonly paidCardRevealEnabled?: boolean;
  readonly roomCode: string;
  readonly roomId: string;
  readonly requiresManualStart?: boolean;
  readonly runItTwiceEnabled?: boolean;
  readonly smallBlind: number;
  readonly specialMode?: "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT";
  readonly status: "OPEN" | "CLOSING" | "CLOSED";
  readonly squidRoundGraceEndsAt?: Date | null;
  readonly squidRoundNumber?: number;
  readonly squidSettlementPending?: boolean;
  readonly squidStake?: number | null;
  readonly tableStartedAt?: Date | null;
}

export interface RuntimeSeat {
  readonly avatarId?: AvatarId;
  readonly gameSessionId: string;
  readonly nickname: string;
  readonly nextActionAutoCallCurrentBet?: number | null;
  readonly nextActionAutopilotArmed?: boolean;
  readonly pendingShowCardIndices?: readonly HoleCardIndex[];
  readonly playStatus:
    | "ACTIVE"
    | "SIT_OUT"
    | "SIT_OUT_AFTER_HAND"
    | "LEAVE_AFTER_HAND"
    | "RESERVED_AWAY"
    | "BUSTED_WAITING_REBUY";
  readonly reservedAwayEndsAt?: Date | null;
  readonly seatId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly squidMarked?: boolean;
  readonly squidRoundParticipant?: boolean;
  readonly trusteeshipEnabled?: boolean;
  readonly userId: string;
  readonly version: number;
}

export interface ProcessedAction {
  readonly fingerprint: string;
  readonly handId: string;
  readonly result: ActionCommandResult;
}

export interface RuntimeHand {
  readonly actions: CompletedActionInput[];
  readonly handNumber: number;
  readonly paidCardRevealCost: number;
  readonly paidCardRevealEnabled: boolean;
  runoutChoicesByUser?: Readonly<Record<string, RunoutChoice>>;
  readonly startedAt: Date;
  runoutVote?: RuntimeRunoutVote | null;
  state: HandState;
  turnDeadlineAt: Date | null;
}

export type RunoutChoice = "ONCE" | "TWICE";

export interface RuntimeRunoutVote {
  readonly choicesByUser: Readonly<Record<string, RunoutChoice>>;
  readonly deadlineAt: Date;
  readonly eligibleUserIds: readonly [string, string];
}

export type HoleCardIndex = 0 | 1;

export interface RuntimePostHandReview {
  readonly endsAt: Date;
  readonly hand: RuntimeHand;
  readonly voluntarilyRevealedCardIndicesByUser: Readonly<Record<string, readonly HoleCardIndex[]>>;
  readonly voluntarilyRevealedUserIds: readonly string[];
}
