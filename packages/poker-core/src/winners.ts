import type { Card } from "./card.js";
import { compareHandStrength } from "./compare.js";
import { evaluateSevenCards } from "./evaluate-seven.js";
import type { HandEvaluation, PokerVariant } from "./hand-types.js";

export interface SevenCardContender<TPlayerId = string> {
  readonly playerId: TPlayerId;
  readonly cards: readonly Card[];
}

export interface EvaluatedWinner<TPlayerId = string> {
  readonly playerId: TPlayerId;
  readonly evaluation: HandEvaluation;
}

export function determineWinners<TPlayerId>(
  contenders: readonly SevenCardContender<TPlayerId>[],
  variant: PokerVariant = "STANDARD",
): EvaluatedWinner<TPlayerId>[] {
  const evaluated = contenders.map(({ playerId, cards }) => ({
    playerId,
    evaluation: evaluateSevenCards(cards, variant),
  }));

  const strongest = evaluated.reduce<EvaluatedWinner<TPlayerId> | undefined>(
    (current, contender) =>
      current === undefined ||
      compareHandStrength(contender.evaluation, current.evaluation, variant) > 0
        ? contender
        : current,
    undefined,
  );

  if (strongest === undefined) {
    return [];
  }

  return evaluated.filter(
    (contender) =>
      compareHandStrength(contender.evaluation, strongest.evaluation, variant) === 0,
  );
}
