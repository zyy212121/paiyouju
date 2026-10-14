import { serializeCard, type Card } from "./card.js";
import { combinationsOfFive } from "./combinations.js";
import { compareHandStrength } from "./compare.js";
import { evaluateFiveCards } from "./evaluate-five.js";
import { InvalidHandError } from "./errors.js";
import type { HandEvaluation, PokerVariant } from "./hand-types.js";
import { validateUniqueCards } from "./validation.js";

function exactTieSignature(evaluation: HandEvaluation): string {
  return evaluation.bestFive.map(serializeCard).join("");
}

/** Evaluates the best five-card hand from the 5–7 cards currently available. */
export function evaluateBestFiveCards(cards: readonly Card[], variant: PokerVariant = "STANDARD"): HandEvaluation {
  if (cards.length < 5 || cards.length > 7) {
    throw new InvalidHandError(`Hand must contain 5, 6, or 7 unique cards; received ${cards.length}`);
  }
  validateUniqueCards(cards, cards.length);

  let best: HandEvaluation | undefined;
  for (const combination of combinationsOfFive(cards)) {
    const candidate = evaluateFiveCards(combination, variant);
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const comparison = compareHandStrength(candidate, best, variant);
    if (comparison > 0 || (comparison === 0 && exactTieSignature(candidate) > exactTieSignature(best))) best = candidate;
  }
  if (!best) throw new InvalidHandError("Current-card evaluation produced no five-card combination");
  return best;
}
