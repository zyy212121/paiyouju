import { describe, expect, it } from "vitest";

import {
  HandCategory,
  evaluateFiveCards,
  parseCard,
  serializeCard,
  type HandEvaluation,
} from "./index.js";

function evaluate(...codes: readonly string[]): HandEvaluation {
  return evaluateFiveCards(codes.map(parseCard));
}

describe("five-card categories", () => {
  it.each([
    {
      name: "High Card",
      codes: ["3s", "As", "6c", "9h", "Kd"],
      category: HandCategory.HighCard,
      tiebreak: [14, 13, 9, 6, 3],
      bestFive: ["As", "Kd", "9h", "6c", "3s"],
    },
    {
      name: "One Pair",
      codes: ["2h", "Ad", "Qs", "Ah", "Kc"],
      category: HandCategory.OnePair,
      tiebreak: [14, 13, 12, 2],
      bestFive: ["Ah", "Ad", "Kc", "Qs", "2h"],
    },
    {
      name: "Two Pair",
      codes: ["3c", "Kh", "Ah", "3s", "Kd"],
      category: HandCategory.TwoPair,
      tiebreak: [13, 3, 14],
      bestFive: ["Kh", "Kd", "3s", "3c", "Ah"],
    },
    {
      name: "Three of a Kind",
      codes: ["7c", "2h", "7s", "Ah", "7d"],
      category: HandCategory.ThreeOfAKind,
      tiebreak: [7, 14, 2],
      bestFive: ["7s", "7d", "7c", "Ah", "2h"],
    },
    {
      name: "Straight",
      codes: ["7c", "9s", "5s", "8d", "6h"],
      category: HandCategory.Straight,
      tiebreak: [9],
      bestFive: ["9s", "8d", "7c", "6h", "5s"],
    },
    {
      name: "Flush",
      codes: ["5c", "Ac", "2c", "9c", "Jc"],
      category: HandCategory.Flush,
      tiebreak: [14, 11, 9, 5, 2],
      bestFive: ["Ac", "Jc", "9c", "5c", "2c"],
    },
    {
      name: "Full House",
      codes: ["4c", "Qh", "4s", "Qd", "Qs"],
      category: HandCategory.FullHouse,
      tiebreak: [12, 4],
      bestFive: ["Qs", "Qh", "Qd", "4s", "4c"],
    },
    {
      name: "Four of a Kind",
      codes: ["6d", "Ac", "6s", "6c", "6h"],
      category: HandCategory.FourOfAKind,
      tiebreak: [6, 14],
      bestFive: ["6s", "6h", "6d", "6c", "Ac"],
    },
    {
      name: "Straight Flush",
      codes: ["7h", "5h", "9h", "6h", "8h"],
      category: HandCategory.StraightFlush,
      tiebreak: [9],
      bestFive: ["9h", "8h", "7h", "6h", "5h"],
    },
  ])("evaluates $name", ({ codes, category, tiebreak, bestFive, name }) => {
    const result = evaluate(...codes);

    expect(result.category).toBe(category);
    expect(result.tiebreak).toEqual(tiebreak);
    expect(result.bestFive.map(serializeCard)).toEqual(bestFive);
    expect(result.displayName).toBe(name);
  });

  it("uses Straight Flush strength but Royal Flush as the ace-high display name", () => {
    const result = evaluate("Qs", "As", "Ts", "Ks", "Js");

    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.tiebreak).toEqual([14]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "As",
      "Ks",
      "Qs",
      "Js",
      "Ts",
    ]);
    expect(result.displayName).toBe("Royal Flush");
  });

  it("orders a wheel as five through two followed by ace and scores it five-high", () => {
    const result = evaluate("Ac", "2d", "5c", "3h", "4s");

    expect(result.category).toBe(HandCategory.Straight);
    expect(result.tiebreak).toEqual([5]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "5c",
      "4s",
      "3h",
      "2d",
      "Ac",
    ]);
  });

  it("returns the same evaluation and best-five order for every input order", () => {
    const forward = evaluate("Ah", "Ad", "Kc", "Qs", "2h");
    const reverse = evaluate("2h", "Qs", "Kc", "Ad", "Ah");

    expect(reverse).toEqual(forward);
  });
});

describe("five-card input validation", () => {
  it.each([
    ["four", ["Ac", "Kd", "Qh", "Js"]],
    ["six", ["Ac", "Kd", "Qh", "Js", "Tc", "9d"]],
  ])("rejects a %s-card input", (_label, codes) => {
    expect(() => evaluate(...codes)).toThrow(/exactly 5 unique cards/i);
  });

  it("rejects a duplicate physical card", () => {
    expect(() => evaluate("Ac", "Ac", "Qh", "Js", "Tc")).toThrow(
      /duplicate card.*Ac/i,
    );
  });
});
