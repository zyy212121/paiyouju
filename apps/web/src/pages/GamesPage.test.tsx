import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameSessionSummary } from "@paiyouju/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNetworkStore } from "../stores/network-store.js";
import { GamesPage } from "./GamesPage.js";

const listGames = vi.hoisted(() => vi.fn());
vi.mock("../api/games.js", () => ({ listGames }));

function game(gameSessionId: string, roomName: string, status: "ACTIVE" | "CLOSED"): GameSessionSummary {
  return {
    currentStack: status === "ACTIVE" ? 420 : null,
    endedAt: status === "CLOSED" ? "2026-08-20T02:00:00.000Z" : null,
    gameSessionId,
    handsPlayed: 2,
    netResult: status === "CLOSED" ? 20 : null,
    provisionalNetResult: status === "ACTIVE" ? 20 : null,
    room: { roomCode: "123456", roomId: `room-${gameSessionId}`, roomName },
    seatIndex: 0,
    startedAt: "2026-08-20T00:00:00.000Z",
    status,
    totalBuyIn: 400,
    totalCashOut: status === "CLOSED" ? 420 : 0,
  };
}

describe("GamesPage filter ordering", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    listGames.mockReset();
  });

  it("keeps the latest status result when an older request resolves last", async () => {
    let resolveActive!: (value: { readonly items: readonly GameSessionSummary[]; readonly nextCursor: null }) => void;
    let resolveClosed!: (value: { readonly items: readonly GameSessionSummary[]; readonly nextCursor: null }) => void;
    listGames.mockImplementation((input: { readonly status?: string }) => {
      if (input.status === "ACTIVE") return new Promise((resolve) => { resolveActive = resolve; });
      if (input.status === "CLOSED") return new Promise((resolve) => { resolveClosed = resolve; });
      return Promise.resolve({ items: [game("base", "初始对局", "CLOSED")], nextCursor: null });
    });
    const user = userEvent.setup();
    render(<MemoryRouter><GamesPage /></MemoryRouter>);
    expect(await screen.findByText("初始对局")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "状态" }), "ACTIVE");
    await waitFor(() => expect(listGames).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE" })));
    await user.selectOptions(screen.getByRole("combobox", { name: "状态" }), "CLOSED");
    await waitFor(() => expect(listGames).toHaveBeenCalledWith(expect.objectContaining({ status: "CLOSED" })));
    await act(async () => resolveClosed({ items: [game("closed", "当前已结束", "CLOSED")], nextCursor: null }));
    expect(await screen.findByText("当前已结束")).toBeInTheDocument();
    await act(async () => resolveActive({ items: [game("active", "过期进行中", "ACTIVE")], nextCursor: null }));
    expect(screen.queryByText("过期进行中")).not.toBeInTheDocument();
  });
});
