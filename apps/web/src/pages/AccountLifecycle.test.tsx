import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Profile } from "@paiyouju/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";
import { AuthPage } from "./AuthPage.js";
import { ProfilePage } from "./ProfilePage.js";

const mocks = vi.hoisted(() => ({ bindPhone: vi.fn(), getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock("../api/account.js", () => ({ bindPhone: mocks.bindPhone }));
vi.mock("../api/profile.js", () => ({ getProfile: mocks.getProfile, updateProfile: mocks.updateProfile }));

const unboundProfile: Profile = {
  activeGameSessions: 0, createdAt: "2026-08-20T00:00:00.000Z", handsBreakEven: 0, handsLost: 0, handsPlayed: 0, handsWon: 0,
  avatarId: "avatar-01", hasPhoneNumber: false, nickname: "旧账号", phoneMasked: null, profitableHands: 0, recentGames: [], role: "USER", totalBuyIn: 0,
  totalCashOut: 0, totalNetResult: 0, userId: "user-a", username: "alice", walletBalance: 10_000,
};

describe("phone account lifecycle UI", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    useAuthStore.setState({ error: null, status: "guest", user: null });
    mocks.getProfile.mockReset().mockResolvedValue(unboundProfile);
    mocks.bindPhone.mockReset().mockResolvedValue({ alreadyBound: false, phoneMasked: "138****8000" });
  });

  it("uses exact mobile telephone semantics without a redundant policy footnote", () => {
    render(<MemoryRouter><AuthPage mode="register" /></MemoryRouter>);
    const phone = screen.getByRole("textbox", { name: "手机号" });
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "numeric");
    expect(phone).toHaveAttribute("pattern", "1[0-9]{10}");
    expect(phone).toHaveAttribute("maxlength", "11");
    expect(screen.queryByText(/不发送短信验证码/)).not.toBeInTheDocument();
  });

  it("accepts a phone number or the local administrator account on login", () => {
    render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    const identifier = screen.getByRole("textbox", { name: "手机号或管理员账号" });
    expect(identifier).toHaveAttribute("type", "text");
    expect(identifier).not.toHaveAttribute("pattern");
    expect(screen.queryByRole("button", { name: "使用旧账号登录" })).not.toBeInTheDocument();
    expect(screen.queryByText(/钻石仅供娱乐/)).not.toBeInTheDocument();
  });

  it("lets login and registration users show and hide the password", async () => {
    const user = userEvent.setup();
    const view = render(<MemoryRouter><AuthPage mode="login" /></MemoryRouter>);
    const password = screen.getByLabelText("密码");
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeInTheDocument();

    view.rerender(<MemoryRouter><AuthPage mode="register" /></MemoryRouter>);
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "text");
  });

  it("lets a legacy account bind once and then exposes only the masked number", async () => {
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: unboundProfile.avatarId, createdAt: unboundProfile.createdAt, hasPhoneNumber: false, id: unboundProfile.userId, nickname: unboundProfile.nickname, phoneMasked: null, role: "USER", username: unboundProfile.username, walletBalance: unboundProfile.walletBalance } });
    const user = userEvent.setup();
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    await user.type(await screen.findByRole("textbox", { name: "手机号" }), "13800138000");
    await user.type(screen.getByLabelText("当前密码"), "Password123");
    await user.click(screen.getByRole("button", { name: "绑定手机号" }));
    expect(await screen.findByText("已绑定 138****8000")).toBeInTheDocument();
    expect(screen.queryByText("13800138000")).not.toBeInTheDocument();
    expect(useAuthStore.getState().user?.phoneMasked).toBe("138****8000");
  });
});
