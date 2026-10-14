import { describe, expect, it } from "vitest";

import {
  compareHandStrength,
  evaluateFiveCards,
  parseCard,
  type HandEvaluation,
} from "./index.js";

function evaluate(codes: string): HandEvaluation {
  return evaluateFiveCards(codes.split(" ").map(parseCard));
}

function expectStronger(stronger: string, weaker: string): void {
  const strong = evaluate(stronger);
  const weak = evaluate(weaker);

  expect(compareHandStrength(strong, weak)).toBeGreaterThan(0);
  expect(compareHandStrength(weak, strong)).toBeLessThan(0);
}

describe("category and tiebreak comparison", () => {
  it("orders all categories from High Card through Straight Flush", () => {
    const hands = [
      "As Kd 9h 6c 3s",
      "Ah Ad Kc Qs 2h",
      "Kh Kd 3s 3c Ah",
      "7s 7d 7c Ah 2h",
      "9s 8d 7c 6h 5s",
      "Ac Jc 9c 5c 2c",
      "Qs Qh Qd 4s 4c",
      "6s 6h 6d 6c Ac",
      "9h 8h 7h 6h 5h",
    ].map(evaluate);

    for (let index = 1; index < hands.length; index += 1) {
      const weaker = hands[index - 1];
      const stronger = hands[index];
      expect(weaker).toBeDefined();
      expect(stronger).toBeDefined();
      expect(compareHandStrength(stronger!, weaker!)).toBeGreaterThan(0);
    }
  });

  it.each([
    ["first kicker", "Ah Ad Ks Qc 9h", "As Ac Qh Jd Tc"],
    ["second kicker", "Ah Ad Ks Qc 9h", "As Ac Kh Jd Tc"],
    ["third kicker", "Ah Ad Ks Qc 9h", "As Ac Kh Qd 8c"],
  ])("compares One Pair by the %s", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it.each([
    ["higher pair", "Ah Ad 2s 2c Kh", "Ks Kd Qs Qc Ah"],
    ["lower pair", "Ah Ad Qs Qc 2h", "As Ac Js Jc Kh"],
    ["kicker", "Ah Ad Qs Qc Kh", "As Ac Qh Qd Jh"],
  ])("compares Two Pair by the %s", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it.each([
    ["trip rank", "7s 7h 7d Ac Kc", "6s 6h 6d As Ks"],
    ["first kicker", "7s 7h 7d Ac Qc", "7c 7h 7d Ks Qs"],
    ["second kicker", "7s 7h 7d Ac Qc", "7c 7h 7d As Js"],
  ])("compares Three of a Kind by the %s", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it("compares straights by their highest rank and treats the wheel as five-high", () => {
    expectStronger("7s 6h 5d 4c 3s", "6s 5h 4d 3c 2s");
    expectStronger("6s 5h 4d 3c 2s", "As 5h 4d 3c 2s");
  });

  it.each([
    ["first", "Ac Jc 9c 5c 2c", "Kh Qh Jh 9h 8h"],
    ["second", "Ac Jc 9c 5c 2c", "Ah Th 9h 8h 7h"],
    ["third", "Ac Jc 9c 5c 2c", "Ah Jh 8h 7h 6h"],
    ["fourth", "Ac Jc 9c 5c 2c", "Ah Jh 9h 4h 3h"],
    ["fifth", "Ac Jc 9c 5c 3c", "Ah Jh 9h 5h 2h"],
  ])("compares Flush by the %s rank", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it.each([
    ["trip rank", "Qs Qh Qd 2s 2c", "Js Jh Jd As Ac"],
    ["pair rank", "Qs Qh Qd 4s 4c", "Qc Qd Qs 3h 3c"],
  ])("compares Full House by the %s", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it.each([
    ["quad rank", "6s 6h 6d 6c 2c", "5s 5h 5d 5c Ac"],
    ["kicker", "6s 6h 6d 6c Ac", "6s 6h 6d 6c Kc"],
  ])("compares Four of a Kind by the %s", (_label, stronger, weaker) => {
    expectStronger(stronger, weaker);
  });

  it("compares Straight Flush by highest rank", () => {
    expectStronger("9h 8h 7h 6h 5h", "8s 7s 6s 5s 4s");
  });

  it("ties royal flushes whose ranks are equal but suits differ", () => {
    const spades = evaluate("As Ks Qs Js Ts");
    const hearts = evaluate("Ah Kh Qh Jh Th");

    expect(compareHandStrength(spades, hearts)).toBe(0);
    expect(compareHandStrength(hearts, spades)).toBe(0);
  });

  it("returns zero when comparing an evaluation with itself", () => {
    const hand = evaluate("Ah Ad Ks Qc 9h");

    expect(compareHandStrength(hand, hand)).toBe(0);
  });
});
