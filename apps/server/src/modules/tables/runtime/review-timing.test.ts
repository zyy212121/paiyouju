import { createStandardDeck } from "@paiyouju/poker-core";
import { describe, expect, it } from "vitest";

import { postHandReviewDurationMs } from "./review-timing.js";

function automaticRunout(cardCount: number) {
  return {
    actionHistory: [{
      cards: createStandardDeck().slice(0, cardCount),
      eventType: "BOARD_DEALT" as const,
      handId: "hand-1",
      stateVersion: 3,
      street: "showdown" as const,
    }],
  };
}

function doubleAutomaticRunout(cardCount: number) {
  return {
    actionHistory: ([1, 2] as const).map((runoutIndex) => ({
      cards: createStandardDeck().slice(runoutIndex * 10, runoutIndex * 10 + cardCount),
      eventType: "BOARD_DEALT" as const,
      handId: "hand-1",
      runoutIndex,
      stateVersion: 3,
      street: "showdown" as const,
    })),
  };
}

describe("post-hand review timing", () => {
  it("keeps four result seconds after paced automatic community-card runouts", () => {
    expect(postHandReviewDurationMs(automaticRunout(5))).toBe(7_000);
    expect(postHandReviewDurationMs(automaticRunout(2))).toBe(7_000);
    expect(postHandReviewDurationMs(automaticRunout(1))).toBe(6_000);
  });

  it("keeps the ordinary review at four seconds", () => {
    expect(postHandReviewDurationMs({ actionHistory: [] })).toBe(4_000);
  });

  it("keeps both boards, the first result pause, and four final result seconds visible", () => {
    expect(postHandReviewDurationMs(doubleAutomaticRunout(5))).toBe(11_000);
    expect(postHandReviewDurationMs(doubleAutomaticRunout(2))).toBe(11_000);
    expect(postHandReviewDurationMs(doubleAutomaticRunout(1))).toBe(9_000);
  });
});
