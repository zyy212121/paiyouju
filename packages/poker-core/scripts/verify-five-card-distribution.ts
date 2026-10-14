import { performance } from "node:perf_hooks";
import process from "node:process";

import { createStandardDeck } from "../src/deck.js";
import {
  EXPECTED_FIVE_CARD_DISTRIBUTION,
  HAND_CATEGORY_COUNT,
  HAND_CATEGORY_NAMES,
  countFiveCardDistribution,
} from "../src/five-card-distribution.js";
import type { HandCategory } from "../src/hand-types.js";

const expectedTotal = 2_598_960;
const startedAt = performance.now();
const result = countFiveCardDistribution(createStandardDeck());
let passed = result.total === expectedTotal;

for (let category = 0; category < HAND_CATEGORY_COUNT; category += 1) {
  const handCategory = category as HandCategory;
  const actual = result.counts[category] ?? 0;
  const expected = EXPECTED_FIVE_CARD_DISTRIBUTION[category] ?? 0;
  const matches = actual === expected;
  passed = passed && matches;
  process.stdout.write(
    `${HAND_CATEGORY_NAMES[handCategory]}: ${actual.toLocaleString("en-US")} ` +
      `(expected ${expected.toLocaleString("en-US")}) ${matches ? "PASS" : "FAIL"}\n`,
  );
}

process.stdout.write(
  `Total: ${result.total.toLocaleString("en-US")} ` +
    `(expected ${expectedTotal.toLocaleString("en-US")}) ` +
    `${result.total === expectedTotal ? "PASS" : "FAIL"}\n`,
);
process.stdout.write(
  `Elapsed: ${((performance.now() - startedAt) / 1_000).toFixed(3)}s\n`,
);

if (!passed) {
  process.exitCode = 1;
}
