import { HandCategory, type HandEvaluation, type PokerVariant } from "./hand-types.js";

const SHORT_DECK_CATEGORY_STRENGTH: Readonly<Record<HandCategory, number>> = {
  [HandCategory.HighCard]: 0,
  [HandCategory.OnePair]: 1,
  [HandCategory.TwoPair]: 2,
  [HandCategory.ThreeOfAKind]: 3,
  [HandCategory.Straight]: 4,
  [HandCategory.FullHouse]: 5,
  [HandCategory.Flush]: 6,
  [HandCategory.FourOfAKind]: 7,
  [HandCategory.StraightFlush]: 8,
};

function compareNumbers(left: number, right: number): -1 | 0 | 1 {
  return left === right ? 0 : left > right ? 1 : -1;
}

export function compareHandStrength(
  left: HandEvaluation,
  right: HandEvaluation,
  variant: PokerVariant = "STANDARD",
): -1 | 0 | 1 {
  const leftCategory = variant === "SHORT_DECK" ? SHORT_DECK_CATEGORY_STRENGTH[left.category] : left.category;
  const rightCategory = variant === "SHORT_DECK" ? SHORT_DECK_CATEGORY_STRENGTH[right.category] : right.category;
  const categoryComparison = compareNumbers(leftCategory, rightCategory);
  if (categoryComparison !== 0) {
    return categoryComparison;
  }

  const length = Math.max(left.tiebreak.length, right.tiebreak.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left.tiebreak[index];
    const rightValue = right.tiebreak[index];
    if (leftValue === undefined || rightValue === undefined) {
      return compareNumbers(left.tiebreak.length, right.tiebreak.length);
    }

    const comparison = compareNumbers(leftValue, rightValue);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}
