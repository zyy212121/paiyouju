import { describe, expect, it } from "vitest";
import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, getLegalActions, startHand } from "./index.js";

describe("street progression", () => {
  it("progresses through flop, turn, river, and showdown without over-dealing", () => {
    let state = startHand({
      handId: "streets", config: { maxSeats: 2, smallBlind: 5, bigBlind: 10 },
      seats: [0, 1].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 100, isParticipating: true })),
      previousButtonSeat: 1, deck: createStandardDeck(),
    }).state;
    state = applyPlayerAction(state, { playerId: "p0", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "check" }).state;
    expect([state.street, state.board.length, state.currentActorSeat]).toEqual(["flop", 3, 1]);

    for (const expected of [["turn", 4], ["river", 5], ["showdown", 5]] as const) {
      const first = state.players.find((player) => player.seatIndex === state.currentActorSeat)!;
      expect(getLegalActions(state, first.playerId).canCheck).toBe(true);
      state = applyPlayerAction(state, { playerId: first.playerId, actionType: "check" }).state;
      const second = state.players.find((player) => player.seatIndex === state.currentActorSeat)!;
      state = applyPlayerAction(state, { playerId: second.playerId, actionType: "check" }).state;
      expect([state.street, state.board.length]).toEqual(expected);
    }
    expect(state.status).toBe("finished");
    expect(state.players.every((player) => player.holeCardsVisibility === "showdown")).toBe(true);
    expect(state.actionHistory.some((event) => event.eventType === "HAND_FINISHED")).toBe(true);
  });

  it("runs out after the last opponent with chips folds and the sole actor owes nothing", () => {
    let state = startHand({
      handId: "sole-actor", config: { maxSeats: 3, smallBlind: 5, bigBlind: 10 },
      seats: [
        { playerId: "p0", seatIndex: 0, stack: 100, isParticipating: true },
        { playerId: "p1", seatIndex: 1, stack: 10, isParticipating: true },
        { playerId: "p2", seatIndex: 2, stack: 100, isParticipating: true },
      ],
      previousButtonSeat: 2, deck: createStandardDeck(),
    }).state;
    state = applyPlayerAction(state, { playerId: "p0", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "check" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "fold" }).state;
    expect(state.status).toBe("finished");
    expect(state.board).toHaveLength(5);
    expect(state.currentActorSeat).toBeNull();
  });
});
