import { describe, expect, it } from "vitest";

import { sanitizeAuditMetadata } from "./admin-audit.js";

describe("administrator audit metadata sanitizer", () => {
  it("removes authentication, phone, snapshot, deck and hidden-card fields recursively", () => {
    const result = sanitizeAuditMetadata({
      cookie: "wepoker_session=secret",
      databaseUrl: "postgresql://admin:secret@db/wepoker",
      deck: ["As", "Ks"],
      nested: {
        csrfToken: "csrf",
        holeCards: ["Ah", "Ad"],
        phoneNumber: "13800001234",
        remainingDeck: ["2c"],
        sessionHash: "hash",
        snapshotPayload: { private: true },
      },
      passwordHash: "$argon2id$secret",
      safe: { balanceAfter: 1200, operation: "adjustment" },
      sessionToken: "token",
    });

    expect(result).toEqual({ safe: { balanceAfter: 1200, operation: "adjustment" } });
    expect(JSON.stringify(result)).not.toMatch(/13800001234|postgresql|argon2|Ah|Ad|wepoker_session/);
  });

  it("redacts sensitive-looking scalar values and bounds untrusted strings", () => {
    const result = sanitizeAuditMetadata({
      comment: "call 13800001234 <script>" + "x".repeat(1_000),
      connection: "postgres://wepoker:secret@database/wepoker",
    });
    expect(result).toMatchObject({ connection: "[REDACTED]" });
    expect(JSON.stringify(result)).not.toContain("13800001234");
    expect(JSON.stringify(result)).not.toContain("<script>");
    expect(JSON.stringify(result).length).toBeLessThan(700);
  });
});
