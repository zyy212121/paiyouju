import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store.js";
import { AdminGate } from "./AdminGate.js";

const baseUser = {
  avatarId: "avatar-01" as const,
  createdAt: "2026-08-25T00:00:00.000Z",
  hasPhoneNumber: true,
  id: "admin-gate-user",
  nickname: "测试用户",
  phoneMasked: "138****0000",
  username: "test_user",
  walletBalance: 1_000,
} as const;

describe("administrator route gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ status: "guest", user: null });
  });

  it("renders a stable no-permission view for ordinary users", () => {
    useAuthStore.setState({ status: "authenticated", user: { ...baseUser, role: "USER" } });
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes><Route element={<AdminGate />}><Route element={<p>秘密后台</p>} path="/admin" /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "无管理员权限" })).toBeInTheDocument();
    expect(screen.queryByText("秘密后台")).not.toBeInTheDocument();
  });

  it("allows an administrator while server APIs remain authoritative", () => {
    useAuthStore.setState({ status: "authenticated", user: { ...baseUser, role: "ADMIN" } });
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes><Route element={<AdminGate />}><Route element={<p>管理控制台</p>} path="/admin" /></Route></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("管理控制台")).toBeInTheDocument();
  });
});
