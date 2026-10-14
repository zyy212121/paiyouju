import { PokerCoreError } from "../errors.js";

export type PokerRuleErrorCode =
  | "NOT_PLAYER_TURN" | "PLAYER_NOT_IN_HAND" | "PLAYER_ALREADY_FOLDED"
  | "PLAYER_ALL_IN" | "ILLEGAL_CHECK" | "ILLEGAL_CALL" | "ILLEGAL_BET"
  | "ILLEGAL_RAISE" | "RAISE_BELOW_MINIMUM" | "AMOUNT_EXCEEDS_STACK"
  | "HAND_NOT_ACTIVE" | "INSUFFICIENT_ACTIVE_PLAYERS" | "INVALID_TABLE_CONFIG"
  | "INVALID_SEAT_STATE" | "INVALID_DECK" | "STATE_INVARIANT_VIOLATION";

export class PokerRuleError extends PokerCoreError {
  public constructor(
    public readonly code: PokerRuleErrorCode,
    message: string,
    public readonly context: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}
