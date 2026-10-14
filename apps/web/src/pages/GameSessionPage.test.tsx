import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GameSessionDetail } from "@paiyouju/shared";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useNetworkStore } from "../stores/network-store.js";
import { GameSessionPage } from "./GameSessionPage.js";

const getGame = vi.hoisted(() => vi.fn<(gameSessionId: string, signal?: AbortSignal) => Promise<GameSessionDetail>>());
vi.mock("../api/games.js", () => ({ getGame }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function DetailRoutes() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/games/game-b")} type="button">切换对局</button><Routes><Route element={<GameSessionPage />} path="/games/:gameSessionId" /></Routes></>;
}

describe("active game detail wording", () => {
  beforeEach(() => {
    useNetworkStore.setState({ online: true, pendingWrites: 0, refreshVersion: 0 });
    getGame.mockResolvedValue({
      currentStack: 520,
      endedAt: null,
      gameSessionId: "game-a",
      hands: [],
      handsPlayed: 0,
      netResult: null,
      provisionalNetResult: 120,
      room: { roomCode: "123456", roomId: "room-a", roomName: "活动桌" },
      seatIndex: 0,
      startedAt: "2026-08-20T00:00:00.000Z",
      status: "ACTIVE",
      totalBuyIn: 400,
      totalCashOut: 0,
    });
  });

  it("shows the current table stack instead of a misleading zero final stack", async () => {
    render(<MemoryRouter initialEntries={["/games/game-a"]}><Routes><Route element={<GameSessionPage />} path="/games/:gameSessionId" /></Routes></MemoryRouter>);
    expect(await screen.findByText(/累计领取 400 · 桌上 520/u)).toBeInTheDocument();
    expect(screen.queryByText(/离桌点数 0/u)).not.toBeInTheDocument();
  });

  it("clears the old detail and ignores its late response after the route changes", async () => {
    const oldRequest = deferred<GameSessionDetail>();
    const nextGame = {
      currentStack: 600,
      endedAt: null,
      gameSessionId: "game-b",
      hands: [],
      handsPlayed: 0,
      netResult: null,
      provisionalNetResult: 200,
      room: { roomCode: "654321", roomId: "room-b", roomName: "下一桌" },
      seatIndex: 1,
      startedAt: "2026-08-20T01:00:00.000Z",
      status: "ACTIVE",
      totalBuyIn: 400,
      totalCashOut: 0,
    } satisfies GameSessionDetail;
    getGame.mockReset().mockImplementation((gameSessionId: string) => gameSessionId === "game-a" ? oldRequest.promise : Promise.resolve(nextGame));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/games/game-a"]}><DetailRoutes /></MemoryRouter>);
    await waitFor(() => expect(getGame).toHaveBeenCalledWith("game-a", expect.any(AbortSignal)));

    await user.click(screen.getByRole("button", { name: "切换对局" }));
    expect(await screen.findByText("下一桌")).toBeInTheDocument();
    await act(async () => oldRequest.resolve({ ...nextGame, gameSessionId: "game-a", room: { ...nextGame.room, roomName: "上一桌" } }));

    expect(screen.queryByText("上一桌")).not.toBeInTheDocument();
    expect(screen.getByText("下一桌")).toBeInTheDocument();
  });
});
