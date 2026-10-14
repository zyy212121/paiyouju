import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./passwords.js";

describe("Argon2id passwords", () => {
  it("hashes with the fixed reviewed Argon2id parameters", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
    expect(hash).not.toContain("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("returns false for malformed stored hashes", async () => {
    await expect(verifyPassword("not-a-hash", "password123")).resolves.toBe(false);
  });
});
