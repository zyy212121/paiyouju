import { describe, expect, it } from "vitest";

import { NicknameSchema, ProfileSchema, ProfileUpdateInputSchema } from "./profile.js";

const profile = {
  activeGameSessions: 0,
  avatarId: "avatar-01",
  createdAt: "2026-08-20T00:00:00.000Z",
  handsBreakEven: 1,
  handsLost: 2,
  handsPlayed: 4,
  handsWon: 2,
  hasPhoneNumber: true,
  nickname: "爱丽丝",
  phoneMasked: "199****0002",
  profitableHands: 1,
  recentGames: [],
  role: "USER" as const,
  totalBuyIn: 1_000,
  totalCashOut: 1_050,
  totalNetResult: 50,
  userId: "user-a",
  username: "alice",
  walletBalance: 2_000,
};

describe("profile contracts", () => {
  it("keeps won-pot and profitable-hand counts independent", () => {
    expect(ProfileSchema.parse(profile)).toMatchObject({ handsWon: 2, profitableHands: 1 });
  });

  it("trims a valid Chinese nickname and rejects HTML, controls and extra fields", () => {
    expect(NicknameSchema.parse("  爱丽丝  ")).toBe("爱丽丝");
    expect(NicknameSchema.safeParse("<b>爱丽丝</b>").success).toBe(false);
    expect(NicknameSchema.safeParse("爱\u0000丽丝").success).toBe(false);
    expect(ProfileUpdateInputSchema.safeParse({ nickname: "Alice", role: "ADMIN" }).success).toBe(false);
  });

  it("allows nickname and avatar updates independently but rejects an empty patch", () => {
    expect(ProfileUpdateInputSchema.parse({ avatarId: "avatar-12" })).toEqual({ avatarId: "avatar-12" });
    expect(ProfileUpdateInputSchema.parse({ nickname: "新昵称" })).toEqual({ nickname: "新昵称" });
    expect(ProfileUpdateInputSchema.safeParse({}).success).toBe(false);
    expect(ProfileUpdateInputSchema.safeParse({ avatarId: "avatar-99" }).success).toBe(false);
  });
});
