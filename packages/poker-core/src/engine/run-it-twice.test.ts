import { describe, expect, it } from "vitest";

import { createStandardDeck } from "../deck.js";
import {
  applyPlayerAction,
  assertHandStateInvariants,
  resolveRunoutChoice,
  startHand,
  type HandState,
} from "./index.js";

function headsUp(stacks: readonly [number, number] = [100, 100]): HandState {
  return startHand({
    handId: "run-it-twice",
    config: { maxSeats: 2, smallBlind: 5, bigBlind: 10 },
    deck: createStandardDeck(),
    previousButtonSeat: 1,
    deferHeadsUpAllInRunout: true,
    seats: [
      { playerId: "button", seatIndex: 0, stack: stacks[0], isParticipating: true },
      { playerId: "big-blind", seatIndex: 1, stack: stacks[1], isParticipating: true },
    ],
  }).state;
}

function reachPreflopChoice(stacks: readonly [number, number] = [100, 100]): HandState {
  let state = headsUp(stacks);
  state = applyPlayerAction(state, { actionType: "allIn", playerId: "button" }, { deferHeadsUpAllInRunout: true }).state;
  state = applyPlayerAction(state, { actionType: "call", playerId: "big-blind" }, { deferHeadsUpAllInRunout: true }).state;
  return state;
}

describe("run it twice", () => {
  it("pauses a two-player all-in before dealing future community cards", () => {
    const state = reachPreflopChoice();

    expect(state.status).toBe("runout_choice");
    expect(state.currentActorSeat).toBeNull();
    expect(state.board).toEqual([]);
    expect(state.settlement).toBeNull();
    expect(state.actionHistory.at(-1)?.eventType).toBe("RUNOUT_CHOICE_STARTED");
    expect(() => assertHandStateInvariants(state)).not.toThrow();
  });

  it("opens the choice immediately when a short small blind is all-in and the big blind owes nothing", () => {
    const state = startHand({
      handId: "short-blind-runout",
      config: { maxSeats: 2, smallBlind: 10, bigBlind: 20 },
      deck: createStandardDeck(),
      previousButtonSeat: 1,
      deferHeadsUpAllInRunout: true,
      seats: [
        { playerId: "short-small-blind", seatIndex: 0, stack: 10, isParticipating: true },
        { playerId: "big-blind", seatIndex: 1, stack: 100, isParticipating: true },
      ],
    }).state;

    expect(state.status).toBe("runout_choice");
    expect(state.currentActorSeat).toBeNull();
    expect(state.players.find((player) => player.playerId === "short-small-blind")?.isAllIn).toBe(true);
    expect(state.players.find((player) => player.playerId === "big-blind")?.committedThisStreet).toBe(20);
    expect(state.board).toEqual([]);
    expect(() => assertHandStateInvariants(state)).not.toThrow();
  });

  it("uses one unique remaining deck for the first board and then the second board", () => {
    const pending = reachPreflopChoice();
    const firstTen = pending.deck.slice(0, 10);
    const resolved = resolveRunoutChoice(pending, true).state;

    expect(resolved.status).toBe("finished");
    expect(resolved.runoutBoards).toEqual([
      firstTen.slice(0, 5),
      firstTen.slice(5, 10),
    ]);
    expect(new Set(resolved.runoutBoards?.flat().map((card) => `${card.rank}:${card.suit}`)).size).toBe(10);
    expect(resolved.deck).toEqual(pending.deck.slice(10));
    expect(resolved.settlement?.runouts).toHaveLength(2);
    expect(() => assertHandStateInvariants(resolved, pending)).not.toThrow();
  });

  it("copies already dealt cards to both boards without putting them back in the deck", () => {
    let state = headsUp();
    state = applyPlayerAction(state, { actionType: "call", playerId: "button" }).state;
    state = applyPlayerAction(state, { actionType: "check", playerId: "big-blind" }).state;
    state = applyPlayerAction(state, { actionType: "check", playerId: "big-blind" }).state;
    state = applyPlayerAction(state, { actionType: "allIn", playerId: "button" }, { deferHeadsUpAllInRunout: true }).state;
    state = applyPlayerAction(state, { actionType: "call", playerId: "big-blind" }, { deferHeadsUpAllInRunout: true }).state;

    expect(state.status).toBe("runout_choice");
    expect(state.board).toHaveLength(3);
    const shared = state.board;
    const future = state.deck.slice(0, 4);
    const resolved = resolveRunoutChoice(state, true).state;

    expect(resolved.runoutBoards?.[0]).toEqual([...shared, ...future.slice(0, 2)]);
    expect(resolved.runoutBoards?.[1]).toEqual([...shared, ...future.slice(2, 4)]);
    expect(resolved.deck).toEqual(state.deck.slice(4));
    expect(() => assertHandStateInvariants(resolved, state)).not.toThrow();
  });

  it("gives every indivisible pot's extra point to the first board and conserves every chip", () => {
    const started = startHand({
      handId: "odd-runout-layer",
      config: { maxSeats: 2, smallBlind: 10, bigBlind: 20 },
      deck: createStandardDeck(),
      previousButtonSeat: 1,
      deferHeadsUpAllInRunout: true,
      seats: [
        { playerId: "button", seatIndex: 0, stack: 15, isParticipating: true },
        { playerId: "big-blind", seatIndex: 1, stack: 20, isParticipating: true },
      ],
    }).state;
    const pending = applyPlayerAction(started, { actionType: "allIn", playerId: "button" }, { deferHeadsUpAllInRunout: true }).state;
    const resolved = resolveRunoutChoice(pending, true).state;
    const runouts = resolved.settlement?.runouts;

    expect(runouts?.[0]?.pots.map((pot) => pot.amount)).toEqual([15, 3]);
    expect(runouts?.[1]?.pots.map((pot) => pot.amount)).toEqual([15, 2]);
    expect(runouts?.[0]?.pots.map((pot, index) => pot.amount + runouts[1]!.pots[index]!.amount)).toEqual([30, 5]);
    expect(Object.values(resolved.settlement?.awardsByPlayer ?? {}).reduce((sum, amount) => sum + amount, 0)).toBe(35);
    expect(resolved.players.reduce((sum, player) => sum + player.stack, 0)).toBe(35);
    expect(() => assertHandStateInvariants(resolved, pending)).not.toThrow();
  });

  it("resolves the same pending state as a normal single run when the vote chooses once", () => {
    const pending = reachPreflopChoice();
    const resolved = resolveRunoutChoice(pending, false).state;

    expect(resolved.status).toBe("finished");
    expect(resolved.runoutBoards).toBeUndefined();
    expect(resolved.board).toHaveLength(5);
    expect(resolved.settlement?.runouts).toBeUndefined();
    expect(resolved.actionHistory.some((event) => event.eventType === "RUNOUT_CHOICE_RESOLVED" && event.runoutCount === 1)).toBe(true);
    expect(() => assertHandStateInvariants(resolved, pending)).not.toThrow();
  });
});
