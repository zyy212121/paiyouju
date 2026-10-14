import { createShortDeck, createStandardDeck, shuffleCards, type Card, type PokerVariant } from "@paiyouju/poker-core";

import { cryptoRandomIntSource } from "../../../crypto-random.js";

export interface DeckProvider {
  nextDeck(variant?: PokerVariant): readonly Card[];
}

export const productionDeckProvider: DeckProvider = {
  nextDeck: (variant = "STANDARD") => shuffleCards(
    variant === "SHORT_DECK" ? createShortDeck() : createStandardDeck(),
    cryptoRandomIntSource,
  ),
};
