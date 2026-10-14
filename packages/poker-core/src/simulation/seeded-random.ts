import { InvalidRandomSourceError } from "../errors.js";
import type { RandomIntSource } from "../random.js";

export interface SeededRandom extends RandomIntSource {
  readonly seed: number;
}

export function createSeededRandom(seed: number): SeededRandom {
  if (!Number.isSafeInteger(seed)) throw new InvalidRandomSourceError("Seed must be a safe integer");
  let state = seed >>> 0;
  return {
    seed,
    nextInt(exclusiveMax: number): number {
      if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax <= 0) throw new InvalidRandomSourceError("exclusiveMax must be a positive safe integer");
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      const unsigned = (value ^ (value >>> 14)) >>> 0;
      return Math.floor((unsigned / 0x100000000) * exclusiveMax);
    },
  };
}
