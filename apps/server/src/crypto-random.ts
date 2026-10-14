import { randomInt } from "node:crypto";

import type { RandomIntSource } from "@paiyouju/poker-core";

const MAX_RANDOM_INT_EXCLUSIVE = 2 ** 48 - 1;

export const cryptoRandomIntSource: RandomIntSource = {
  nextInt(exclusiveMax: number): number {
    if (
      !Number.isSafeInteger(exclusiveMax) ||
      exclusiveMax <= 0 ||
      exclusiveMax > MAX_RANDOM_INT_EXCLUSIVE
    ) {
      throw new RangeError(
        `exclusiveMax must be a positive safe integer no greater than ${MAX_RANDOM_INT_EXCLUSIVE}`,
      );
    }

    return randomInt(exclusiveMax);
  },
};
