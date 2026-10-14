import { describe, expect, it } from "vitest";

import { AVATAR_IDS, AvatarIdSchema, DEFAULT_AVATAR_ID } from "./avatar.js";

describe("avatar contracts", () => {
  it("exposes exactly sixteen stable library identifiers", () => {
    expect(AVATAR_IDS).toHaveLength(16);
    expect(new Set(AVATAR_IDS).size).toBe(16);
    expect(DEFAULT_AVATAR_ID).toBe("avatar-01");
    expect(AvatarIdSchema.parse("avatar-16")).toBe("avatar-16");
    expect(AvatarIdSchema.safeParse("avatar-17").success).toBe(false);
  });
});
