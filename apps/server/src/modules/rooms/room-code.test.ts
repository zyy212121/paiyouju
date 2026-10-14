import { describe, expect, it } from "vitest";

import { createRoomCode } from "./room-code.js";

describe("room code generation", () => {
  it("formats a cryptographically supplied integer with leading zeroes", () => {
    expect(createRoomCode(() => 123)).toBe("000123");
    expect(createRoomCode(() => 999_999)).toBe("999999");
  });

  it("rejects an invalid injected random source", () => {
    expect(() => createRoomCode(() => -1)).toThrow();
    expect(() => createRoomCode(() => 1_000_000)).toThrow();
  });
});
