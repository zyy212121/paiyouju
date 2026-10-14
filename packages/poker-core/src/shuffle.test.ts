import { describe, expect, it } from "vitest";

import {
  createStandardDeck,
  parseCard,
  serializeCard,
  shuffleCards,
  type RandomIntSource,
} from "./index.js";

class SequenceRandomSource implements RandomIntSource {
  readonly #values: readonly number[];
  readonly requestedMaximums: number[] = [];
  #index = 0;

  public constructor(values: readonly number[]) {
    this.#values = values;
  }

  public nextInt(exclusiveMax: number): number {
    this.requestedMaximums.push(exclusiveMax);
    const value = this.#values[this.#index];
    if (value === undefined) {
      throw new Error("Deterministic sequence exhausted");
    }
    this.#index += 1;
    return value;
  }
}

describe("Fisher-Yates shuffle", () => {
  it("uses the injected bounded integers and returns an exact deterministic order", () => {
    const cards = ["2c", "3c", "4c", "5c"].map(parseCard);
    const source = new SequenceRandomSource([0, 1, 1]);

    const shuffled = shuffleCards(cards, source);

    expect(shuffled.map(serializeCard)).toEqual(["5c", "4c", "3c", "2c"]);
    expect(source.requestedMaximums).toEqual([4, 3, 2]);
  });

  it("reproduces the same order with fresh sources containing the same sequence", () => {
    const cards = ["2c", "3c", "4c", "5c"].map(parseCard);

    const first = shuffleCards(cards, new SequenceRandomSource([3, 2, 0]));
    const second = shuffleCards(cards, new SequenceRandomSource([3, 2, 0]));

    expect(first.map(serializeCard)).toEqual(second.map(serializeCard));
  });

  it("does not mutate the caller's deck", () => {
    const cards = ["2c", "3c", "4c", "5c"].map(parseCard);
    const before = cards.map(serializeCard);

    const shuffled = shuffleCards(cards, new SequenceRandomSource([0, 0, 0]));

    expect(cards.map(serializeCard)).toEqual(before);
    expect(shuffled).not.toBe(cards);
  });

  it("preserves all 52 cards exactly once", () => {
    const deck = createStandardDeck();
    const source = new SequenceRandomSource(
      Array.from({ length: 51 }, () => 0),
    );

    const shuffled = shuffleCards(deck, source);

    expect(shuffled.map(serializeCard).sort()).toEqual(
      deck.map(serializeCard).sort(),
    );
  });

  it.each([
    ["negative", -1],
    ["equal to exclusive maximum", 4],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
  ])("rejects a %s random-source result", (_label, value) => {
    const cards = ["2c", "3c", "4c", "5c"].map(parseCard);

    expect(() =>
      shuffleCards(cards, new SequenceRandomSource([value])),
    ).toThrow(/random source/i);
  });

  it("returns a new array without consulting the source for zero or one item", () => {
    const source: RandomIntSource = {
      nextInt: () => {
        throw new Error("source must not be called");
      },
    };
    const single = [parseCard("Ac")];

    expect(shuffleCards([], source)).toEqual([]);
    expect(shuffleCards(single, source)).toEqual(single);
    expect(shuffleCards(single, source)).not.toBe(single);
  });
});
