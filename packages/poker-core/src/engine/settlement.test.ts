import { describe, expect, it } from "vitest";
import { parseCard, serializeCard } from "../card.js";
import { createStandardDeck } from "../deck.js";
import { applyPlayerAction, settleHand, startHand, type HandState, type PlayerAction } from "./index.js";

function showdownState(): HandState {
  const state = startHand({
    handId: "settle", config: { maxSeats: 4, smallBlind: 5, bigBlind: 10 },
    seats: [0, 1, 2, 3].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 100, isParticipating: true })),
    previousButtonSeat: 3, deck: createStandardDeck(),
  }).state;
  const hands = [
    ["As", "Ah"], ["Ks", "Kh"], ["Qs", "Qh"], ["2c", "3d"],
  ].map((cards) => cards.map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>]);
  return {
    ...state, street: "showdown", currentActorSeat: null,
    board: ["Ac", "Kd", "Qc", "7s", "6h"].map(parseCard),
    players: state.players.map((player, index) => ({
      ...player, holeCards: hands[index]!, stack: 100 - [25, 50, 75, 75][index]!,
      committedThisStreet: [25, 50, 75, 75][index]!, committedThisHand: [25, 50, 75, 75][index]!,
      isAllIn: true, hasFolded: index === 3,
    })),
  };
}

describe("settlement", () => {
  it("awards all 30 posted blind points after a normal heads-up fold", () => {
    const started = startHand({
      handId: "heads-up-fold",
      config: { maxSeats: 2, smallBlind: 10, bigBlind: 20 },
      seats: [
        { playerId: "small-blind", seatIndex: 0, stack: 400, isParticipating: true },
        { playerId: "big-blind", seatIndex: 1, stack: 400, isParticipating: true },
      ],
      previousButtonSeat: 1,
      deck: createStandardDeck(),
    }).state;

    const finished = applyPlayerAction(started, { actionType: "fold", playerId: "small-blind" }).state;

    expect(finished.settlement?.pots).toHaveLength(1);
    expect(finished.settlement?.pots[0]).toMatchObject({ amount: 30, awards: { "big-blind": 30 }, winners: ["big-blind"] });
    expect(finished.settlement?.finalStacks).toEqual({ "small-blind": 390, "big-blind": 410 });
    expect(finished.settlement?.uncalledReturnsByPlayer).toEqual({});
    expect(finished.actionHistory.some((domainEvent) => domainEvent.eventType === "UNCALLED_BET_RETURNED")).toBe(false);
  });

  it("settles main and side pots independently and excludes folded contributors", () => {
    const result = settleHand(showdownState());
    expect(result.pots.map((pot) => ({ amount: pot.amount, winners: pot.winners }))).toEqual([
      { amount: 100, winners: ["p0"] },
      { amount: 75, winners: ["p1"] },
      { amount: 50, winners: ["p2"] },
    ]);
    expect(result.awardsByPlayer).toEqual({ p0: 100, p1: 75, p2: 50 });
    expect(Object.values(result.awardsByPlayer).reduce((sum, amount) => sum + amount, 0)).toBe(225);
  });

  it("awards odd chips clockwise left of the button for each pot", () => {
    const state = showdownState();
    const tied = {
      ...state, buttonSeat: 0,
      board: ["As", "Ks", "Qs", "Js", "Ts"].map(parseCard),
      players: state.players.slice(0, 3).map((player, index) => ({ ...player, committedThisHand: 5, committedThisStreet: 5, stack: 95, hasFolded: false, holeCards: [["2c", "3d"], ["4c", "5d"], ["6c", "7d"]][index]!.map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>] })),
    };
    const result = settleHand(tied);
    expect(result.pots[0]).toMatchObject({ amount: 15, amountPerWinner: 5, oddChipRecipients: [] });

    const odd = { ...tied, players: tied.players.map((player, index) => ({ ...player, committedThisHand: index === 0 ? 3 : 4, committedThisStreet: index === 0 ? 3 : 4, stack: index === 0 ? 97 : 96 })) };
    const oddResult = settleHand(odd);
    expect(oddResult.pots[0]).toMatchObject({ amount: 9, winners: ["p0", "p1", "p2"] });
    expect(oddResult.pots[1]).toMatchObject({ amount: 2, winners: ["p1", "p2"], amountPerWinner: 1 });
  });

  it("gives one or two odd chips to three tied winners in clockwise seat order", () => {
    const base = showdownState();
    const board = ["As", "Ks", "Qs", "Js", "Ts"].map(parseCard);
    const winners = base.players.slice(0, 3).map((player, index) => ({
      ...player, committedThisHand: 1, committedThisStreet: 1, stack: 99, hasFolded: false,
      holeCards: [["2c", "3d"], ["4c", "5d"], ["6c", "7d"]][index]!.map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>],
    }));
    const donorOne = { ...base.players[3]!, committedThisHand: 1, committedThisStreet: 1, stack: 99, hasFolded: true };
    const oneOdd = settleHand({ ...base, buttonSeat: 0, board, players: [...winners, donorOne] });
    expect(oneOdd.pots[0]?.oddChipRecipients).toEqual(["p1"]);

    const donorTwo = { ...donorOne, playerId: "p4", seatIndex: 4 };
    const twoOdd = settleHand({ ...base, config: { ...base.config, maxSeats: 5 }, buttonSeat: 0, board, players: [...winners, donorOne, donorTwo] });
    expect(twoOdd.pots[0]?.oddChipRecipients).toEqual(["p1", "p2"]);
  });

  it("splits one canonical tied pot once instead of moving odd chips between redundant layers", () => {
    const board = ["As", "Ks", "Qs", "Js", "Ts"].map(parseCard);
    const boardCodes = new Set(board.map(serializeCard));
    const remaining = createStandardDeck().filter((card) => !boardCodes.has(serializeCard(card)));
    const deck = [...remaining.slice(0, 10), ...board, ...remaining.slice(10)];
    let state = startHand({
      handId: "canonical-odd-chip",
      config: { maxSeats: 5, smallBlind: 1, bigBlind: 2 },
      seats: [43, 52, 27, 33, 54].map((stack, seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack, isParticipating: true })),
      previousButtonSeat: 4,
      deck,
    }).state;
    const actions: readonly PlayerAction[] = [
      { actionType: "allIn", playerId: "p3" },
      { actionType: "call", playerId: "p4" },
      { actionType: "call", playerId: "p0" },
      { actionType: "fold", playerId: "p1" },
      { actionType: "fold", playerId: "p2" },
      { actionType: "check", playerId: "p4" },
      { actionType: "bet", amount: 2, playerId: "p0" },
      { actionType: "allIn", playerId: "p4" },
      { actionType: "allIn", playerId: "p0" },
    ];
    for (const action of actions) state = applyPlayerAction(state, action).state;

    expect(state.status).toBe("finished");
    expect(state.settlement?.pots.map((pot) => ({ amount: pot.amount, awards: pot.awards }))).toEqual([
      { amount: 102, awards: { p0: 34, p3: 34, p4: 34 } },
      { amount: 20, awards: { p0: 10, p4: 10 } },
      { amount: 11, awards: { p4: 11 } },
    ]);
    expect(state.settlement?.awardsByPlayer).toEqual({ p0: 44, p3: 34, p4: 55 });
    expect(state.settlement?.uncalledReturnsByPlayer).toEqual({});
  });
});
