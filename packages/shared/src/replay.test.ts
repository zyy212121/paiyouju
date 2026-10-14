import { describe, expect, it } from "vitest";

import type { HistoryEvent, ReplayState } from "./history.js";
import { reduceReplayEvents, replayStateAt } from "./replay.js";

const initial: ReplayState = {
  board: [],
  players: [
    { allIn: false, committed: 0, folded: false, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "甲", seatIndex: 0, stack: 400, userId: "a" },
    { allIn: false, committed: 0, folded: false, holeCards: null, holeCardsVisibility: "HIDDEN", nickname: "乙", seatIndex: 1, stack: 400, userId: "b" },
  ],
  pot: 0,
  pots: [],
  street: "PREFLOP",
  winners: [],
};

function event(sequence: number, type: HistoryEvent["type"], extra: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    actorSeat: null,
    actorUserId: null,
    amount: null,
    automatic: false,
    cards: null,
    potIndex: null,
    raiseTo: null,
    sequence,
    stateVersion: null,
    street: "PREFLOP",
    type,
    visibility: null,
    winners: [],
    ...extra,
  };
}

describe("deterministic replay reducer", () => {
  it("replays contributions, an odd-chip award and an after-hand reveal without mutation", () => {
    const events = [
      event(0, "HAND_STARTED"),
      event(1, "BLIND_POSTED", { actorUserId: "a", amount: 10 }),
      event(2, "BLIND_POSTED", { actorUserId: "b", amount: 20 }),
      event(3, "PLAYER_CALLED", { actorUserId: "a", amount: 10 }),
      event(4, "FLOP_DEALT", { cards: ["2c", "3d", "4h"], street: "FLOP" }),
      event(5, "POT_AWARDED", { amount: 40, potIndex: 0, winners: ["a", "b"] }),
      event(6, "CARDS_REVEALED", { actorUserId: "b", cards: ["Qs", "Qd"], visibility: "PURCHASED_AFTER_HAND" }),
      event(7, "HAND_FINISHED"),
    ];
    const result = reduceReplayEvents(initial, events);
    expect(result.board).toEqual(["2c", "3d", "4h"]);
    expect(result.pot).toBe(0);
    expect(result.players.map((player) => player.stack)).toEqual([400, 400]);
    expect(result.players[1]).toMatchObject({ holeCards: ["Qs", "Qd"], holeCardsVisibility: "PURCHASED" });
    expect(initial.players.map((player) => player.stack)).toEqual([400, 400]);
    expect(replayStateAt(initial, events, 3).pot).toBe(30);
  });
});
