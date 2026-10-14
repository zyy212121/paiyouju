import { serializeCard, type Card } from "./card.js";
import { InvalidHandError } from "./errors.js";

export function validateUniqueCards(
  cards: readonly Card[],
  expectedCount: number,
): void {
  if (cards.length !== expectedCount) {
    throw new InvalidHandError(
      `Hand must contain exactly ${expectedCount} unique cards; received ${cards.length}`,
    );
  }

  const seen = new Set<string>();
  for (const card of cards) {
    const code = serializeCard(card);
    if (seen.has(code)) {
      throw new InvalidHandError(`Duplicate card in hand: ${code}`);
    }
    seen.add(code);
  }
}
