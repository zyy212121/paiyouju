import { RANKS, SUITS, type Card } from "./card.js";

export function createStandardDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function createShortDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.filter((rank) => rank >= 6).map((rank) => ({ rank, suit })));
}
