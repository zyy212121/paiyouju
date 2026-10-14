import { describe, expect, it } from "vitest";
import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, getLegalActions, startHand } from "./index.js";

function hand(stacks: readonly number[], previousButtonSeat = stacks.length - 1) {
  return startHand({
    handId: "short",
    config: { maxSeats: stacks.length, smallBlind: 5, bigBlind: 10 },
    seats: stacks.map((stack, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack, isParticipating: true })),
    previousButtonSeat,
    deck: createStandardDeck(),
  }).state;
}

describe("short all-in raise rights", () => {
  it("does not reopen an acted player's raise right after one short all-in", () => {
    let state = hand([200, 200, 80]);
    state = applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 60 }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "allIn" }).state;
    const legal = getLegalActions(state, "p0");
    expect(legal).toMatchObject({ callAmount: 20, canCall: true, canRaise: false, canAllIn: false });
    expect(() => applyPlayerAction(state, { playerId: "p0", actionType: "allIn" })).toThrowError(expect.objectContaining({ code: "ILLEGAL_RAISE" }));
  });

  it("keeps raise rights for a player who has not acted", () => {
    let state = hand([300, 300, 80, 200], 0);
    state = applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 60 }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "allIn" }).state;
    expect(getLegalActions(state, "p3")).toMatchObject({ callAmount: 70, canRaise: true, minimumRaiseTo: 130 });
  });

  it("reopens independently when cumulative short raises reach the prior full raise size", () => {
    let state = hand([300, 300, 80, 110], 0);
    state = applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 60 }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    state = applyPlayerAction(state, { playerId: "p2", actionType: "allIn" }).state;
    state = applyPlayerAction(state, { playerId: "p3", actionType: "allIn" }).state;
    expect(getLegalActions(state, "p0")).toMatchObject({ callAmount: 50, canRaise: true, minimumRaiseTo: 160 });
  });

  it("allows an all-in below the minimum but rejects the same non-all-in raise", () => {
    let state = hand([200, 200, 35]);
    state = applyPlayerAction(state, { playerId: "p0", actionType: "raiseTo", amount: 30 }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    expect(() => applyPlayerAction(state, { playerId: "p2", actionType: "raiseTo", amount: 35 })).toThrowError(expect.objectContaining({ code: "RAISE_BELOW_MINIMUM" }));
    expect(applyPlayerAction(state, { playerId: "p2", actionType: "allIn" }).state.currentBet).toBe(35);
  });

  it("automatically runs out exactly five board cards when no one can act", () => {
    let state = hand([20, 20]);
    state = applyPlayerAction(state, { playerId: "p0", actionType: "allIn" }).state;
    state = applyPlayerAction(state, { playerId: "p1", actionType: "call" }).state;
    expect(state.status).toBe("finished");
    expect(state.board).toHaveLength(5);
    expect(state.deck).toHaveLength(43);
    expect(state.settlement).not.toBeNull();
  });
});
