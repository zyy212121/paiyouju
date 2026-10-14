import { describe, expect, it } from "vitest";

import { KeyedSlidingWindowRateLimiter } from "./sliding-window-rate-limiter.js";

describe("KeyedSlidingWindowRateLimiter", () => {
  it("shares a limit across connections with the same authenticated key", () => {
    const limiter = new KeyedSlidingWindowRateLimiter(3, 10_000);
    expect(limiter.take("user-1", 1_000)).toBe(true);
    expect(limiter.take("user-1", 2_000)).toBe(true);
    expect(limiter.take("user-1", 3_000)).toBe(true);
    expect(limiter.take("user-1", 4_000)).toBe(false);
    expect(limiter.take("user-2", 4_000)).toBe(true);
  });

  it("releases capacity exactly when the sliding window expires", () => {
    const limiter = new KeyedSlidingWindowRateLimiter(1, 10_000);
    expect(limiter.take("user-1", 1_000)).toBe(true);
    expect(limiter.take("user-1", 10_999)).toBe(false);
    expect(limiter.take("user-1", 11_000)).toBe(true);
    limiter.clear();
    expect(limiter.take("user-1", 11_001)).toBe(true);
  });

  it("does not charge a durable retry token twice", () => {
    const limiter = new KeyedSlidingWindowRateLimiter(2, 10_000);
    expect(limiter.take("user-1", 1_000, "seat:take:operation-1")).toBe(true);
    expect(limiter.take("user-1", 2_000, "seat:take:operation-1")).toBe(true);
    expect(limiter.take("user-1", 3_000, "seat:leave:operation-2")).toBe(true);
    expect(limiter.take("user-1", 4_000, "seat:return:operation-3")).toBe(false);
  });
});
