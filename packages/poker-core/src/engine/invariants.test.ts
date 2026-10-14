import { describe, expect, it } from "vitest";
import { createStandardDeck } from "../deck.js";
import { assertHandStateInvariants, startHand, type HandState } from "./index.js";

function state(): HandState {
  return startHand({
    handId: "invariants", config: { maxSeats: 3, smallBlind: 5, bigBlind: 10 },
    seats: [0, 1, 2].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 100, isParticipating: true })),
    previousButtonSeat: 2, deck: createStandardDeck(),
  }).state;
}

function finishedState(): HandState {
  return startHand({
    handId: "finished-invariants", config: { maxSeats: 2, smallBlind: 5, bigBlind: 10 },
    seats: [
      { playerId: "short", seatIndex: 0, stack: 5, isParticipating: true },
      { playerId: "deep", seatIndex: 1, stack: 10, isParticipating: true },
    ],
    previousButtonSeat: 1, deck: createStandardDeck(),
  }).state;
}

describe("hand state invariants", () => {
  it("accepts a valid active hand", () => {
    expect(() => assertHandStateInvariants(state())).not.toThrow();
  });

  it.each([
    ["negative stack", (valid: HandState) => ({ ...valid, players: valid.players.map((player, index) => index === 0 ? { ...player, stack: -1 } : player) })],
    ["street commitment exceeds hand", (valid: HandState) => ({ ...valid, players: valid.players.map((player, index) => index === 0 ? { ...player, committedThisStreet: 11, committedThisHand: 10 } : player) })],
    ["current bet below commitment", (valid: HandState) => ({ ...valid, currentBet: 0 })],
    ["folded current actor", (valid: HandState) => ({ ...valid, players: valid.players.map((player) => player.seatIndex === valid.currentActorSeat ? { ...player, hasFolded: true } : player) })],
    ["duplicate card", (valid: HandState) => ({ ...valid, deck: [valid.players[0]!.holeCards[0], ...valid.deck.slice(1)] })],
  ] as const)("rejects %s", (_label, mutate) => {
    expect(() => assertHandStateInvariants(mutate(state()))).toThrowError(expect.objectContaining({ code: "STATE_INVARIANT_VIOLATION" }));
  });

  it("rejects state-version regression", () => {
    const previous = state();
    expect(() => assertHandStateInvariants({ ...previous, stateVersion: previous.stateVersion }, previous)).toThrowError(expect.objectContaining({ code: "STATE_INVARIANT_VIOLATION" }));
  });

  it("includes replay context in failures", () => {
    try {
      assertHandStateInvariants({ ...state(), currentBet: -1 });
      throw new Error("expected invariant failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "STATE_INVARIANT_VIOLATION", context: expect.objectContaining({ handId: "invariants", street: "preflop" }) });
    }
  });

  it("rejects a finished state whose aggregate awards disagree with its pot awards", () => {
    const valid = finishedState();
    expect(valid.status).toBe("finished");
    expect(valid.settlement).not.toBeNull();
    const invalid = {
      ...valid,
      settlement: { ...valid.settlement!, awardsByPlayer: { ghost: 10 } },
    };
    expect(() => assertHandStateInvariants(invalid)).toThrowError(expect.objectContaining({ code: "STATE_INVARIANT_VIOLATION" }));
  });
});
