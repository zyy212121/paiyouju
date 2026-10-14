import { createStandardDeck, serializeCard } from "@paiyouju/poker-core";
import { describe, expect, it, vi } from "vitest";

import { systemScheduler } from "./clock.js";
import { productionDeckProvider } from "./deck-provider.js";
import { FakeClockScheduler, FixedDeckProvider } from "./testing.js";

describe("runtime time and deck dependencies", () => {
  it("advances scheduled work deterministically and honours cancellation", async () => {
    const time = new FakeClockScheduler();
    const events: string[] = [];
    const cancelled = time.schedule(new Date(time.now().getTime() + 4_000), () => { events.push("cancelled"); });
    time.schedule(new Date(time.now().getTime() + 5_000), () => { events.push("start"); });
    cancelled.cancel();
    await time.advanceBy(4_999);
    expect(events).toEqual([]);
    await time.advanceBy(1);
    expect(events).toEqual(["start"]);
  });

  it("keeps authoritative deadlines referenced until explicitly cancelled", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const scheduled = systemScheduler.schedule(new Date(Date.now() + 60_000), () => undefined);
      const timer = setTimeoutSpy.mock.results.at(-1)?.value as NodeJS.Timeout | undefined;
      expect(timer).toBeDefined();
      expect(timer?.hasRef()).toBe(true);
      scheduled.cancel();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("copies fixed decks and production supplies 52 unique cards", () => {
    const canonical = createStandardDeck();
    const fixed = new FixedDeckProvider(canonical);
    expect(fixed.nextDeck()).not.toBe(canonical);
    expect(fixed.nextDeck().map(serializeCard)).toEqual(canonical.map(serializeCard));
    const production = productionDeckProvider.nextDeck();
    expect(production).toHaveLength(52);
    expect(new Set(production.map(serializeCard))).toHaveLength(52);
  });
});
