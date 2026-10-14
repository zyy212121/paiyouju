import { createStandardDeck, serializeCard } from "@paiyouju/poker-core";
import { describe, expect, it } from "vitest";

import { productionDeckProvider } from "./deck-provider.js";
import { FixedDeckProvider } from "./testing.js";

describe("deck providers", () => {
  it("deals only the 36 unique six-through-ace cards for short deck", () => {
    const deck = productionDeckProvider.nextDeck("SHORT_DECK");

    expect(deck).toHaveLength(36);
    expect(new Set(deck.map(serializeCard)).size).toBe(36);
    expect(deck.every((card) => card.rank >= 6)).toBe(true);
  });

  it("filters a deterministic standard fixture to the same short-deck range", () => {
    const provider = new FixedDeckProvider(createStandardDeck());
    const deck = provider.nextDeck("SHORT_DECK");

    expect(deck).toHaveLength(36);
    expect(deck.every((card) => card.rank >= 6)).toBe(true);
  });
});
