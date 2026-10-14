import { describe, expect, it } from "vitest";

import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, getLegalActions, startHand } from "./index.js";

function threeHand() {
  return startHand({
    handId: "betting",
    config: { maxSeats: 3, smallBlind: 10, bigBlind: 20 },
    seats: [0, 1, 2].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 200, isParticipating: true })),
    previousButtonSeat: 2,
    deck: createStandardDeck(),
  }).state;
}

describe("legal actions and betting", () => {
  it("projects exact preflop legal action amounts only for the actor", () => {
    const state = threeHand();
    expect(getLegalActions(state, "p0")).toEqual({
      canFold: true, canCheck: false, callAmount: 20, canCall: true,
      canBet: false, minimumBet: null, maximumBet: null,
      canRaise: true, minimumRaiseTo: 40, maximumRaiseTo: 200,
      canAllIn: true, allInTo: 200,
    });
    expect(getLegalActions(state, "p1")).toEqual({
      canFold: false, canCheck: false, callAmount: 0, canCall: false,
      canBet: false, minimumBet: null, maximumBet: null,
      canRaise: false, minimumRaiseTo: null, maximumRaiseTo: null,
      canAllIn: false, allInTo: null,
    });
  });

  it("uses total-to raise amounts and updates the next player's call", () => {
    const before = threeHand();
    const raised = applyPlayerAction(before, { playerId: "p0", actionType: "raiseTo", amount: 60 });
    expect(before.currentBet).toBe(20);
    expect(raised.state.currentBet).toBe(60);
    expect(raised.state.lastFullRaiseSize).toBe(40);
    expect(raised.state.players.find((player) => player.playerId === "p0")).toMatchObject({ stack: 140, committedThisStreet: 60, committedThisHand: 60 });
    expect(raised.state.currentActorSeat).toBe(1);
    expect(getLegalActions(raised.state, "p1")).toMatchObject({ callAmount: 50, minimumRaiseTo: 100 });
    expect(raised.state.stateVersion).toBe(2);
    expect(raised.events.map((event) => event.eventType)).toEqual(["PLAYER_RAISED"]);
  });

  it("classifies a sized bet or raise that consumes the stack as all-in", () => {
    const raised = applyPlayerAction(threeHand(), { playerId: "p0", actionType: "raiseTo", amount: 200 });
    expect(raised.events[0]).toMatchObject({ amount: 200, eventType: "PLAYER_ALL_IN", playerId: "p0" });
    expect(raised.state.players.find((player) => player.playerId === "p0")).toMatchObject({ isAllIn: true, stack: 0 });
  });

  it("rejects out-of-turn, illegal check, below-minimum raise, and stack overflow", () => {
    const state = threeHand();
    expect(() => applyPlayerAction(state, { playerId: "p1", actionType: "call" })).toThrowError(expect.objectContaining({ code: "NOT_PLAYER_TURN" }));
    expect(() => applyPlayerAction(state, { playerId: "p0", actionType: "check" })).toThrowError(expect.objectContaining({ code: "ILLEGAL_CHECK" }));
    expect(() => applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 30 })).toThrowError(expect.objectContaining({ code: "RAISE_BELOW_MINIMUM" }));
    expect(() => applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 201 })).toThrowError(expect.objectContaining({ code: "AMOUNT_EXCEEDS_STACK" }));
  });

  it("completes preflop after calls and gives the small blind first postflop action", () => {
    let state = threeHand();
    state = applyPlayerAction(state, { playerId: "p0", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "check" }).state;
    expect(state.street).toBe("flop");
    expect(state.board).toHaveLength(3);
    expect(state.currentBet).toBe(0);
    expect(state.lastFullRaiseSize).toBe(20);
    expect(state.players.map((player) => player.committedThisStreet)).toEqual([0, 0, 0]);
    expect(state.currentActorSeat).toBe(1);
    expect(getLegalActions(state, "p1")).toMatchObject({ canCheck: true, canBet: true, minimumBet: 20, maximumBet: 180 });
  });

  it("finishes immediately when every opponent folds without revealing cards", () => {
    let state = threeHand();
    state = applyPlayerAction(state, { playerId: "p0", actionType: "fold" }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "fold" }).state;
    expect(state.status).toBe("finished");
    expect(state.board).toHaveLength(0);
    expect(state.settlement?.revealedPlayers).toEqual([]);
    expect(state.settlement?.winners).toEqual(["p2"]);
    expect(state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(600);
  });
});
