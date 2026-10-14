import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "./sessions.js";

describe("session token primitives", () => {
  it("generates independent 32-byte URL-safe tokens and stores only hashes", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
    expect(hashSessionToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(first)).not.toBe(first);
    expect(hashSessionToken(first)).toBe(hashSessionToken(first));
  });

  it("expires exactly fourteen days from the supplied clock", () => {
    const now = new Date("2026-08-13T00:00:00.000Z");

    expect(sessionExpiresAt(now).toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });
});
