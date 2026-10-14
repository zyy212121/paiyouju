import { SUITS, type Card, type Rank } from "./card.js";
import { HandCategory, type HandEvaluation, type PokerVariant } from "./hand-types.js";
import { validateUniqueCards } from "./validation.js";

interface RankGroup {
  readonly rank: Rank;
  readonly cards: readonly Card[];
}

const categoryNames: Readonly<Record<HandCategory, string>> = {
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

const suitStrength = new Map(SUITS.map((suit, index) => [suit, index]));

function sortCardsWithinRank(cards: readonly Card[]): Card[] {
  return [...cards].sort(
    (left, right) =>
      (suitStrength.get(right.suit) ?? -1) -
      (suitStrength.get(left.suit) ?? -1),
  );
}

function groupByRank(cards: readonly Card[]): RankGroup[] {
  const groups = new Map<Rank, Card[]>();
  for (const card of cards) {
    const rankCards = groups.get(card.rank) ?? [];
    rankCards.push(card);
    groups.set(card.rank, rankCards);
  }

  return [...groups.entries()]
    .map(([rank, rankCards]) => ({
      rank,
      cards: sortCardsWithinRank(rankCards),
    }))
    .sort((left, right) => right.rank - left.rank);
}

function findStraightHigh(groups: readonly RankGroup[], variant: PokerVariant): Rank | undefined {
  if (groups.length !== 5) {
    return undefined;
  }

  const ranks = groups.map((group) => group.rank);
  if (
    variant === "SHORT_DECK" &&
    ranks[0] === 14 &&
    ranks[1] === 9 &&
    ranks[2] === 8 &&
    ranks[3] === 7 &&
    ranks[4] === 6
  ) {
    return 9;
  }
  if (
    ranks[0] === 14 &&
    ranks[1] === 5 &&
    ranks[2] === 4 &&
    ranks[3] === 3 &&
    ranks[4] === 2
  ) {
    return 5;
  }

  const high = ranks[0];
  if (
    high !== undefined &&
    ranks.every((rank, index) => rank === high - index)
  ) {
    return high;
  }

  return undefined;
}

function rankOrderForStraight(high: Rank, variant: PokerVariant): readonly Rank[] {
  if (variant === "SHORT_DECK" && high === 9) {
    return [9, 8, 7, 6, 14];
  }
  if (high === 5) {
    return [5, 4, 3, 2, 14];
  }

  return [high, high - 1, high - 2, high - 3, high - 4] as Rank[];
}

function orderCardsByRanks(
  groups: readonly RankGroup[],
  orderedRanks: readonly Rank[],
): Card[] {
  const cardsByRank = new Map(groups.map((group) => [group.rank, group.cards]));
  return orderedRanks.flatMap((rank) => cardsByRank.get(rank) ?? []);
}

function createEvaluation(
  category: HandCategory,
  tiebreak: readonly number[],
  bestFive: readonly Card[],
  displayName: string = categoryNames[category],
): HandEvaluation {
  return { category, tiebreak, bestFive, displayName };
}

export function evaluateFiveCards(cards: readonly Card[], variant: PokerVariant = "STANDARD"): HandEvaluation {
  validateUniqueCards(cards, 5);

  const groups = groupByRank(cards);
  const groupsByCountThenRank = [...groups].sort(
    (left, right) =>
      right.cards.length - left.cards.length || right.rank - left.rank,
  );
  const straightHigh = findStraightHigh(groups, variant);
  const isFlush = cards.every((card) => card.suit === cards[0]?.suit);

  if (straightHigh !== undefined && isFlush) {
    const bestFive = orderCardsByRanks(
      groups,
      rankOrderForStraight(straightHigh, variant),
    );
    return createEvaluation(
      HandCategory.StraightFlush,
      [straightHigh],
      bestFive,
      straightHigh === 14 ? "Royal Flush" : "Straight Flush",
    );
  }

  const largest = groupsByCountThenRank[0];
  const secondLargest = groupsByCountThenRank[1];

  if (largest?.cards.length === 4) {
    const kicker = groups.find((group) => group.rank !== largest.rank);
    return createEvaluation(
      HandCategory.FourOfAKind,
      [largest.rank, kicker?.rank ?? 0],
      [...largest.cards, ...(kicker?.cards ?? [])],
    );
  }

  if (largest?.cards.length === 3 && secondLargest?.cards.length === 2) {
    return createEvaluation(
      HandCategory.FullHouse,
      [largest.rank, secondLargest.rank],
      [...largest.cards, ...secondLargest.cards],
    );
  }

  const ranksDescending = groups.map((group) => group.rank);
  if (isFlush) {
    return createEvaluation(
      HandCategory.Flush,
      ranksDescending,
      orderCardsByRanks(groups, ranksDescending),
    );
  }

  if (straightHigh !== undefined) {
    const rankOrder = rankOrderForStraight(straightHigh, variant);
    return createEvaluation(
      HandCategory.Straight,
      [straightHigh],
      orderCardsByRanks(groups, rankOrder),
    );
  }

  if (largest?.cards.length === 3) {
    const kickers = groups
      .filter((group) => group.rank !== largest.rank)
      .map((group) => group.rank);
    return createEvaluation(
      HandCategory.ThreeOfAKind,
      [largest.rank, ...kickers],
      [...largest.cards, ...orderCardsByRanks(groups, kickers)],
    );
  }

  const pairs = groups.filter((group) => group.cards.length === 2);
  if (pairs.length === 2) {
    const orderedPairs = [...pairs].sort((left, right) => right.rank - left.rank);
    const kicker = groups.find((group) => group.cards.length === 1);
    const highPair = orderedPairs[0];
    const lowPair = orderedPairs[1];
    if (highPair !== undefined && lowPair !== undefined && kicker !== undefined) {
      return createEvaluation(
        HandCategory.TwoPair,
        [highPair.rank, lowPair.rank, kicker.rank],
        [...highPair.cards, ...lowPair.cards, ...kicker.cards],
      );
    }
  }

  if (largest?.cards.length === 2) {
    const kickers = groups
      .filter((group) => group.rank !== largest.rank)
      .map((group) => group.rank);
    return createEvaluation(
      HandCategory.OnePair,
      [largest.rank, ...kickers],
      [...largest.cards, ...orderCardsByRanks(groups, kickers)],
    );
  }

  return createEvaluation(
    HandCategory.HighCard,
    ranksDescending,
    orderCardsByRanks(groups, ranksDescending),
  );
}
