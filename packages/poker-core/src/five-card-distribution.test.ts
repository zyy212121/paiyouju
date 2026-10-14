import { describe, expect, it } from "vitest";

import { parseCard } from "./card.js";
import {
  EXPECTED_FIVE_CARD_DISTRIBUTION,
  countFiveCardDistribution,
} from "./five-card-distribution.js";
import { HandCategory } from "./hand-types.js";

describe("five-card distribution counter", () => {
  it("counts one royal flush from a five-card input", () => {
    const result = countFiveCardDistribution(
      ["As", "Ks", "Qs", "Js", "Ts"].map(parseCard),
    );

    expect(result.total).toBe(1);
    expect(result.counts[HandCategory.StraightFlush]).toBe(1);
    expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("counts every five-card combination from six unique cards", () => {
    const result = countFiveCardDistribution(
      ["As", "Ks", "Qs", "Js", "Ts", "2c"].map(parseCard),
    );

    expect(result.total).toBe(6);
    expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(result.counts[HandCategory.StraightFlush]).toBe(1);
  });

  it("defines expected counts that sum to all 2,598,960 standard hands", () => {
    expect(
      EXPECTED_FIVE_CARD_DISTRIBUTION.reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(2_598_960);
  });
});
