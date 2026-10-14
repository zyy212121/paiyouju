import { describe, expect, it } from "vitest";
import { chooseBotAction, createSeededRandom, planSimulationShards, runSimulation } from "./index.js";
import { createStandardDeck } from "../deck.js";
import { getLegalActions, startHand } from "../engine/index.js";

describe("seeded simulation", () => {
  it("produces a reproducible bounded integer sequence", () => {
    const left = createSeededRandom(123456);
    const right = createSeededRandom(123456);
    expect(Array.from({ length: 20 }, () => left.nextInt(97))).toEqual(Array.from({ length: 20 }, () => right.nextInt(97)));
  });

  it("chooses only an action represented by legal actions", () => {
    const state = startHand({
      handId: "bot", config: { maxSeats: 3, smallBlind: 5, bigBlind: 10 },
      seats: [0, 1, 2].map((seatIndex) => ({ playerId: `p${seatIndex}`, seatIndex, stack: 100, isParticipating: true })),
      previousButtonSeat: 2, deck: createStandardDeck(),
    }).state;
    const player = state.players.find((candidate) => candidate.seatIndex === state.currentActorSeat)!;
    const legal = getLegalActions(state, player.playerId);
    const action = chooseBotAction(state, player.playerId, createSeededRandom(7));
    expect(action.playerId).toBe(player.playerId);
    expect(["fold", "call", "raiseTo", "allIn"]).toContain(action.actionType);
    if (action.actionType === "raiseTo") expect(action.amount).toBe(legal.minimumRaiseTo);
  });

  it("reproduces identical simulation statistics for the same seed", () => {
    const left = runSimulation({ hands: 100, seed: 99 });
    const right = runSimulation({ hands: 100, seed: 99 });
    expect({ ...left, elapsedTimeMs: 0 }).toEqual({ ...right, elapsedTimeMs: 0 });
    expect(left).toMatchObject({ hands: 100, seed: 99, completed: 100, failed: 0, invariantFailures: 0 });
    expect(left.shortAllInHands).toBeGreaterThan(0);
    expect(left.sidePotHands).toBeGreaterThan(0);
  });

  it("plans an exact deterministic 100,000-hand run in bounded process shards", () => {
    const shards = planSimulationShards({ hands: 100_000, seed: 123456 });
    expect(shards).toHaveLength(10);
    expect(shards.reduce((sum, shard) => sum + shard.hands, 0)).toBe(100_000);
    expect(shards.every((shard) => shard.hands === 10_000)).toBe(true);
    expect(shards[0]).toEqual({ hands: 10_000, seed: 123456, shardIndex: 0 });
    expect(planSimulationShards({ hands: 100_000, seed: 123456 })).toEqual(shards);
    expect(new Set(shards.map((shard) => shard.seed)).size).toBe(10);
  });
});
