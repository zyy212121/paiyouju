import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HandDetail, PaidHandRevealResult } from "@paiyouju/shared";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpApiError } from "../api/client.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useNetworkStore } from "../stores/network-store.js";
import { HandDetailPage } from "./HandDetailPage.js";

const mocks = vi.hoisted(() => ({ buyPaidHandReveal: vi.fn(), generateHypotheticalRunout: vi.fn(), getHand: vi.fn() }));
vi.mock("../api/hands.js", () => mocks);

const hand = {
  actions: [],
  bigBlindAmount: 20,
  bigBlindSeat: 1,
  board: [],
  buttonSeat: 0,
  displayHandNumber: "7",
  finishReason: "FOLD_TO_WIN",
  finishedAt: "2026-08-20T00:01:00.000Z",
  handId: "30000000-0000-4000-8000-000000000001",
  handNumber: 7,
  hypotheticalRunout: null,
  ownResult: 20,
  paidRevealConfig: { cost: 10, enabled: true },
  reviewEndsAt: null,
  players: [
    { allIn: false, committed: 20, endingStack: 420, folded: false, handLabel: "高牌", holeCards: ["As", "Kd"], holeCardsVisibility: "OWN", netResult: 20, nickname: "Alice", seatIndex: 0, startingStack: 400, userId: "user-a" },
    { allIn: false, committed: 20, endingStack: 380, folded: true, handLabel: null, holeCards: null, holeCardsVisibility: "HIDDEN", netResult: -20, nickname: "Bob", seatIndex: 1, startingStack: 400, userId: "user-b" },
  ],
  pots: [{ amount: 40, contributors: ["user-a", "user-b"], eligiblePlayers: ["user-a"], oddChipRecipients: [], potIndex: 0, winners: ["user-a"] }],
  room: { roomCode: "123456", roomId: "room-a", roomName: "牌友桌" },
  runoutIndex: null,
  settlement: { totalCommitted: 40, totalPot: 40, uncalledReturnTotal: 0, winnerUserIds: ["user-a"] },
  smallBlindAmount: 10,
  smallBlindSeat: 0,
  startedAt: "2026-08-20T00:00:00.000Z",
} satisfies HandDetail;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function DetailRoutes({ nextHandId }: { readonly nextHandId?: string }) {
  const navigate = useNavigate();
  return <>{nextHandId && <button onClick={() => navigate(`/hands/${nextHandId}`)} type="button">切换手牌</button>}<Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></>;
}

describe("HandDetailPage paid reveal", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: "avatar-01", createdAt: "2026-08-20T00:00:00.000Z", hasPhoneNumber: true, id: "user-a", nickname: "Alice", phoneMasked: "199****0002", role: "USER", username: "alice", walletBalance: 100 } });
    mocks.getHand.mockReset().mockResolvedValue(hand);
    mocks.buyPaidHandReveal.mockReset().mockResolvedValue({
      alreadyOwned: false,
      cost: 10,
      operationId: "40000000-0000-4000-8000-000000000001",
      paidHandRevealPurchaseId: "reveal-a",
      revealedPlayerCount: 1,
      walletBalance: 90,
    } satisfies PaidHandRevealResult);
  });

  it("purchases immediately without a confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    await waitFor(() => expect(mocks.buyPaidHandReveal).toHaveBeenCalledWith(hand.handId, expect.objectContaining({ operationId: expect.any(String) })));
    expect(screen.queryByRole("dialog", { name: /确认/u })).not.toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().user?.walletBalance).toBe(90));
  });

  it("shows only an insufficient-balance dialog when local diamonds are too low", async () => {
    useAuthStore.setState({ error: null, status: "authenticated", user: { ...useAuthStore.getState().user!, walletBalance: 5 } });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    expect(screen.getByRole("dialog", { name: "钻石余额不足" })).toBeInTheDocument();
    expect(mocks.buyPaidHandReveal).not.toHaveBeenCalled();
  });

  it("shows the same balance dialog when the server rejects a stale local balance", async () => {
    mocks.buyPaidHandReveal.mockRejectedValueOnce(new HttpApiError("INSUFFICIENT_WALLET_BALANCE", "钻石余额不足"));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    expect(await screen.findByRole("dialog", { name: "钻石余额不足" })).toBeInTheDocument();
    expect(mocks.buyPaidHandReveal).toHaveBeenCalledOnce();
  });

  it("refreshes the detail when the post-hand review deadline expires", async () => {
    const duringReview = { ...hand, reviewEndsAt: new Date(Date.now() + 500).toISOString() } satisfies HandDetail;
    mocks.getHand.mockReset()
      .mockResolvedValueOnce(duringReview)
      .mockResolvedValue({ ...duringReview });
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    expect(await screen.findByText("观察期结束后可查看")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getHand).toHaveBeenCalledTimes(2), { timeout: 2_000 });
    expect(screen.getByRole("button", { name: "偷偷看 10钻石" })).toBeInTheDocument();
  });

  it("reuses the same operation id after an uncertain network result", async () => {
    const success = {
      alreadyOwned: false,
      cost: 10,
      operationId: "ignored-by-client-test",
      paidHandRevealPurchaseId: "reveal-a",
      revealedPlayerCount: 1,
      walletBalance: 90,
    } satisfies PaidHandRevealResult;
    mocks.buyPaidHandReveal
      .mockReset()
      .mockRejectedValueOnce(new HttpApiError("NETWORK_ERROR", "response lost"))
      .mockResolvedValueOnce(success);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    await screen.findByRole("alert");
    const firstOperationId = mocks.buyPaidHandReveal.mock.calls[0]![1].operationId;
    await user.click(screen.getByRole("button", { name: "偷偷看 10钻石" }));

    await waitFor(() => expect(mocks.buyPaidHandReveal).toHaveBeenCalledTimes(2));
    expect(mocks.buyPaidHandReveal.mock.calls[1]![1].operationId).toBe(firstOperationId);
  });

  it("does not render or reuse a stale hand response after the route parameter changes", async () => {
    const oldRequest = deferred<HandDetail>();
    const nextHand = {
      ...hand,
      handId: "30000000-0000-4000-8000-000000000002",
      handNumber: 8,
      displayHandNumber: "8",
      paidRevealConfig: { cost: 20, enabled: true },
      players: [hand.players[0]!, { ...hand.players[1]!, nickname: "新手目标" }],
    } satisfies HandDetail;
    mocks.getHand.mockReset().mockImplementation((handId: string) => handId === hand.handId ? oldRequest.promise : Promise.resolve(nextHand));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><DetailRoutes nextHandId={nextHand.handId} /></MemoryRouter>);
    await waitFor(() => expect(mocks.getHand).toHaveBeenCalledWith(hand.handId, null, expect.any(AbortSignal)));

    await user.click(screen.getByRole("button", { name: "切换手牌" }));
    expect(await screen.findByText("新手目标")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "偷偷看 20钻石" })).toBeInTheDocument();

    await act(async () => oldRequest.resolve(hand));
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "偷偷看 10钻石" })).not.toBeInTheDocument();
  });

  it("does not let a delayed purchase overwrite a different signed-in user's wallet", async () => {
    const purchase = deferred<PaidHandRevealResult>();
    mocks.buyPaidHandReveal.mockReset().mockReturnValue(purchase.promise);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><Routes><Route element={<HandDetailPage />} path="/hands/:handId" /></Routes></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    await waitFor(() => expect(mocks.buyPaidHandReveal).toHaveBeenCalledTimes(1));
    useAuthStore.setState({ error: null, status: "authenticated", user: { avatarId: "avatar-03", createdAt: "2026-08-20T00:02:00.000Z", hasPhoneNumber: true, id: "user-c", nickname: "Carol", phoneMasked: "199****0003", role: "USER", username: "carol", walletBalance: 500 } });

    await act(async () => purchase.resolve({ alreadyOwned: false, cost: 10, operationId: "late", paidHandRevealPurchaseId: "reveal-late", revealedPlayerCount: 1, walletBalance: 90 }));
    expect(useAuthStore.getState().user).toMatchObject({ id: "user-c", walletBalance: 500 });
  });

  it("does not reload an old route when its pending purchase resolves after navigation", async () => {
    const purchase = deferred<PaidHandRevealResult>();
    const nextHand = { ...hand, displayHandNumber: "11", handId: "30000000-0000-4000-8000-000000000005", handNumber: 11, players: [hand.players[0]!, { ...hand.players[1]!, nickname: "下一手目标" }] } satisfies HandDetail;
    mocks.getHand.mockReset().mockImplementation((handId: string) => Promise.resolve(handId === hand.handId ? hand : nextHand));
    mocks.buyPaidHandReveal.mockReset().mockReturnValue(purchase.promise);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/hands/${hand.handId}`]}><DetailRoutes nextHandId={nextHand.handId} /></MemoryRouter>);

    await user.click(await screen.findByRole("button", { name: "偷偷看 10钻石" }));
    await waitFor(() => expect(mocks.buyPaidHandReveal).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "切换手牌" }));
    expect(await screen.findByText("下一手目标")).toBeInTheDocument();

    await act(async () => purchase.resolve({ alreadyOwned: false, cost: 10, operationId: "late-route", paidHandRevealPurchaseId: "reveal-route", revealedPlayerCount: 1, walletBalance: 90 }));
    await waitFor(() => expect(mocks.getHand.mock.calls.filter(([requestedId]) => requestedId === hand.handId)).toHaveLength(1));
    expect(screen.getByText("下一手目标")).toBeInTheDocument();
  });
});
