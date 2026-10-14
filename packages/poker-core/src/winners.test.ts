import { describe, expect, it } from "vitest";

import {
  HandCategory,
  determineWinners,
  parseCard,
  type SevenCardContender,
} from "./index.js";

function contender(
  playerId: string,
  codes: string,
): SevenCardContender<string> {
  return { playerId, cards: codes.split(" ").map(parseCard) };
}

describe("winner determination", () => {
  it("returns only the strongest player with the winning evaluation", () => {
    const winners = determineWinners([
      contender("pair", "Ah Ad Kc Qs 9h 4c 2d"),
      contender("straight", "9s 8h 7d 6c 5s 2h Ac"),
      contender("flush", "Ac Jc 9c 5c 2c Kh Qd"),
    ]);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.playerId).toBe("flush");
    expect(winners[0]?.evaluation.category).toBe(HandCategory.Flush);
  });

  it("returns all players tied by a royal-flush board in input order", () => {
    const winners = determineWinners([
      contender("first", "2c 3d As Ks Qs Js Ts"),
      contender("second", "4c 5d As Ks Qs Js Ts"),
      contender("third", "6c 7d As Ks Qs Js Ts"),
    ]);

    expect(winners.map((winner) => winner.playerId)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(winners.every((winner) => winner.evaluation.tiebreak[0] === 14)).toBe(
      true,
    );
  });

  it("treats equal rank strength with different suits as a complete tie", () => {
    const winners = determineWinners([
      contender("clubs", "Ac Kc 9c 6c 3c 2h 2d"),
      contender("hearts", "Ah Kh 9h 6h 3h 2c 2d"),
    ]);

    expect(winners.map((winner) => winner.playerId)).toEqual([
      "clubs",
      "hearts",
    ]);
  });

  it("returns an empty array when there are no contenders", () => {
    expect(determineWinners([])).toEqual([]);
  });
});
