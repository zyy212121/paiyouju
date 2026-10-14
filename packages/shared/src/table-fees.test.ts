import { describe, expect, it } from "vitest";

import { DIAMOND_FEE_BASE, tableDiamondFees } from "./table-fees.js";

describe("tableDiamondFees", () => {
  it("uses a BB-independent x=10 baseline for every forced diamond fee", () => {
    expect(DIAMOND_FEE_BASE).toBe(10);
    expect(tableDiamondFees()).toEqual({
      actionTimeExtension: 10,
      handEntry: 10,
      hypotheticalRunout: 10,
      paidHandReveal: 50,
    });
  });
});
