import { describe, expect, it } from "vitest";

import { defaultSeatBuyIn } from "./seat-buy-in.js";

describe("defaultSeatBuyIn", () => {
  it("uses the room's configured initial buy-in", () => {
    expect(defaultSeatBuyIn({ initialBuyIn: 2_000 })).toBe(2_000);
    expect(defaultSeatBuyIn({ initialBuyIn: 1_500 })).toBe(1_500);
    expect(defaultSeatBuyIn({ initialBuyIn: 400 })).toBe(400);
  });
});
