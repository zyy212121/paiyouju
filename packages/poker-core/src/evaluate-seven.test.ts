import { describe, expect, it } from "vitest";

import {
  HandCategory,
  evaluateSevenCards,
  parseCard,
  serializeCard,
  type HandEvaluation,
} from "./index.js";

function evaluate(...codes: readonly string[]): HandEvaluation {
  return evaluateSevenCards(codes.map(parseCard));
}

describe("seven-card best-five selection", () => {
  it("uses the five-card board when it is already a royal flush", () => {
    const result = evaluate("2c", "3d", "As", "Ks", "Qs", "Js", "Ts");

    expect(result.category).toBe(HandCategory.StraightFlush);
    expect(result.displayName).toBe("Royal Flush");
    expect(result.bestFive.map(serializeCard)).toEqual([
      "As",
      "Ks",
      "Qs",
      "Js",
      "Ts",
    ]);
  });

  it("can use both of the first two cards when both improve the best five", () => {
    const result = evaluate("Ah", "Ad", "Ac", "Kd", "7s", "4c", "2h");
    const codes = result.bestFive.map(serializeCard);

    expect(result.category).toBe(HandCategory.ThreeOfAKind);
    expect(codes).toEqual(["Ah", "Ad", "Ac", "Kd", "7s"]);
    expect(codes).toContain("Ah");
    expect(codes).toContain("Ad");
  });

  it("can use exactly one of the first two cards", () => {
    const result = evaluate("Ah", "2d", "Ac", "Kd", "Qh", "Js", "9c");
    const codes = result.bestFive.map(serializeCard);

    expect(result.category).toBe(HandCategory.OnePair);
    expect(codes).toEqual(["Ah", "Ac", "Kd", "Qh", "Js"]);
    expect(codes).not.toContain("2d");
  });

  it("can use neither of the first two cards", () => {
    const result = evaluate("2c", "3d", "Ah", "Kh", "Qh", "Jh", "Th");

    expect(result.bestFive.map(serializeCard)).toEqual([
      "Ah",
      "Kh",
      "Qh",
      "Jh",
      "Th",
    ]);
  });

  it("chooses a flush when the seven cards also contain a wheel straight", () => {
    const result = evaluate("Ah", "9h", "7h", "4h", "2h", "5d", "3c");

    expect(result.category).toBe(HandCategory.Flush);
    expect(result.tiebreak).toEqual([14, 9, 7, 4, 2]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "Ah",
      "9h",
      "7h",
      "4h",
      "2h",
    ]);
  });

  it("chooses the strongest full house when two trip ranks exist", () => {
    const result = evaluate("Ah", "Ad", "Ac", "Kh", "Kd", "Ks", "2c");

    expect(result.category).toBe(HandCategory.FullHouse);
    expect(result.tiebreak).toEqual([14, 13]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "Ah",
      "Ad",
      "Ac",
      "Ks",
      "Kh",
    ]);
  });

  it("chooses the highest of several available straights", () => {
    const result = evaluate("9c", "8d", "7h", "6s", "5c", "4d", "3h");

    expect(result.category).toBe(HandCategory.Straight);
    expect(result.tiebreak).toEqual([9]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "9c",
      "8d",
      "7h",
      "6s",
      "5c",
    ]);
  });

  it("chooses a six-high straight when a wheel also exists", () => {
    const result = evaluate("Ah", "2d", "3c", "4s", "5h", "6d", "Kc");

    expect(result.category).toBe(HandCategory.Straight);
    expect(result.tiebreak).toEqual([6]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "6d",
      "5h",
      "4s",
      "3c",
      "2d",
    ]);
  });

  it("selects the two highest pairs and strongest remaining kicker", () => {
    const result = evaluate("Ah", "Ad", "Kh", "Kd", "Qh", "Qd", "2c");

    expect(result.category).toBe(HandCategory.TwoPair);
    expect(result.tiebreak).toEqual([14, 13, 12]);
    expect(result.bestFive.map(serializeCard)).toEqual([
      "Ah",
      "Ad",
      "Kh",
      "Kd",
      "Qh",
    ]);
  });

  it("prefers a full house over the visually prominent ace pair and king pair", () => {
    const result = evaluate("Ah", "Ad", "Ac", "Kh", "Kd", "Qh", "Jh");

    expect(result.category).toBe(HandCategory.FullHouse);
    expect(result.tiebreak).toEqual([14, 13]);
  });

  it("returns the identical evaluation for every input order", () => {
    const forward = evaluate("Ah", "Ad", "Ac", "Kh", "Kd", "Ks", "2c");
    const reverse = evaluate("2c", "Ks", "Kd", "Kh", "Ac", "Ad", "Ah");

    expect(reverse).toEqual(forward);
  });

  it("uses a deterministic suit-only selector between equal best-five combinations", () => {
    const result = evaluate("Ah", "Ad", "Ac", "Kh", "Kd", "Ks", "2c");

    expect(result.bestFive.map(serializeCard)).toEqual([
      "Ah",
      "Ad",
      "Ac",
      "Ks",
      "Kh",
    ]);
  });
});

describe("seven-card validation", () => {
  it.each([
    ["six", ["Ac", "Kd", "Qh", "Js", "Tc", "9d"]],
    ["eight", ["Ac", "Kd", "Qh", "Js", "Tc", "9d", "8h", "7s"]],
  ])("rejects a %s-card input", (_label, codes) => {
    expect(() => evaluate(...codes)).toThrow(/exactly 7 unique cards/i);
  });

  it("rejects duplicate physical cards", () => {
    expect(() =>
      evaluate("Ac", "Ac", "Qh", "Js", "Tc", "9d", "8h"),
    ).toThrow(/duplicate card.*Ac/i);
  });
});
