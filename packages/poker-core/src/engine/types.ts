import type { Card } from "../card.js";
import type { HandEvaluation, PokerVariant } from "../hand-types.js";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type HandStatus = "active" | "runout_choice" | "finished";
export type HoleCardsVisibility = "private" | "showdown" | "hidden";

export interface TableConfig {
  readonly maxSeats: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly variant?: PokerVariant;
}

export interface SeatState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly isParticipating: boolean;
}

export interface PlayerHandState {
  readonly playerId: string;
  readonly seatIndex: number;
  readonly startingStack: number;
  readonly stack: number;
  readonly committedThisStreet: number;
  readonly committedThisHand: number;
  readonly hasFolded: boolean;
  readonly isAllIn: boolean;
  readonly hasActedThisStreet: boolean;
  readonly lastActedBetLevel: number | null;
  readonly lastActedFullRaiseSize: number | null;
  readonly holeCards: readonly [Card, Card];
  readonly holeCardsVisibility: HoleCardsVisibility;
}

export interface Pot {
  readonly amount: number;
  readonly contributors: readonly string[];
  readonly eligiblePlayers: readonly string[];
}

export interface PotAward extends Pot {
  readonly winners: readonly string[];
  readonly amountPerWinner: number;
  readonly oddChipRecipients: readonly string[];
  readonly awards: Readonly<Record<string, number>>;
}

export interface RunoutSettlement {
  readonly runoutIndex: 1 | 2;
  readonly board: readonly Card[];
  readonly pots: readonly PotAward[];
  readonly awardsByPlayer: Readonly<Record<string, number>>;
  readonly winners: readonly string[];
}

export interface SettlementResult {
  readonly pots: readonly PotAward[];
  readonly awardsByPlayer: Readonly<Record<string, number>>;
  /** Legacy snapshot/replay field. New settlements always produce an empty record. */
  readonly uncalledReturnsByPlayer: Readonly<Record<string, number>>;
  readonly finalStacks: Readonly<Record<string, number>>;
  readonly revealedPlayers: readonly string[];
  readonly winners: readonly string[];
  /** Present only when the hand was dealt and settled on two boards. */
  readonly runouts?: readonly [RunoutSettlement, RunoutSettlement];
}

export type DomainEventType =
  | "HAND_STARTED" | "BUTTON_ASSIGNED" | "BLIND_POSTED" | "HOLE_CARDS_DEALT"
  | "PLAYER_FOLDED" | "PLAYER_CHECKED" | "PLAYER_CALLED" | "PLAYER_BET"
  | "PLAYER_RAISED" | "PLAYER_ALL_IN" | "UNCALLED_BET_RETURNED"
  | "STREET_ADVANCED" | "BOARD_DEALT" | "SHOWDOWN_STARTED"
  | "CARDS_REVEALED" | "POT_AWARDED" | "RUNOUT_CHOICE_STARTED"
  | "RUNOUT_CHOICE_RESOLVED" | "HAND_FINISHED";

export interface DomainEvent {
  readonly eventType: DomainEventType;
  readonly stateVersion: number;
  readonly handId: string;
  readonly playerId?: string;
  readonly amount?: number;
  readonly seatIndex?: number;
  readonly street?: Street;
  readonly cards?: readonly Card[];
  readonly potIndex?: number;
  readonly winners?: readonly string[];
  readonly runoutIndex?: 1 | 2;
  readonly runoutCount?: 1 | 2;
}

export interface HandState {
  /** Absolute forced contribution used only by a bomb-pot hand. */
  readonly bombPotBlind?: number;
  readonly handId: string;
  readonly status: HandStatus;
  readonly street: Street;
  readonly config: TableConfig;
  readonly players: readonly PlayerHandState[];
  readonly buttonSeat: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly currentActorSeat: number | null;
  readonly currentBet: number;
  readonly lastFullRaiseSize: number;
  readonly board: readonly Card[];
  readonly deck: readonly Card[];
  readonly pots: readonly Pot[];
  readonly actionHistory: readonly DomainEvent[];
  readonly stateVersion: number;
  readonly settlement: SettlementResult | null;
  /** The first board remains in `board` for legacy consumers. */
  readonly runoutBoards?: readonly [readonly Card[], readonly Card[]];
  readonly runoutSharedCardCount?: number;
}

export type PlayerAction =
  | { readonly playerId: string; readonly actionType: "fold" | "check" | "call" | "allIn" }
  | { readonly playerId: string; readonly actionType: "bet" | "raiseTo"; readonly amount: number };

export interface LegalAction {
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly callAmount: number;
  readonly canCall: boolean;
  readonly canBet: boolean;
  readonly minimumBet: number | null;
  readonly maximumBet: number | null;
  readonly canRaise: boolean;
  readonly minimumRaiseTo: number | null;
  readonly maximumRaiseTo: number | null;
  readonly canAllIn: boolean;
  readonly allInTo: number | null;
}

export interface ActionResult {
  readonly state: HandState;
  readonly events: readonly DomainEvent[];
}

export interface StartHandInput {
  /** When present, every participant posts up to this amount and play starts on the flop. */
  readonly bombPotBlind?: number;
  readonly handId: string;
  readonly config: TableConfig;
  readonly seats: readonly SeatState[];
  readonly previousButtonSeat: number | null;
  readonly deck: readonly Card[];
  readonly deferHeadsUpAllInRunout?: boolean;
}

export interface ActionOptions {
  readonly deferHeadsUpAllInRunout?: boolean;
}

export interface EvaluatedPlayer {
  readonly playerId: string;
  readonly evaluation: HandEvaluation;
}
