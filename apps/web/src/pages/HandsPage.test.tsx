import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameSessionSummary, HandSummary } from "@paiyouju/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNetworkStore } from "../stores/network-store.js";
import { HandsPage } from "./HandsPage.js";

const mocks = vi.hoisted(() => ({ listGames: vi.fn(), listHands: vi.fn() }));
vi.mock("../api/games.js", () => ({ listGames: mocks.listGames }));
vi.mock("../api/hands.js", () => ({ listHands: mocks.listHands }));

function hand(handId: string, roomId: string, roomName: string, handNumber: number): HandSummary {
  return {
    board: ["2c", "3d", "4h"],
    displayHandNumber: String(handNumber),
    endingStack: 420,
    finishedAt: "2026-08-20T01:00:00.000Z",
    finishReason: "FOLD_TO_WIN",
    handId,
    handNumber,
    runoutIndex: null,
    hiddenOpponentCount: 1,
    netResult: 20,
    ownHoleCards: ["As", "Kd"],
    paidCardRevealCost: 10,
    paidCardRevealEnabled: true,
    room: { roomCode: "123456", roomId, roomName },
    seatIndex: 0,
    splitPot: false,
    startingStack: 400,
    viewerParticipated: true,
    wonAnyPot: true,
  };
}

function game(gameSessionId: string, roomId: string, roomName: string): GameSessionSummary {
  return {
    currentStack: null,
    endedAt: "2026-08-20T02:00:00.000Z",
    gameSessionId,
    handsPlayed: 1,
    netResult: 20,
    provisionalNetResult: null,
    room: { roomCode: "123456", roomId, roomName },
    seatIndex: 0,
    startedAt: "2026-08-20T00:00:00.000Z",
    status: "CLOSED",
    totalBuyIn: 400,
    totalCashOut: 420,
  };
}

describe("HandsPage history pagination and filters", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    mocks.listHands.mockReset();
    mocks.listGames.mockReset();
    mocks.listHands.mockImplementation(async (input: { readonly cursor?: string }) => input.cursor
      ? { items: [hand("20000000-0000-4000-8000-000000000002", "room-a", "最近房间", 2)], nextCursor: null }
      : { items: [hand("20000000-0000-4000-8000-000000000001", "room-a", "最近房间", 1)], nextCursor: "next-hand" });
    mocks.listGames.mockImplementation(async (input: { readonly cursor?: string }) => input.cursor
      ? { items: [game("game-b", "room-b", "较早房间")], nextCursor: null }
      : { items: [game("game-a", "room-a", "最近房间")], nextCursor: "next-game" });
  });

  it("loads more hands and offers rooms not present on the first hand page", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><HandsPage /></MemoryRouter>);

    expect(await screen.findByText("最近房间 · 第 1 手")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "较早房间" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("最近房间 · 第 2 手")).toBeInTheDocument();
    expect(mocks.listHands).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-hand" }));
  });

  it("ignores an older filter response that resolves after the current filter", async () => {
    let resolveWin!: (value: { readonly items: readonly HandSummary[]; readonly nextCursor: null }) => void;
    let resolveLoss!: (value: { readonly items: readonly HandSummary[]; readonly nextCursor: null }) => void;
    mocks.listGames.mockResolvedValue({ items: [], nextCursor: null });
    mocks.listHands.mockImplementation((input: { readonly result?: string }) => {
      if (input.result === "win") return new Promise((resolve) => { resolveWin = resolve; });
      if (input.result === "loss") return new Promise((resolve) => { resolveLoss = resolve; });
      return Promise.resolve({ items: [hand("20000000-0000-4000-8000-000000000010", "room-a", "初始房间", 10)], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<MemoryRouter><HandsPage /></MemoryRouter>);
    expect(await screen.findByText("初始房间 · 第 10 手")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "结果" }), "win");
    await waitFor(() => expect(mocks.listHands).toHaveBeenCalledWith(expect.objectContaining({ result: "win" })));
    await user.selectOptions(screen.getByRole("combobox", { name: "结果" }), "loss");
    await waitFor(() => expect(mocks.listHands).toHaveBeenCalledWith(expect.objectContaining({ result: "loss" })));
    await act(async () => resolveLoss({ items: [hand("20000000-0000-4000-8000-000000000011", "room-loss", "当前亏损筛选", 11)], nextCursor: null }));
    expect(await screen.findByText("当前亏损筛选 · 第 11 手")).toBeInTheDocument();
    await act(async () => resolveWin({ items: [hand("20000000-0000-4000-8000-000000000012", "room-win", "过期盈利筛选", 12)], nextCursor: null }));
    expect(screen.queryByText("过期盈利筛选 · 第 12 手")).not.toBeInTheDocument();
    expect(screen.getByText("当前亏损筛选 · 第 11 手")).toBeInTheDocument();
  });

  it("does not append an old cursor page after filters change", async () => {
    let resolveCursor!: (value: { readonly items: readonly HandSummary[]; readonly nextCursor: null }) => void;
    mocks.listGames.mockResolvedValue({ items: [], nextCursor: null });
    mocks.listHands.mockImplementation((input: { readonly cursor?: string; readonly result?: string }) => {
      if (input.cursor === "old-cursor") return new Promise((resolve) => { resolveCursor = resolve; });
      if (input.result === "loss") return Promise.resolve({ items: [hand("20000000-0000-4000-8000-000000000021", "room-loss", "筛选后结果", 21)], nextCursor: null });
      return Promise.resolve({ items: [hand("20000000-0000-4000-8000-000000000020", "room-a", "筛选前结果", 20)], nextCursor: "old-cursor" });
    });
    const user = userEvent.setup();
    render(<MemoryRouter><HandsPage /></MemoryRouter>);
    await user.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(mocks.listHands).toHaveBeenCalledWith(expect.objectContaining({ cursor: "old-cursor" })));
    await user.selectOptions(screen.getByRole("combobox", { name: "结果" }), "loss");
    expect(await screen.findByText("筛选后结果 · 第 21 手")).toBeInTheDocument();
    await act(async () => resolveCursor({ items: [hand("20000000-0000-4000-8000-000000000022", "room-old", "过期分页结果", 22)], nextCursor: null }));
    expect(screen.queryByText("过期分页结果 · 第 22 手")).not.toBeInTheDocument();
  });
});
