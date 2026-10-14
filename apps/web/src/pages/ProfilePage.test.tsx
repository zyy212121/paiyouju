import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile } from "@paiyouju/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";
import { ProfilePage } from "./ProfilePage.js";

const mocks = vi.hoisted(() => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock("../api/profile.js", () => mocks);

const profile = {
  activeGameSessions: 0,
  avatarId: "avatar-01",
  createdAt: "2026-08-20T00:00:00.000Z",
  handsBreakEven: 0,
  handsLost: 1,
  handsPlayed: 3,
  handsWon: 2,
  hasPhoneNumber: true,
  nickname: "旧昵称",
  phoneMasked: "199****0002",
  profitableHands: 2,
  recentGames: [],
  role: "USER",
  totalBuyIn: 400,
  totalCashOut: 440,
  totalNetResult: 40,
  userId: "user-a",
  username: "alice",
  walletBalance: 1_000,
} satisfies Profile;

describe("ProfilePage nickname form", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: profile.avatarId, createdAt: profile.createdAt, hasPhoneNumber: profile.hasPhoneNumber, id: profile.userId, nickname: profile.nickname, phoneMasked: profile.phoneMasked, role: "USER", username: profile.username, walletBalance: profile.walletBalance } });
    mocks.getProfile.mockReset().mockResolvedValue(profile);
    mocks.updateProfile.mockReset();
  });

  it("updates visible identity only after the server confirms the nickname", async () => {
    let resolveUpdate!: (value: Profile) => void;
    mocks.updateProfile.mockReturnValue(new Promise<Profile>((resolve) => { resolveUpdate = resolve; }));
    const user = userEvent.setup();
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);

    const input = await screen.findByRole("textbox", { name: "昵称" });
    await user.click(screen.getByRole("button", { name: "选择头像 02" }));
    await user.clear(input);
    await user.type(input, "新昵称");
    await user.click(screen.getByRole("button", { name: "保存个人资料" }));

    expect(screen.getByRole("heading", { name: "旧昵称" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(useAuthStore.getState().user?.nickname).toBe("旧昵称");

    resolveUpdate({ ...profile, avatarId: "avatar-02", nickname: "新昵称" });
    expect(await screen.findByRole("heading", { name: "新昵称" })).toBeInTheDocument();
    expect(useAuthStore.getState().user?.nickname).toBe("新昵称");
    expect(mocks.updateProfile).toHaveBeenCalledWith({ avatarId: "avatar-02", nickname: "新昵称" });
  });
});
