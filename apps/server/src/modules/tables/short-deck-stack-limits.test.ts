import { describe, expect, it } from "vitest";

import { resolveShortDeckStackLimit } from "./short-deck-stack-limits.js";

describe("short-deck post-hand stack limits", () => {
  it.each([
    [200, 500, 2_000, { adjustment: 300, finalStack: 500, type: "BUY_IN" }],
    [500, 500, 2_000, { adjustment: 0, finalStack: 500, type: null }],
    [1_200, 500, 2_000, { adjustment: 0, finalStack: 1_200, type: null }],
    [2_000, 500, 2_000, { adjustment: 0, finalStack: 2_000, type: null }],
    [2_450, 500, 2_000, { adjustment: -450, finalStack: 2_000, type: "CASH_OUT" }],
  ] as const)("normalizes %s into [%s, %s]", (stack, minimum, maximum, expected) => {
    expect(resolveShortDeckStackLimit(stack, minimum, maximum)).toEqual(expected);
  });

  it.each([
    [-1, 500, 2_000],
    [500, 0, 2_000],
    [500, 2_001, 2_000],
  ])("rejects unsafe input %#", (stack, minimum, maximum) => {
    expect(() => resolveShortDeckStackLimit(stack, minimum, maximum)).toThrow();
  });
});
