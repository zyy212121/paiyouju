import { describe, expect, it } from "vitest";

import {
  createStandardDeck,
  evaluateFiveCards,
  evaluateSevenCards,
  parseCard,
} from "./index.js";

describe("poker-core public entry", () => {
  it("exposes the Stage 1 card, deck, and evaluator API", () => {
    expect(createStandardDeck()).toHaveLength(52);
    expect(
      evaluateFiveCards(["As", "Ks", "Qs", "Js", "Ts"].map(parseCard))
        .displayName,
    ).toBe("Royal Flush");
    expect(
      evaluateSevenCards(
        ["2c", "3d", "As", "Ks", "Qs", "Js", "Ts"].map(parseCard),
      ).displayName,
    ).toBe("Royal Flush");
  });
});
