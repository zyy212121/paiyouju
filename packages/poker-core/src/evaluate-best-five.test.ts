import { describe, expect, it } from "vitest";

import { parseCard } from "./card.js";
import { evaluateBestFiveCards } from "./evaluate-best-five.js";
import { HandCategory } from "./hand-types.js";

const cards = (codes: string) => codes.split(" ").map(parseCard);

describe("evaluateBestFiveCards", () => {
  it.each([
    ["Kc Kd 2c 7d 9h", HandCategory.OnePair],
    ["Kc Kd 2c 7d 9h 2d", HandCategory.TwoPair],
    ["Kc Kd 2c 7d 9h 2d Kh", HandCategory.FullHouse],
  ])("evaluates the best current hand from %s", (input, category) => {
    expect(evaluateBestFiveCards(cards(input)).category).toBe(category);
  });

  it("rejects out-of-range and duplicate inputs", () => {
    expect(() => evaluateBestFiveCards(cards("Kc Kd 2c 7d"))).toThrow(/5, 6, or 7/u);
    expect(() => evaluateBestFiveCards(cards("Kc Kd 2c 7d 7d"))).toThrow(/Duplicate/u);
  });
});
