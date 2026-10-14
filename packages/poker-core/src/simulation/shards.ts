import type { SimulationOptions } from "./simulate.js";

export interface SimulationShard extends SimulationOptions { readonly shardIndex: number }

export function planSimulationShards(options: SimulationOptions, maximumHandsPerShard = 10_000): readonly SimulationShard[] {
  if (!Number.isSafeInteger(options.hands) || options.hands <= 0 || !Number.isSafeInteger(options.seed) || !Number.isSafeInteger(maximumHandsPerShard) || maximumHandsPerShard <= 0) {
    throw new RangeError("Simulation shard options must be positive safe integers with a safe integer seed");
  }
  const shards: SimulationShard[] = [];
  let remaining = options.hands;
  for (let shardIndex = 0; remaining > 0; shardIndex += 1) {
    const hands = Math.min(remaining, maximumHandsPerShard);
    const seed = shardIndex === 0 ? options.seed : options.seed + shardIndex * 1_000_003;
    if (!Number.isSafeInteger(seed)) throw new RangeError("Derived shard seed exceeds safe integer range");
    shards.push({ hands, seed, shardIndex });
    remaining -= hands;
  }
  return shards;
}
