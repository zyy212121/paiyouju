import { InvalidRandomSourceError } from "./errors.js";
import type { RandomIntSource } from "./random.js";

export function shuffleCards<T>(
  items: readonly T[],
  source: RandomIntSource,
): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const exclusiveMax = index + 1;
    const swapIndex = source.nextInt(exclusiveMax);

    if (
      !Number.isInteger(swapIndex) ||
      swapIndex < 0 ||
      swapIndex >= exclusiveMax
    ) {
      throw new InvalidRandomSourceError(
        `Random source returned ${String(swapIndex)} for exclusive maximum ${exclusiveMax}`,
      );
    }

    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (current === undefined || replacement === undefined) {
      throw new InvalidRandomSourceError("Shuffle index escaped array bounds");
    }

    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }

  return shuffled;
}
