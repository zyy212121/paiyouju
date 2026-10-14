import { describe, expect, it } from "vitest";
import type { PlayerHandState } from "./index.js";
import { buildDisplayPotAmounts, buildPots } from "./index.js";

function player(playerId: string, seatIndex: number, committed: number, hasFolded = false, isAllIn = false): PlayerHandState {
  return {
    playerId, seatIndex, startingStack: 1000, stack: 1000 - committed,
    committedThisStreet: committed, committedThisHand: committed,
    hasFolded, isAllIn, hasActedThisStreet: true,
    lastActedBetLevel: committed, lastActedFullRaiseSize: 20,
    holeCards: [{ rank: 2, suit: "clubs" }, { rank: 3, suit: "diamonds" }], holeCardsVisibility: "private",
  };
}

describe("pot construction", () => {
  it("builds arbitrary contribution layers with folded contributors", () => {
    const result = buildPots([
      player("a", 0, 100), player("b", 1, 200, true), player("c", 2, 300), player("d", 3, 300),
    ]);
    expect(result).toEqual({
      pots: [
        { amount: 400, contributors: ["a", "b", "c", "d"], eligiblePlayers: ["a", "c", "d"] },
        { amount: 500, contributors: ["b", "c", "d"], eligiblePlayers: ["c", "d"] },
      ],
      uncalledReturnsByPlayer: {},
    });
  });

  it("merges adjacent contribution layers that have the same eligible players", () => {
    expect(buildPots([
      player("folded-short", 0, 1, true),
      player("folded-medium", 1, 2, true),
      player("live-a", 2, 3),
      player("live-b", 3, 3),
    ])).toEqual({
      pots: [{ amount: 9, contributors: ["folded-short", "folded-medium", "live-a", "live-b"], eligiblePlayers: ["live-a", "live-b"] }],
      uncalledReturnsByPlayer: {},
    });
  });

  it("keeps unmatched committed chips in a locked terminal pot", () => {
    expect(buildPots([player("a", 0, 100), player("b", 1, 100), player("c", 2, 300)])).toEqual({
      pots: [
        { amount: 300, contributors: ["a", "b", "c"], eligiblePlayers: ["a", "b", "c"] },
        { amount: 200, contributors: ["c"], eligiblePlayers: ["c"] },
      ],
      uncalledReturnsByPlayer: {},
    });
  });

  it("supports nine players and keeps the ninth committed layer", () => {
    const result = buildPots(Array.from({ length: 9 }, (_, index) => player(`p${index}`, index, (index + 1) * 10)));
    expect(result.pots).toHaveLength(9);
    expect(result.pots.map((pot) => pot.amount)).toEqual([90, 80, 70, 60, 50, 40, 30, 20, 10]);
    expect(result.uncalledReturnsByPlayer).toEqual({});
  });

  it("awards every posted blind after a normal heads-up fold", () => {
    expect(buildPots([
      player("small-blind", 0, 10, true),
      player("big-blind", 1, 20),
    ])).toEqual({
      pots: [{ amount: 30, contributors: ["small-blind", "big-blind"], eligiblePlayers: ["big-blind"] }],
      uncalledReturnsByPlayer: {},
    });
  });

  it("merges folded-only dead-money layers into the nearest eligible pot", () => {
    expect(buildPots([
      player("fold-a", 0, 132, true), player("live-deep", 1, 122),
      player("fold-b", 2, 132, true), player("live-short", 3, 72),
    ])).toEqual({
      pots: [
        { amount: 288, contributors: ["fold-a", "live-deep", "fold-b", "live-short"], eligiblePlayers: ["live-deep", "live-short"] },
        { amount: 170, contributors: ["fold-a", "live-deep", "fold-b"], eligiblePlayers: ["live-deep"] },
      ],
      uncalledReturnsByPlayer: {},
    });
    expect(buildPots([player("folded", 0, 5, true), player("short", 1, 1)])).toEqual({
      pots: [{ amount: 6, contributors: ["folded", "short"], eligiblePlayers: ["short"] }],
      uncalledReturnsByPlayer: {},
    });
  });
});

describe("active-hand pot projection", () => {
  it("shows every currently committed chip without inventing a side pot before an all-in", () => {
    expect(buildDisplayPotAmounts([player("sb", 0, 10), player("bb", 1, 20)])).toEqual([30]);
    expect(buildDisplayPotAmounts([player("a", 0, 10), player("b", 1, 20), player("c", 2, 20)])).toEqual([50]);
    expect(buildDisplayPotAmounts([player("a", 0, 10), player("b", 1, 20), player("c", 2, 5324)])).toEqual([5354]);
  });

  it("creates display side pots only at all-in caps", () => {
    expect(buildDisplayPotAmounts([
      player("short", 0, 100, false, true),
      player("deep-a", 1, 200),
      player("deep-b", 2, 200),
    ])).toEqual([300, 200]);
    expect(buildDisplayPotAmounts([
      player("short", 0, 100, false, true),
      player("deep", 1, 300),
    ])).toEqual([400]);
    expect(buildDisplayPotAmounts([
      player("short", 0, 100, false, true),
      player("middle", 1, 200, false, true),
      player("deep-a", 2, 300),
      player("deep-b", 3, 300),
    ])).toEqual([400, 300, 200]);
  });
});
