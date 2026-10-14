import { describe, expect, it } from "vitest";

import {
  displayHandNumber,
  projectRunoutPlayerAmounts,
  runoutIndices,
  splitForRunout,
} from "./runout-history.js";

describe("run-it-twice history projection", () => {
  it("projects one physical hand as two deterministic history branches", () => {
    expect(runoutIndices(1)).toEqual([null]);
    expect(runoutIndices(2)).toEqual([1, 2]);
    expect(displayHandNumber(44, null)).toBe("44");
    expect(displayHandNumber(44, 1)).toBe("44-1");
    expect(displayHandNumber(44, 2)).toBe("44-2");
  });

  it("gives every indivisible amount to the first branch and preserves the total", () => {
    expect(splitForRunout(31, 1)).toBe(16);
    expect(splitForRunout(31, 2)).toBe(15);
    expect(splitForRunout(31, 1) + splitForRunout(31, 2)).toBe(31);
  });

  it("derives each branch result from split commitments and that board's awards", () => {
    const first = projectRunoutPlayerAmounts({
      committed: 31,
      runoutIndex: 1,
      startingStack: 100,
      userId: "winner",
      pots: [{ amount: 31, oddChipRecipients: ["winner"], winners: ["winner", "other"] }],
    });
    const second = projectRunoutPlayerAmounts({
      committed: 31,
      runoutIndex: 2,
      startingStack: 100,
      userId: "winner",
      pots: [{ amount: 30, oddChipRecipients: [], winners: ["other"] }],
    });

    expect(first).toEqual({ committed: 16, endingStack: 100, netResult: 0, wonAnyPot: true });
    expect(second).toEqual({ committed: 15, endingStack: 85, netResult: -15, wonAnyPot: false });
    expect(first.netResult + second.netResult).toBe(-15);
  });
});
