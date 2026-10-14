import { describe, expect, it } from "vitest";

import { seatPosition } from "./seat-layout.js";

describe("mobile seat templates", () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
    it(`keeps ${count} positions unique and rotates the hero to the bottom`, () => {
      const hero = count - 1;
      const positions = Array.from({ length: count }, (_, seat) => seatPosition(seat, count, hero));
      expect(new Set(positions.map(({ x, y }) => `${x}:${y}`))).toHaveLength(count);
      expect(seatPosition(hero, count, hero)).toEqual({ x: 50, y: 88 });
      expect(positions.every(({ x, y }) => x >= 5 && x <= 95 && y >= 7 && y <= 93)).toBe(true);
      expect(positions.every(({ x }) => x - 10 >= 0 && x + 10 <= 100)).toBe(true);
    });
  }
});
