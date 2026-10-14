import { describe, expect, it } from "vitest";

import {
  HandCategory,
  compareHandStrength,
  createShortDeck,
  evaluateFiveCards,
  parseCard,
  serializeCard,
  settleHand,
  startHand,
} from "./index.js";

describe("short-deck rules", () => {
  it("builds exactly the 36 unique cards from six through ace", () => {
    const deck = createShortDeck();

    expect(deck).toHaveLength(36);
    expect(new Set(deck.map(serializeCard)).size).toBe(36);
    expect(deck.every((card) => card.rank >= 6)).toBe(true);
  });

  it("recognizes ace-six-seven-eight-nine as the lowest straight", () => {
    const result = evaluateFiveCards(
      ["Ac", "6d", "7h", "8s", "9c"].map(parseCard),
      "SHORT_DECK",
    );

    expect(result.category).toBe(HandCategory.Straight);
    expect(result.tiebreak).toEqual([9]);
    expect(result.bestFive.map(serializeCard)).toEqual(["9c", "8s", "7h", "6d", "Ac"]);
  });

  it("ranks a flush above a full house while keeping a straight above trips", () => {
    const flush = evaluateFiveCards(["Ac", "Qc", "Jc", "8c", "6c"].map(parseCard), "SHORT_DECK");
    const fullHouse = evaluateFiveCards(["As", "Ah", "Ad", "Ks", "Kh"].map(parseCard), "SHORT_DECK");
    const straight = evaluateFiveCards(["Ts", "9h", "8d", "7c", "6s"].map(parseCard), "SHORT_DECK");
    const trips = evaluateFiveCards(["Ks", "Kh", "Kd", "Qs", "Jh"].map(parseCard), "SHORT_DECK");

    expect(compareHandStrength(flush, fullHouse, "SHORT_DECK")).toBeGreaterThan(0);
    expect(compareHandStrength(straight, trips, "SHORT_DECK")).toBeGreaterThan(0);
  });

  it("starts a hand from a 36-card deck and preserves the variant in state", () => {
    const state = startHand({
      config: { bigBlind: 20, maxSeats: 2, smallBlind: 10, variant: "SHORT_DECK" },
      deck: createShortDeck(),
      handId: "short-deck-hand",
      previousButtonSeat: null,
      seats: [
        { isParticipating: true, playerId: "alice", seatIndex: 0, stack: 500 },
        { isParticipating: true, playerId: "bob", seatIndex: 1, stack: 500 },
      ],
    }).state;

    expect(state.config.variant).toBe("SHORT_DECK");
    expect(state.deck).toHaveLength(32);
    expect(state.players.flatMap((player) => player.holeCards).every((card) => card.rank >= 6)).toBe(true);
  });

  it("uses short-deck ranking during authoritative pot settlement", () => {
    const started = startHand({
      config: { bigBlind: 20, maxSeats: 2, smallBlind: 10, variant: "SHORT_DECK" },
      deck: createShortDeck(),
      handId: "short-deck-settlement",
      previousButtonSeat: null,
      seats: [
        { isParticipating: true, playerId: "flush", seatIndex: 0, stack: 500 },
        { isParticipating: true, playerId: "full-house", seatIndex: 1, stack: 500 },
      ],
    }).state;
    const board = ["Ac", "Kc", "Qc", "Ah", "Kh"].map(parseCard);
    const holeCards = [
      ["Jc", "9c"].map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>],
      ["Ad", "Kd"].map(parseCard) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>],
    ] as const;
    const used = new Set([...board, ...holeCards.flat()].map(serializeCard));
    const showdown = {
      ...started,
      board,
      currentActorSeat: null,
      deck: createShortDeck().filter((card) => !used.has(serializeCard(card))),
      players: started.players.map((player, index) => ({
        ...player,
        committedThisHand: 20,
        committedThisStreet: 20,
        holeCards: holeCards[index]!,
        isAllIn: true,
        stack: 480,
      })),
      street: "showdown" as const,
    };

    const settlement = settleHand(showdown);

    expect(settlement.pots[0]).toMatchObject({ amount: 40, winners: ["flush"] });
    expect(settlement.finalStacks).toEqual({ flush: 520, "full-house": 480 });
  });
});
