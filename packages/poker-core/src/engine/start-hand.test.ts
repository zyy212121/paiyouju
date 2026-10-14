import { describe, expect, it } from "vitest";

import { createStandardDeck } from "../deck.js";
import { PokerRuleError, getNextButtonSeat, startHand } from "./index.js";

const config = { maxSeats: 6, smallBlind: 10, bigBlind: 20 } as const;

describe("button and hand start", () => {
  it("skips empty, sitting-out, and zero-stack seats when rotating the button", () => {
    const seats = [
      { playerId: "zero", seatIndex: 0, stack: 0, isParticipating: true },
      { playerId: "paused", seatIndex: 2, stack: 100, isParticipating: false },
      { playerId: "p3", seatIndex: 3, stack: 100, isParticipating: true },
      { playerId: "p5", seatIndex: 5, stack: 100, isParticipating: true },
    ];

    expect(getNextButtonSeat(seats, 5, 6)).toBe(3);
    expect(getNextButtonSeat(seats, 3, 6)).toBe(5);
  });

  it("uses heads-up button/small-blind order and posts short blinds all-in", () => {
    const deck = createStandardDeck();
    const result = startHand({
      handId: "hu-1",
      config: { maxSeats: 2, smallBlind: 10, bigBlind: 20 },
      seats: [
        { playerId: "button", seatIndex: 0, stack: 7, isParticipating: true },
        { playerId: "bb", seatIndex: 1, stack: 15, isParticipating: true },
      ],
      previousButtonSeat: 1,
      deck,
    });

    expect(result.state.buttonSeat).toBe(0);
    expect(result.state.smallBlindSeat).toBe(0);
    expect(result.state.bigBlindSeat).toBe(1);
    expect(result.state.currentActorSeat).toBeNull();
    expect(result.state.currentBet).toBe(15);
    expect(result.state.lastFullRaiseSize).toBe(20);
    expect(result.state.players.map((player) => [player.stack, player.committedThisHand, player.isAllIn])).toEqual([
      [7, 7, true],
      [15, 15, true],
    ]);
    expect(result.state.board).toHaveLength(5);
    expect(result.state.status).toBe("finished");
    expect(result.state.settlement).not.toBeNull();
    expect(result.state.players.reduce((sum, player) => sum + player.stack, 0)).toBe(22);
    expect(result.events.at(-1)?.eventType).toBe("HAND_FINISHED");
  });

  it("runs out immediately when a short big blind has no actionable opponent", () => {
    const result = startHand({
      handId: "short-bb", config: { maxSeats: 2, smallBlind: 5, bigBlind: 10 },
      seats: [
        { playerId: "button", seatIndex: 0, stack: 100, isParticipating: true },
        { playerId: "short-bb", seatIndex: 1, stack: 1, isParticipating: true },
      ],
      previousButtonSeat: 1, deck: createStandardDeck(),
    });
    expect(result.state.status).toBe("finished");
    expect(result.state.board).toHaveLength(5);
    expect(result.state.currentActorSeat).toBeNull();
    expect(result.state.settlement?.pots.map((pot) => ({ amount: pot.amount, winners: pot.winners }))).toEqual([
      { amount: 2, winners: expect.any(Array) },
      { amount: 4, winners: ["button"] },
    ]);
    expect(result.state.settlement?.uncalledReturnsByPlayer).toEqual({});
    expect(result.events.map((domainEvent) => domainEvent.eventType)).toEqual(expect.arrayContaining([
      "CARDS_REVEALED", "POT_AWARDED", "HAND_FINISHED",
    ]));
    expect(result.events.some((domainEvent) => domainEvent.eventType === "UNCALLED_BET_RETURNED")).toBe(false);
  });

  it("assigns multiway blinds and preflop actor clockwise across gaps", () => {
    const input = {
      handId: "multi-1",
      config,
      seats: [
        { playerId: "p0", seatIndex: 0, stack: 100, isParticipating: true },
        { playerId: "p2", seatIndex: 2, stack: 100, isParticipating: true },
        { playerId: "p5", seatIndex: 5, stack: 100, isParticipating: true },
      ],
      previousButtonSeat: 5,
      deck: createStandardDeck(),
    } as const;
    const snapshot = {
      ...input,
      seats: input.seats.map((seat) => ({ ...seat })),
      deck: input.deck.map((card) => ({ ...card })),
    };
    const result = startHand(input);

    expect(result.state.buttonSeat).toBe(0);
    expect(result.state.smallBlindSeat).toBe(2);
    expect(result.state.bigBlindSeat).toBe(5);
    expect(result.state.currentActorSeat).toBe(0);
    expect(result.state.players.map((player) => player.committedThisStreet)).toEqual([0, 10, 20]);
    expect(result.state.players.every((player) => player.holeCards.length === 2)).toBe(true);
    expect(result.state.deck).toHaveLength(46);
    expect(result.state.stateVersion).toBe(1);
    expect(input).toEqual(snapshot);
    expect(result.events.map((event) => event.eventType)).toEqual([
      "HAND_STARTED", "BUTTON_ASSIGNED", "BLIND_POSTED", "BLIND_POSTED", "HOLE_CARDS_DEALT",
    ]);
  });

  it("posts one forced bomb blind for every player and starts directly on the flop", () => {
    const result = startHand({
      bombPotBlind: 60,
      config,
      deck: createStandardDeck(),
      handId: "bomb-pot-1",
      previousButtonSeat: 5,
      seats: [
        { isParticipating: true, playerId: "p0", seatIndex: 0, stack: 200 },
        { isParticipating: true, playerId: "p2", seatIndex: 2, stack: 50 },
        { isParticipating: true, playerId: "p5", seatIndex: 5, stack: 200 },
      ],
    });

    expect(result.state.bombPotBlind).toBe(60);
    expect(result.state.street).toBe("flop");
    expect(result.state.board).toHaveLength(3);
    expect(result.state.currentBet).toBe(0);
    expect(result.state.currentActorSeat).toBe(5);
    expect(result.state.players.map((player) => ({
      committedThisHand: player.committedThisHand,
      committedThisStreet: player.committedThisStreet,
      isAllIn: player.isAllIn,
      stack: player.stack,
    }))).toEqual([
      { committedThisHand: 60, committedThisStreet: 0, isAllIn: false, stack: 140 },
      { committedThisHand: 50, committedThisStreet: 0, isAllIn: true, stack: 0 },
      { committedThisHand: 60, committedThisStreet: 0, isAllIn: false, stack: 140 },
    ]);
    expect(result.events.filter((domainEvent) => domainEvent.eventType === "BLIND_POSTED").map((domainEvent) => domainEvent.amount)).toEqual([60, 50, 60]);
    expect(result.events.map((domainEvent) => domainEvent.eventType)).toEqual([
      "HAND_STARTED", "BUTTON_ASSIGNED", "BLIND_POSTED", "BLIND_POSTED", "BLIND_POSTED",
      "HOLE_CARDS_DEALT", "STREET_ADVANCED", "BOARD_DEALT",
    ]);
  });

  it("runs out and settles a bomb hand immediately when forced blinds leave no betting decision", () => {
    const result = startHand({
      bombPotBlind: 60,
      config: { maxSeats: 2, smallBlind: 10, bigBlind: 20 },
      deck: createStandardDeck(),
      handId: "bomb-pot-all-in",
      previousButtonSeat: 1,
      seats: [
        { isParticipating: true, playerId: "button", seatIndex: 0, stack: 30 },
        { isParticipating: true, playerId: "other", seatIndex: 1, stack: 30 },
      ],
    });

    expect(result.state).toMatchObject({ bombPotBlind: 60, currentActorSeat: null, status: "finished" });
    expect(result.state.board).toHaveLength(5);
    expect(result.state.players.every((player) => player.isAllIn)).toBe(true);
    expect(result.state.settlement?.pots.reduce((sum, pot) => sum + pot.amount, 0)).toBe(60);
    expect(result.events.filter((domainEvent) => domainEvent.eventType === "BLIND_POSTED").map((domainEvent) => domainEvent.amount)).toEqual([30, 30]);
    expect(result.events.at(-1)?.eventType).toBe("HAND_FINISHED");
  });

  it.each([
    [{ maxSeats: 1, smallBlind: 10, bigBlind: 20 }, "INVALID_TABLE_CONFIG"],
    [{ maxSeats: 6, smallBlind: 0, bigBlind: 20 }, "INVALID_TABLE_CONFIG"],
    [{ maxSeats: 6, smallBlind: 20, bigBlind: 20 }, "INVALID_TABLE_CONFIG"],
  ] as const)("rejects invalid table config %#", (invalidConfig, code) => {
    expect(() => startHand({
      handId: "bad",
      config: invalidConfig,
      seats: [],
      previousButtonSeat: null,
      deck: createStandardDeck(),
    })).toThrowError(expect.objectContaining({ code }));
  });

  it("requires two eligible players", () => {
    expect(() => startHand({
      handId: "lonely",
      config,
      seats: [{ playerId: "p0", seatIndex: 0, stack: 100, isParticipating: true }],
      previousButtonSeat: null,
      deck: createStandardDeck(),
    })).toThrowError(PokerRuleError);
  });
});
