import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WalletSummary } from "../api/client.js";
import type { WalletLedgerEntry, WalletLedgerPage } from "../api/wallet.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";
import { WalletPage } from "./WalletPage.js";

const mocks = vi.hoisted(() => ({ getWallet: vi.fn(), listWalletLedger: vi.fn() }));
vi.mock("../api/wallet.js", () => ({
  getWallet: mocks.getWallet,
  listWalletLedger: mocks.listWalletLedger,
}));

function summary(balance: number): WalletSummary {
  return { balance, updatedAt: "2026-08-20T00:00:00.000Z", version: balance };
}

function entry(id: string, type: WalletLedgerEntry["type"]): WalletLedgerEntry {
  return {
    balanceAfter: 100,
    balanceBefore: 90,
    createdAt: "2026-08-20T00:00:00.000Z",
    id,
    relatedGameSessionId: null,
    relatedHandId: null,
    relatedRoomId: null,
    sequence: 1,
    signedAmount: 10,
    type,
  };
}

describe("WalletPage canonical reconnect ordering", () => {
  beforeEach(() => {
    mocks.getWallet.mockReset();
    mocks.listWalletLedger.mockReset();
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: "avatar-01", createdAt: "2026-08-20T00:00:00.000Z", hasPhoneNumber: true, id: "user-a", nickname: "Alice", phoneMasked: "199****0002", role: "USER", username: "alice", walletBalance: 100 } });
  });

  it("does not append an old cursor response after reconnect refreshes canonical data", async () => {
    let resolveOldWallet!: (value: WalletSummary) => void;
    let resolveOldPage!: (value: WalletLedgerPage) => void;
    mocks.getWallet
      .mockResolvedValueOnce(summary(100))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldWallet = resolve; }))
      .mockResolvedValueOnce(summary(120));
    mocks.listWalletLedger
      .mockResolvedValueOnce({ entries: [entry("initial", "INITIAL_GRANT")], nextCursor: 2 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldPage = resolve; }))
      .mockResolvedValueOnce({ entries: [entry("fresh", "CASH_OUT")], nextCursor: undefined });
    const user = userEvent.setup();
    render(<MemoryRouter><WalletPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(mocks.listWalletLedger).toHaveBeenCalledTimes(2));

    act(() => {
      useNetworkStore.getState().setOnline(false);
      useNetworkStore.getState().setOnline(true);
    });
    expect(await screen.findByRole("heading", { name: "120 钻石" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /^旧版点数转出$/u })).toBeInTheDocument();

    await act(async () => {
      resolveOldWallet(summary(90));
      resolveOldPage({ entries: [entry("stale", "BUY_IN")] });
    });
    expect(screen.queryByRole("cell", { name: /^买入$/u })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "120 钻石" })).toBeInTheDocument();
  });
});
