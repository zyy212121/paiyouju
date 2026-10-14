import type { Card } from "./card.js";

export enum HandCategory {
  HighCard = 0,
  OnePair = 1,
  TwoPair = 2,
  ThreeOfAKind = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  FourOfAKind = 7,
  StraightFlush = 8,
}

export type PokerVariant = "STANDARD" | "SHORT_DECK";

export interface HandEvaluation {
  readonly category: HandCategory;
  readonly tiebreak: readonly number[];
  readonly bestFive: readonly Card[];
  readonly displayName: string;
}
