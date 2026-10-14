import type { Card } from "./card.js";
import { evaluateFiveCards } from "./evaluate-five.js";
import { HandCategory } from "./hand-types.js";

export const HAND_CATEGORY_COUNT = 9;

export const EXPECTED_FIVE_CARD_DISTRIBUTION: readonly number[] = [
  1_302_540,
  1_098_240,
  123_552,
  54_912,
  10_200,
  5_108,
  3_744,
  624,
  40,
];

export interface FiveCardDistribution {
  readonly counts: readonly number[];
  readonly total: number;
}

export function countFiveCardDistribution(
  cards: readonly Card[],
): FiveCardDistribution {
  const counts = Array.from({ length: HAND_CATEGORY_COUNT }, () => 0);
  let total = 0;

  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            const hand = [
              cards[first],
              cards[second],
              cards[third],
              cards[fourth],
              cards[fifth],
            ];
            if (hand.some((card) => card === undefined)) {
              throw new Error("Combination index escaped the supplied cards");
            }

            const evaluation = evaluateFiveCards(hand as Card[]);
            counts[evaluation.category] =
              (counts[evaluation.category] ?? 0) + 1;
            total += 1;
          }
        }
      }
    }
  }

  return { counts, total };
}

export const HAND_CATEGORY_NAMES: Readonly<Record<HandCategory, string>> = {
  [HandCategory.HighCard]: "High Card",
  [HandCategory.OnePair]: "One Pair",
  [HandCategory.TwoPair]: "Two Pair",
  [HandCategory.ThreeOfAKind]: "Three of a Kind",
  [HandCategory.Straight]: "Straight",
  [HandCategory.Flush]: "Flush",
  [HandCategory.FullHouse]: "Full House",
  [HandCategory.FourOfAKind]: "Four of a Kind",
  [HandCategory.StraightFlush]: "Straight Flush",
};
