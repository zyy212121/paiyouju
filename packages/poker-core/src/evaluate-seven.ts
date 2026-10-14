import { serializeCard, type Card } from "./card.js";
import { combinationsOfFive } from "./combinations.js";
import { compareHandStrength } from "./compare.js";
import { evaluateFiveCards } from "./evaluate-five.js";
import type { HandEvaluation, PokerVariant } from "./hand-types.js";
import { validateUniqueCards } from "./validation.js";

function exactTieSignature(evaluation: HandEvaluation): string {
  return evaluation.bestFive.map(serializeCard).join("");
}

export function evaluateSevenCards(cards: readonly Card[], variant: PokerVariant = "STANDARD"): HandEvaluation {
  validateUniqueCards(cards, 7);

  let best: HandEvaluation | undefined;
  for (const combination of combinationsOfFive(cards)) {
    const candidate = evaluateFiveCards(combination, variant);
    if (best === undefined) {
      best = candidate;
      continue;
    }

    const comparison = compareHandStrength(candidate, best, variant);
    if (
      comparison > 0 ||
      (comparison === 0 && exactTieSignature(candidate) > exactTieSignature(best))
    ) {
      best = candidate;
    }
  }

  if (best === undefined) {
    throw new Error("Seven-card evaluation produced no combinations");
  }

  return best;
}
