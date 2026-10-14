import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, assertHandStateInvariants, buildDisplayPotAmounts, buildPots, startHand } from "./index.js";

describe("engine properties", () => {
  it("keeps every committed chip inside canonical pots", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 9 }),
      (commitments) => {
        const players = commitments.map((committedThisHand, seatIndex) => ({
          playerId: `p${seatIndex}`, seatIndex, startingStack: 1000, stack: 1000 - committedThisHand,
          committedThisStreet: committedThisHand, committedThisHand, hasFolded: false, isAllIn: committedThisHand === 1000,
          hasActedThisStreet: true, lastActedBetLevel: committedThisHand, lastActedFullRaiseSize: 10,
          holeCards: [{ rank: 2 as const, suit: "clubs" as const }, { rank: 3 as const, suit: "diamonds" as const }] as const,
          holeCardsVisibility: "private" as const,
        }));
        const result = buildPots(players);
        expect(result.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(commitments.reduce((sum, amount) => sum + amount, 0));
        expect(result.uncalledReturnsByPlayer).toEqual({});
        const displayPots = buildDisplayPotAmounts(players);
        expect(displayPots.every((amount) => Number.isSafeInteger(amount) && amount > 0)).toBe(true);
        expect(displayPots.reduce((sum, amount) => sum + amount, 0)).toBe(commitments.reduce((sum, amount) => sum + amount, 0));
      },
    ), { numRuns: 1000 });
  });

  it("produces deterministic immutable transitions and JSON-serializable state/events", () => {
    const initial = startHand({
      handId: "property", config: { maxSeats: 3, smallBlind: 5, bigBlind: 10 },
      seats: [0, 1, 2].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 100, isParticipating: true })),
      previousButtonSeat: 2, deck: createStandardDeck(),
    }).state;
    const before = JSON.stringify(initial);
    const left = applyPlayerAction(initial, { playerId: "p0", actionType: "call" });
    const right = applyPlayerAction(initial, { playerId: "p0", actionType: "call" });
    expect(left).toEqual(right);
    expect(JSON.stringify(initial)).toBe(before);
    expect(JSON.parse(JSON.stringify(left))).toEqual(left);
    expect(() => assertHandStateInvariants(left.state, initial)).not.toThrow();
  });
});
