import { describe, expect, it } from "vitest";

import {
  RANKS,
  SUITS,
  cardsEqual,
  createStandardDeck,
  parseCard,
  serializeCard,
  type Card,
  type Rank,
  type Suit,
} from "./index.js";

const expectedRanks: readonly Rank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];
const expectedSuits: readonly Suit[] = [
  "clubs",
  "diamonds",
  "hearts",
  "spades",
];

describe("canonical cards", () => {
  it("uses numeric ranks 2 through ace and explicit suit names", () => {
    expect(RANKS).toEqual(expectedRanks);
    expect(SUITS).toEqual(expectedSuits);
  });

  it.each([
    ["2c", { rank: 2, suit: "clubs" }],
    ["Td", { rank: 10, suit: "diamonds" }],
    ["Jh", { rank: 11, suit: "hearts" }],
    ["Qs", { rank: 12, suit: "spades" }],
    ["Kc", { rank: 13, suit: "clubs" }],
    ["As", { rank: 14, suit: "spades" }],
  ] as const)("parses and serializes %s", (code, card) => {
    expect(parseCard(code)).toEqual(card);
    expect(serializeCard(card)).toBe(code);
  });

  it.each([
    "",
    "2",
    "10c",
    "tc",
    "AC",
    "ac",
    "1c",
    "2x",
    "2cc",
    " 2c",
    "2c ",
  ])("rejects the non-canonical code %j", (code) => {
    expect(() => parseCard(code)).toThrow(/card code/i);
  });

  it("rejects invalid structured cards during serialization", () => {
    const invalidRank = { rank: 15, suit: "clubs" } as unknown as Card;
    const invalidSuit = { rank: 14, suit: "stars" } as unknown as Card;

    expect(() => serializeCard(invalidRank)).toThrow(/rank/i);
    expect(() => serializeCard(invalidSuit)).toThrow(/suit/i);
  });

  it("compares cards by rank and suit rather than object identity", () => {
    expect(cardsEqual(parseCard("Ac"), { rank: 14, suit: "clubs" })).toBe(
      true,
    );
    expect(cardsEqual(parseCard("Ac"), parseCard("As"))).toBe(false);
    expect(cardsEqual(parseCard("Ac"), parseCard("Kc"))).toBe(false);
  });
});

describe("standard deck", () => {
  it("contains exactly one of every canonical card", () => {
    const deck = createStandardDeck();
    const codes = deck.map(serializeCard);

    expect(deck).toHaveLength(52);
    expect(new Set(codes).size).toBe(52);
    expect(codes[0]).toBe("2c");
    expect(codes.at(-1)).toBe("As");
  });

  it("contains four cards per rank and thirteen cards per suit", () => {
    const deck = createStandardDeck();

    for (const rank of RANKS) {
      expect(deck.filter((card) => card.rank === rank)).toHaveLength(4);
    }

    for (const suit of SUITS) {
      expect(deck.filter((card) => card.suit === suit)).toHaveLength(13);
    }
  });

  it("returns independent deck arrays", () => {
    const first = createStandardDeck();
    const second = createStandardDeck();

    expect(first).not.toBe(second);
    expect(first.map(serializeCard)).toEqual(second.map(serializeCard));
  });
});
