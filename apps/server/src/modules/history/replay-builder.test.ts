import { describe, expect, it } from "vitest";

import { buildHandReplayTimeline, ReplayNotAvailableError, type BuildReplayInput } from "./replay-builder.js";

function foldFixture(visibility: "HIDDEN" | "PURCHASED" = "HIDDEN"): BuildReplayInput {
  return {
    actions: [{ actionType: "FOLD", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "alice" }],
    hand: { bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN", id: "10000000-0000-4000-8000-000000000008", smallBlindAmount: 10, smallBlindSeat: 0 },
    players: [
      { allIn: false, committed: 10, endingStack: 390, folded: true, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 400, userId: "alice" },
      { allIn: false, committed: 20, endingStack: 410, folded: false, holeCards: ["Qc", "Jh"], holeCardsVisibility: visibility, nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "bob" },
    ],
    pots: [{ amount: 30, contributors: ["alice", "bob"], eligiblePlayers: ["bob"], oddChipRecipients: [], potIndex: 0, winners: ["bob"] }],
  };
}

describe("buildHandReplayTimeline", () => {
  it("reconstructs a heads-up fold with all posted blinds awarded through the pot", () => {
    const replay = buildHandReplayTimeline({
      actions: [{ actionType: "FOLD", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "alice" }],
      hand: { bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN", id: "10000000-0000-4000-8000-000000000001", smallBlindAmount: 10, smallBlindSeat: 0 },
      players: [
        { allIn: false, committed: 10, endingStack: 390, folded: true, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 400, userId: "alice" },
        { allIn: false, committed: 20, endingStack: 410, folded: false, holeCards: ["Qc", "Jh"], holeCardsVisibility: "HIDDEN", nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "bob" },
      ],
      pots: [{ amount: 30, contributors: ["alice", "bob"], eligiblePlayers: ["bob"], oddChipRecipients: [], potIndex: 0, winners: ["bob"] }],
    });

    expect(replay.events.map((event) => event.type)).toEqual([
      "HAND_STARTED", "BLIND_POSTED", "BLIND_POSTED", "PLAYER_FOLDED",
      "POT_AWARDED", "HAND_FINISHED",
    ]);
    expect(replay.finalState.pot).toBe(0);
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([390, 410]);
    expect(JSON.stringify(replay)).not.toContain("Qc");
    expect(JSON.stringify(replay)).not.toContain("Jh");
  });

  it("keeps read-only replay compatibility for a legacy persisted return record", () => {
    const legacy = foldFixture();
    const replay = buildHandReplayTimeline({
      ...legacy,
      pots: [{ ...legacy.pots[0]!, amount: 20 }],
    });

    expect(replay.events.map((event) => event.type)).toContain("UNCALLED_BET_RETURNED");
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([390, 410]);
  });

  it("rejects incomplete contributions instead of guessing", () => {
    expect(() => buildHandReplayTimeline({
      actions: [],
      hand: { bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN", id: "10000000-0000-4000-8000-000000000002", smallBlindAmount: 10, smallBlindSeat: 0 },
      players: [
        { allIn: false, committed: 30, endingStack: 390, folded: true, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 400, userId: "alice" },
        { allIn: false, committed: 20, endingStack: 410, folded: false, holeCards: ["Qc", "Jh"], holeCardsVisibility: "HIDDEN", nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "bob" },
      ],
      pots: [{ amount: 40, contributors: ["alice", "bob"], eligiblePlayers: ["bob"], oddChipRecipients: [], potIndex: 0, winners: ["bob"] }],
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects a fold-to-win record whose decisive fold action is missing", () => {
    expect(() => buildHandReplayTimeline({
      actions: [],
      hand: { bigBlindAmount: 20, bigBlindSeat: 1, board: [], buttonSeat: 0, finishReason: "FOLD_TO_WIN", id: "10000000-0000-4000-8000-000000000007", smallBlindAmount: 10, smallBlindSeat: 0 },
      players: [
        { allIn: false, committed: 10, endingStack: 390, folded: true, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 400, userId: "alice" },
        { allIn: false, committed: 20, endingStack: 410, folded: false, holeCards: ["Qc", "Jh"], holeCardsVisibility: "HIDDEN", nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "bob" },
      ],
      pots: [{ amount: 30, contributors: ["alice", "bob"], eligiblePlayers: ["bob"], oddChipRecipients: [], potIndex: 0, winners: ["bob"] }],
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects duplicate terminal actions and non-contiguous action state versions", () => {
    const duplicateFold = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...duplicateFold,
      actions: [
        ...duplicateFold.actions,
        { ...duplicateFold.actions[0]!, sequence: 2, stateVersion: 3 },
      ],
    })).toThrow(ReplayNotAvailableError);

    const reverseVersion = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...reverseVersion,
      actions: [
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 1, stateVersion: 5, street: "PREFLOP", userId: "bob" },
        { ...reverseVersion.actions[0]!, sequence: 2, stateVersion: 4 },
      ],
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects actions or board cards after an uncontested fold terminal", () => {
    const folded = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...folded,
      actions: [
        ...folded.actions,
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "bob" },
      ],
    })).toThrow(ReplayNotAvailableError);
    expect(() => buildHandReplayTimeline({
      ...folded,
      hand: { ...folded.hand, board: ["2c", "3d", "4h"] },
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects an action after a player is all-in", () => {
    expect(() => buildHandReplayTimeline({
      actions: [
        { actionType: "ALL_IN", amount: 10, automatic: false, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "alice" },
      ],
      hand: { bigBlindAmount: 20, bigBlindSeat: 1, board: ["2c", "3d", "4h", "5s", "9c"], buttonSeat: 0, finishReason: "SHOWDOWN", id: "10000000-0000-4000-8000-000000000009", smallBlindAmount: 10, smallBlindSeat: 0 },
      players: [
        { allIn: true, committed: 20, endingStack: 0, folded: false, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 20, userId: "alice" },
        { allIn: false, committed: 20, endingStack: 420, folded: false, holeCards: ["Qc", "Jh"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "bob" },
      ],
      pots: [{ amount: 40, contributors: ["alice", "bob"], eligiblePlayers: ["alice", "bob"], oddChipRecipients: [], potIndex: 0, winners: ["bob"] }],
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects player actions at showdown and illegal check/call records", () => {
    const folded = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...folded,
      actions: [{ ...folded.actions[0]!, actionType: "CHECK", userId: "alice" }],
    })).toThrow(ReplayNotAvailableError);
    expect(() => buildHandReplayTimeline({
      ...folded,
      actions: [{ ...folded.actions[0]!, actionType: "CALL", amount: 9, userId: "alice" }],
    })).toThrow(ReplayNotAvailableError);
    expect(() => buildHandReplayTimeline({
      ...folded,
      actions: [{ ...folded.actions[0]!, actionType: "CHECK", street: "SHOWDOWN", userId: "alice" }],
    })).toThrow(ReplayNotAvailableError);
  });

  it("rejects duplicate pot members and duplicate physical cards", () => {
    const duplicateMembers = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...duplicateMembers,
      pots: [{ ...duplicateMembers.pots[0]!, contributors: ["alice", "alice"] }],
    })).toThrow(ReplayNotAvailableError);

    const duplicateCard = foldFixture();
    expect(() => buildHandReplayTimeline({
      ...duplicateCard,
      players: [duplicateCard.players[0]!, { ...duplicateCard.players[1]!, holeCards: ["As", "Jh"] }],
    })).toThrow(ReplayNotAvailableError);
  });

  it("places purchased authorization after the durable hand-finished event", () => {
    const replay = buildHandReplayTimeline(foldFixture("PURCHASED"));
    const finished = replay.events.findIndex((event) => event.type === "HAND_FINISHED");
    const purchased = replay.events.findIndex((event) => event.visibility === "PURCHASED_AFTER_HAND");
    expect(finished).toBeGreaterThanOrEqual(0);
    expect(purchased).toBeGreaterThan(finished);
  });

  it("reconstructs every street of a heads-up showdown deterministically", () => {
    const input = {
      actions: [
        { actionType: "CALL", amount: 5, automatic: false, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 3, stateVersion: 4, street: "FLOP", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 4, stateVersion: 5, street: "FLOP", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 5, stateVersion: 6, street: "TURN", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 6, stateVersion: 7, street: "TURN", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 7, stateVersion: 8, street: "RIVER", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 8, stateVersion: 9, street: "RIVER", userId: "alice" },
      ] as const,
      hand: { bigBlindAmount: 10, bigBlindSeat: 1, board: ["2c", "3d", "4h", "5s", "9c"], buttonSeat: 0, finishReason: "SHOWDOWN", id: "10000000-0000-4000-8000-000000000003", smallBlindAmount: 5, smallBlindSeat: 0 } as const,
      players: [
        { allIn: false, committed: 10, endingStack: 110, folded: false, holeCards: ["As", "Ad"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 100, userId: "alice" },
        { allIn: false, committed: 10, endingStack: 90, folded: false, holeCards: ["Ks", "Kd"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Bob", seatIndex: 1, startingStack: 100, userId: "bob" },
      ] as const,
      pots: [{ amount: 20, contributors: ["alice", "bob"], eligiblePlayers: ["alice", "bob"], oddChipRecipients: [], potIndex: 0, winners: ["alice"] }] as const,
    };
    const replay = buildHandReplayTimeline(input);
    expect(buildHandReplayTimeline(input)).toEqual(replay);
    expect(replay.events.filter((event) => event.type.endsWith("_DEALT")).map((event) => [event.type, event.cards])).toEqual([
      ["FLOP_DEALT", ["2c", "3d", "4h"]],
      ["TURN_DEALT", ["5s"]],
      ["RIVER_DEALT", ["9c"]],
    ]);
    expect(replay.finalState).toMatchObject({ board: ["2c", "3d", "4h", "5s", "9c"], pot: 0, street: "SHOWDOWN", winners: ["alice"] });
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([110, 90]);
  });

  it("reconstructs a three-player all-in runout with every committed layer awarded", () => {
    const replay = buildHandReplayTimeline({
      actions: [
        { actionType: "ALL_IN", amount: 100, automatic: false, raiseTo: null, seatIndex: 0, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "short" },
        { actionType: "ALL_IN", amount: 295, automatic: false, raiseTo: null, seatIndex: 1, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "middle" },
        { actionType: "ALL_IN", amount: 690, automatic: false, raiseTo: null, seatIndex: 2, sequence: 3, stateVersion: 4, street: "PREFLOP", userId: "deep" },
      ],
      hand: { bigBlindAmount: 10, bigBlindSeat: 2, board: ["2c", "7d", "9h", "Js", "Qc"], buttonSeat: 0, finishReason: "SHOWDOWN", id: "10000000-0000-4000-8000-000000000004", smallBlindAmount: 5, smallBlindSeat: 1 },
      players: [
        { allIn: true, committed: 100, endingStack: 300, folded: false, holeCards: ["As", "Ad"], holeCardsVisibility: "OWN", nickname: "Short", seatIndex: 0, startingStack: 100, userId: "short" },
        { allIn: true, committed: 300, endingStack: 400, folded: false, holeCards: ["Ks", "Kd"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Middle", seatIndex: 1, startingStack: 300, userId: "middle" },
        { allIn: true, committed: 700, endingStack: 400, folded: false, holeCards: ["Ts", "Td"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Deep", seatIndex: 2, startingStack: 700, userId: "deep" },
      ],
      pots: [
        { amount: 300, contributors: ["short", "middle", "deep"], eligiblePlayers: ["short", "middle", "deep"], oddChipRecipients: [], potIndex: 0, winners: ["short"] },
        { amount: 400, contributors: ["middle", "deep"], eligiblePlayers: ["middle", "deep"], oddChipRecipients: [], potIndex: 1, winners: ["middle"] },
        { amount: 400, contributors: ["deep"], eligiblePlayers: ["deep"], oddChipRecipients: [], potIndex: 2, winners: ["deep"] },
      ],
    });
    expect(replay.events.filter((event) => event.type === "PLAYER_ALL_IN")).toHaveLength(3);
    expect(replay.events.some((event) => event.type === "UNCALLED_BET_RETURNED")).toBe(false);
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([300, 400, 400]);
    expect(replay.finalState.pot).toBe(0);
    expect(replay.finalState.pots.every((amount) => amount === 0)).toBe(true);
  });

  it("reconstructs a split pot with an odd chip and preserves raise-to semantics", () => {
    const input: BuildReplayInput = {
      actions: [
        { actionType: "RAISE_TO", amount: 5, automatic: false, raiseTo: 5, seatIndex: 2, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "carol" },
        { actionType: "CALL", amount: 4, automatic: false, raiseTo: null, seatIndex: 0, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "alice" },
        { actionType: "CALL", amount: 3, automatic: false, raiseTo: null, seatIndex: 1, sequence: 3, stateVersion: 4, street: "PREFLOP", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 4, stateVersion: 5, street: "FLOP", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 5, stateVersion: 6, street: "FLOP", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 2, sequence: 6, stateVersion: 7, street: "FLOP", userId: "carol" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 7, stateVersion: 8, street: "TURN", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 8, stateVersion: 9, street: "TURN", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 2, sequence: 9, stateVersion: 10, street: "TURN", userId: "carol" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 10, stateVersion: 11, street: "RIVER", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 11, stateVersion: 12, street: "RIVER", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 2, sequence: 12, stateVersion: 13, street: "RIVER", userId: "carol" },
      ],
      hand: { bigBlindAmount: 2, bigBlindSeat: 1, board: ["As", "Kd", "Qc", "Jh", "2s"], buttonSeat: 2, finishReason: "SHOWDOWN", id: "10000000-0000-4000-8000-000000000005", smallBlindAmount: 1, smallBlindSeat: 0 },
      players: [
        { allIn: false, committed: 5, endingStack: 103, folded: false, holeCards: ["Tc", "3d"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 100, userId: "alice" },
        { allIn: false, committed: 5, endingStack: 102, folded: false, holeCards: ["Th", "4d"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Bob", seatIndex: 1, startingStack: 100, userId: "bob" },
        { allIn: false, committed: 5, endingStack: 95, folded: false, holeCards: ["9c", "9d"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Carol", seatIndex: 2, startingStack: 100, userId: "carol" },
      ],
      pots: [{ amount: 15, contributors: ["alice", "bob", "carol"], eligiblePlayers: ["alice", "bob", "carol"], oddChipRecipients: ["alice"], potIndex: 0, winners: ["alice", "bob"] }],
    };
    const replay = buildHandReplayTimeline(input);
    expect(replay.events.find((event) => event.type === "PLAYER_RAISED")).toMatchObject({ amount: 5, raiseTo: 5 });
    expect(replay.events.find((event) => event.type === "ODD_CHIP_AWARDED")).toMatchObject({ actorUserId: "alice", amount: 1 });
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([103, 102, 95]);
    expect(replay.finalState.pot).toBe(0);
    expect(() => buildHandReplayTimeline({
      ...input,
      actions: input.actions.map((action, index) => index === 0 ? { ...action, raiseTo: 6 } : action),
    })).toThrow(ReplayNotAvailableError);
  });

  it("consumes folded dead-money layers exactly as the committed pot records do", () => {
    const input: BuildReplayInput = {
      actions: [
        { actionType: "RAISE_TO", amount: 20, automatic: false, raiseTo: 20, seatIndex: 2, sequence: 1, stateVersion: 2, street: "PREFLOP", userId: "fold-b" },
        { actionType: "CALL", amount: 20, automatic: false, raiseTo: null, seatIndex: 3, sequence: 2, stateVersion: 3, street: "PREFLOP", userId: "live-short" },
        { actionType: "FOLD", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 3, stateVersion: 4, street: "PREFLOP", userId: "fold-a" },
        { actionType: "CALL", amount: 18, automatic: false, raiseTo: null, seatIndex: 1, sequence: 4, stateVersion: 5, street: "PREFLOP", userId: "live-deep" },
        { actionType: "BET", amount: 20, automatic: false, raiseTo: null, seatIndex: 1, sequence: 5, stateVersion: 6, street: "FLOP", userId: "live-deep" },
        { actionType: "CALL", amount: 20, automatic: false, raiseTo: null, seatIndex: 2, sequence: 6, stateVersion: 7, street: "FLOP", userId: "fold-b" },
        { actionType: "ALL_IN", amount: 52, automatic: false, raiseTo: null, seatIndex: 3, sequence: 7, stateVersion: 8, street: "FLOP", userId: "live-short" },
        { actionType: "ALL_IN", amount: 82, automatic: false, raiseTo: null, seatIndex: 1, sequence: 8, stateVersion: 9, street: "FLOP", userId: "live-deep" },
        { actionType: "FOLD", amount: null, automatic: false, raiseTo: null, seatIndex: 2, sequence: 9, stateVersion: 10, street: "FLOP", userId: "fold-b" },
      ],
      hand: { bigBlindAmount: 2, bigBlindSeat: 1, board: ["2c", "3d", "4h", "5s", "9c"], buttonSeat: 3, finishReason: "SHOWDOWN", id: "10000000-0000-4000-8000-000000000006", smallBlindAmount: 1, smallBlindSeat: 0 },
      players: [
        { allIn: false, committed: 1, endingStack: 199, folded: true, holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", nickname: "Fold A", seatIndex: 0, startingStack: 200, userId: "fold-a" },
        { allIn: true, committed: 122, endingStack: 50, folded: false, holeCards: ["Qs", "Qd"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Live Deep", seatIndex: 1, startingStack: 122, userId: "live-deep" },
        { allIn: false, committed: 40, endingStack: 160, folded: true, holeCards: ["Js", "Jd"], holeCardsVisibility: "HIDDEN", nickname: "Fold B", seatIndex: 2, startingStack: 200, userId: "fold-b" },
        { allIn: true, committed: 72, endingStack: 185, folded: false, holeCards: ["6s", "7d"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Live Short", seatIndex: 3, startingStack: 72, userId: "live-short" },
      ],
      pots: [
        { amount: 185, contributors: ["fold-a", "live-deep", "fold-b", "live-short"], eligiblePlayers: ["live-deep", "live-short"], oddChipRecipients: [], potIndex: 0, winners: ["live-short"] },
        { amount: 50, contributors: ["live-deep"], eligiblePlayers: ["live-deep"], oddChipRecipients: [], potIndex: 1, winners: ["live-deep"] },
      ],
    };
    const replay = buildHandReplayTimeline(input);
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([199, 50, 160, 185]);
    expect(replay.finalState.pots.every((amount) => amount === 0)).toBe(true);
    expect(JSON.stringify(replay)).not.toContain("Js");
    expect(JSON.stringify(replay)).not.toContain("Jd");

    const legacyReplay = buildHandReplayTimeline({
      ...input,
      pots: [
        { amount: 4, contributors: ["fold-a", "live-deep", "fold-b", "live-short"], eligiblePlayers: ["live-deep", "live-short"], oddChipRecipients: [], potIndex: 0, winners: ["live-short"] },
        { amount: 117, contributors: ["live-deep", "fold-b", "live-short"], eligiblePlayers: ["live-deep", "live-short"], oddChipRecipients: [], potIndex: 1, winners: ["live-short"] },
        { amount: 64, contributors: ["live-deep", "live-short"], eligiblePlayers: ["live-deep", "live-short"], oddChipRecipients: [], potIndex: 2, winners: ["live-short"] },
        { amount: 50, contributors: ["live-deep"], eligiblePlayers: ["live-deep"], oddChipRecipients: [], potIndex: 3, winners: ["live-deep"] },
      ],
    });
    expect(legacyReplay.finalState.players.map((player) => player.stack)).toEqual([199, 50, 160, 185]);

    expect(() => buildHandReplayTimeline({
      ...input,
      actions: [
        ...input.actions,
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 10, stateVersion: 11, street: "FLOP", userId: "live-deep" },
      ],
    })).toThrow(ReplayNotAvailableError);
  });

  it("replays every forced bomb blind and begins betting on the flop", () => {
    const replay = buildHandReplayTimeline({
      actions: [
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 1, stateVersion: 2, street: "FLOP", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 2, stateVersion: 3, street: "FLOP", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 3, stateVersion: 4, street: "TURN", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 4, stateVersion: 5, street: "TURN", userId: "alice" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 1, sequence: 5, stateVersion: 6, street: "RIVER", userId: "bob" },
        { actionType: "CHECK", amount: null, automatic: false, raiseTo: null, seatIndex: 0, sequence: 6, stateVersion: 7, street: "RIVER", userId: "alice" },
      ],
      hand: {
        bigBlindAmount: 20,
        bigBlindSeat: 1,
        board: ["2h", "3d", "4s", "8h", "9d"],
        bombPotBlindAmount: 30,
        buttonSeat: 0,
        finishReason: "SHOWDOWN",
        id: "10000000-0000-4000-8000-000000000010",
        smallBlindAmount: 10,
        smallBlindSeat: 0,
      },
      players: [
        { allIn: false, committed: 30, endingStack: 130, folded: false, holeCards: ["As", "Ad"], holeCardsVisibility: "OWN", nickname: "Alice", seatIndex: 0, startingStack: 100, userId: "alice" },
        { allIn: false, committed: 30, endingStack: 70, folded: false, holeCards: ["Kc", "Qc"], holeCardsVisibility: "PUBLIC_SHOWDOWN", nickname: "Bob", seatIndex: 1, startingStack: 100, userId: "bob" },
      ],
      pots: [{ amount: 60, contributors: ["alice", "bob"], eligiblePlayers: ["alice", "bob"], oddChipRecipients: [], potIndex: 0, winners: ["alice"] }],
    });

    expect(replay.events.slice(0, 4).map((event) => event.type)).toEqual(["HAND_STARTED", "BLIND_POSTED", "BLIND_POSTED", "FLOP_DEALT"]);
    expect(replay.events.filter((event) => event.type === "BLIND_POSTED").map((event) => event.amount)).toEqual([30, 30]);
    expect(replay.finalState.players.map((player) => player.stack)).toEqual([130, 70]);
  });
});
