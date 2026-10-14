import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  compareHandStrength,
  createStandardDeck,
  evaluateFiveCards,
  serializeCard,
  shuffleCards,
  type Card,
  type RandomIntSource,
} from "./index.js";

const deck = createStandardDeck();
const cardIndex = fc.integer({ min: 0, max: deck.length - 1 });

function cardsAt(indices: readonly number[]): Card[] {
  return indices.map((index) => {
    const card = deck[index];
    if (card === undefined) {
      throw new Error(`Card index escaped deck: ${index}`);
    }
    return card;
  });
}

const fiveUniqueIndices = fc.uniqueArray(cardIndex, {
  minLength: 5,
  maxLength: 5,
});

const deterministicSourceFrom = (values: readonly number[]): RandomIntSource => {
  let index = 0;
  return {
    nextInt(exclusiveMax): number {
      const raw = values[index] ?? 0;
      index += 1;
      return Math.min(raw, exclusiveMax - 1);
    },
  };
};

describe("hand comparison properties", () => {
  it("is invariant under input permutation", () => {
    fc.assert(
      fc.property(fiveUniqueIndices, fc.shuffledSubarray([0, 1, 2, 3, 4], {
        minLength: 5,
        maxLength: 5,
      }), (indices, permutation) => {
        const cards = cardsAt(indices);
        const permuted = permutation.map((index) => cards[index]!);

        expect(evaluateFiveCards(permuted)).toEqual(evaluateFiveCards(cards));
      }),
      { numRuns: 1_000 },
    );
  });

  it("is antisymmetric", () => {
    fc.assert(
      fc.property(fiveUniqueIndices, fiveUniqueIndices, (left, right) => {
        const leftHand = evaluateFiveCards(cardsAt(left));
        const rightHand = evaluateFiveCards(cardsAt(right));

        const forward = compareHandStrength(leftHand, rightHand);
        const reverse = compareHandStrength(rightHand, leftHand);

        if (forward === 0) {
          expect(reverse).toBe(0);
        } else {
          expect(forward).toBe(-reverse);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  it("is reflexive", () => {
    fc.assert(
      fc.property(fiveUniqueIndices, (indices) => {
        const hand = evaluateFiveCards(cardsAt(indices));

        expect(compareHandStrength(hand, hand)).toBe(0);
      }),
      { numRuns: 1_000 },
    );
  });

  it("is transitive", () => {
    fc.assert(
      fc.property(
        fiveUniqueIndices,
        fiveUniqueIndices,
        fiveUniqueIndices,
        (first, second, third) => {
          const firstHand = evaluateFiveCards(cardsAt(first));
          const secondHand = evaluateFiveCards(cardsAt(second));
          const thirdHand = evaluateFiveCards(cardsAt(third));
          const firstToSecond = compareHandStrength(firstHand, secondHand);
          const secondToThird = compareHandStrength(secondHand, thirdHand);
          const firstToThird = compareHandStrength(firstHand, thirdHand);

          if (firstToSecond <= 0 && secondToThird <= 0) {
            expect(firstToThird).toBeLessThanOrEqual(0);
          }
          if (firstToSecond >= 0 && secondToThird >= 0) {
            expect(firstToThird).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe("shuffle properties", () => {
  it("always returns exactly the same set of 52 cards", () => {
    const randomSequence = fc.array(fc.integer({ min: 0, max: 51 }), {
      minLength: 51,
      maxLength: 51,
    });

    fc.assert(
      fc.property(randomSequence, (values) => {
        const shuffled = shuffleCards(deck, deterministicSourceFrom(values));

        expect(shuffled).toHaveLength(52);
        expect(shuffled.map(serializeCard).sort()).toEqual(
          deck.map(serializeCard).sort(),
        );
      }),
      { numRuns: 500 },
    );
  });
});
