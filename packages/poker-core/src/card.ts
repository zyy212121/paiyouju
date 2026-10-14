import { InvalidCardError } from "./errors.js";

export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

const rankToCode = new Map<Rank, string>([
  [2, "2"],
  [3, "3"],
  [4, "4"],
  [5, "5"],
  [6, "6"],
  [7, "7"],
  [8, "8"],
  [9, "9"],
  [10, "T"],
  [11, "J"],
  [12, "Q"],
  [13, "K"],
  [14, "A"],
]);

const codeToRank = new Map(
  [...rankToCode].map(([rank, code]) => [code, rank] as const),
);

const suitToCode = new Map<Suit, string>([
  ["clubs", "c"],
  ["diamonds", "d"],
  ["hearts", "h"],
  ["spades", "s"],
]);

const codeToSuit = new Map(
  [...suitToCode].map(([suit, code]) => [code, suit] as const),
);

export function parseCard(code: string): Card {
  if (code.length !== 2) {
    throw new InvalidCardError(`Invalid card code: ${JSON.stringify(code)}`);
  }

  const rank = codeToRank.get(code[0] ?? "");
  const suit = codeToSuit.get(code[1] ?? "");

  if (rank === undefined || suit === undefined) {
    throw new InvalidCardError(`Invalid card code: ${JSON.stringify(code)}`);
  }

  return { rank, suit };
}

export function serializeCard(card: Card): string {
  const rankCode = rankToCode.get(card.rank);
  if (rankCode === undefined) {
    throw new InvalidCardError(`Invalid card rank: ${String(card.rank)}`);
  }

  const suitCode = suitToCode.get(card.suit);
  if (suitCode === undefined) {
    throw new InvalidCardError(`Invalid card suit: ${String(card.suit)}`);
  }

  return `${rankCode}${suitCode}`;
}

export function cardsEqual(left: Card, right: Card): boolean {
  return left.rank === right.rank && left.suit === right.suit;
}
