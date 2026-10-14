import { describe, expect, it } from "vitest";

import { squidStakeOptions } from "./squid-mode.js";

describe("squid mode stake options", () => {
  it("derives five exact tiers from one percent of the initial buy-in", () => {
    expect(squidStakeOptions(2_000)).toEqual([20, 40, 60, 80, 100]);
    expect(squidStakeOptions(2_001)).toEqual([21, 42, 63, 84, 105]);
    expect(squidStakeOptions(1)).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid initial buy-in: %s",
    (initialBuyIn) => {
      expect(() => squidStakeOptions(initialBuyIn)).toThrow();
    },
  );
});
