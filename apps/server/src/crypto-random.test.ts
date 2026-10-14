import { describe, expect, it } from "vitest";

import { cryptoRandomIntSource } from "./crypto-random.js";

describe("production cryptographic random integer source", () => {
  it.each([1, 2, 13, 52, 1_000])(
    "returns integers in [0, %i)",
    (exclusiveMax) => {
      for (let draw = 0; draw < 100; draw += 1) {
        const value = cryptoRandomIntSource.nextInt(exclusiveMax);

        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(exclusiveMax);
      }
    },
  );

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 48,
  ])(
    "rejects invalid exclusive maximum %s",
    (exclusiveMax) => {
      expect(() => cryptoRandomIntSource.nextInt(exclusiveMax)).toThrow(
        /exclusiveMax/i,
      );
    },
  );
});
