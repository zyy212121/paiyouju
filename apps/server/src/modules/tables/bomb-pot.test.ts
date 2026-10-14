import { describe, expect, it } from "vitest";

import { bombPotBlindAmount, resolveBombPotHandStart } from "./bomb-pot.js";

describe("bomb pot scheduling", () => {
  it("starts the timer with the table and resets it only when a due hand begins", () => {
    const startedAt = new Date("2026-08-31T00:00:00.000Z");
    const firstDeadline = new Date("2026-08-31T00:05:00.000Z");
    expect(resolveBombPotHandStart({
      intervalMinutes: 5,
      nextAt: null,
      now: startedAt,
      tableStartedAt: null,
    })).toEqual({ bombPot: false, nextAt: firstDeadline });
    expect(resolveBombPotHandStart({
      intervalMinutes: 5,
      nextAt: firstDeadline,
      now: new Date("2026-08-31T00:04:59.999Z"),
      tableStartedAt: startedAt,
    })).toEqual({ bombPot: false, nextAt: firstDeadline });
    expect(resolveBombPotHandStart({
      intervalMinutes: 5,
      nextAt: firstDeadline,
      now: firstDeadline,
      tableStartedAt: startedAt,
    })).toEqual({ bombPot: true, nextAt: new Date("2026-08-31T00:10:00.000Z") });
  });

  it("derives a safe absolute forced blind from its BB multiplier", () => {
    expect(bombPotBlindAmount(20, 1)).toBe(20);
    expect(bombPotBlindAmount(20, 10)).toBe(200);
    expect(() => bombPotBlindAmount(2_000_000_000, 10)).toThrow();
  });

  it("accepts the one-minute fast tier and five-minute frequency tiers", () => {
    expect(resolveBombPotHandStart({
      intervalMinutes: 1,
      nextAt: null,
      now: new Date("2026-08-31T00:00:00.000Z"),
      tableStartedAt: null,
    }).nextAt).toEqual(new Date("2026-08-31T00:01:00.000Z"));
    expect(() => resolveBombPotHandStart({
      intervalMinutes: 6,
      nextAt: null,
      now: new Date("2026-08-31T00:00:00.000Z"),
      tableStartedAt: null,
    })).toThrow("invalid bomb-pot interval");
  });
});
