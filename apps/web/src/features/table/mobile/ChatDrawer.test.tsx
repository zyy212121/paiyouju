import type { TableRanking } from "@paiyouju/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatDrawer } from "./ChatDrawer.js";

const mocks = vi.hoisted(() => ({ command: vi.fn(), getTableRankings: vi.fn() }));
vi.mock("../../../api/rooms.js", () => mocks);
vi.mock("../../../realtime/table-socket.js", () => ({ tableSocket: { command: mocks.command } }));

const ranking: TableRanking = {
  players: [
    { handsPlayed: 2, netResult: 30, nickname: "Alice", seatIndex: 0, seated: true, totalBuyIn: 600, userId: "user-a", voluntarilyEnteredHands: 1, vpip: 50, winningHands: 1, winRate: 50 },
    { handsPlayed: 2, netResult: -30, nickname: "Bob", seatIndex: null, seated: false, totalBuyIn: 400, userId: "user-b", voluntarilyEnteredHands: 1, vpip: 50, winningHands: 1, winRate: 50 },
  ],
  roomId: "room-a",
  summary: { activePlayers: 1, averagePot: 90, departedPlayers: 1, elapsedSeconds: 600, handsPlayed: 2, totalBuyIn: 1_000, totalPot: 180 },
};

describe("ranking and chat drawer", () => {
  beforeEach(() => {
    mocks.command.mockReset().mockResolvedValue({
      content: "大家好 👍",
      createdAt: "2026-08-29T12:00:00.000Z",
      id: "33333333-3333-4333-8333-333333333333",
      roomId: "room-a",
      sender: { nickname: "Alice", seatIndex: 0, userId: "user-a" },
    });
    mocks.getTableRankings.mockReset().mockResolvedValue(ranking);
  });

  it("sends normalized native emoji chat and keeps the composer fixed below history", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer connection="connected" onClose={vi.fn()} open roomId="room-a" stateVersion={1} />);
    await user.click(screen.getByRole("tab", { name: "聊天" }));
    const input = screen.getByRole("textbox", { name: "聊天内容" });
    await user.type(input, "大家好");
    await user.click(screen.getByRole("button", { name: "添加表情 👍" }));
    expect(screen.getByText("4/120")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送聊天" }));
    expect(mocks.command).toHaveBeenCalledWith("room:chat-send", expect.objectContaining({ content: "大家好👍", roomId: "room-a" }));
    expect(screen.getByTestId("chat-composer")).toHaveClass("table-drawer-fixed-footer");
  });

  it("shows ranked active players, toggles gray departed players and uses Chinese profit colors", async () => {
    const user = userEvent.setup();
    render(<ChatDrawer connection="connected" onClose={vi.fn()} open roomId="room-a" stateVersion={1} />);
    const alice = await screen.findByTestId("ranking-player-user-a");
    expect(within(alice).getAllByText("+30")[0]).toHaveClass("text-rose-300");
    expect(screen.queryByTestId("ranking-player-user-b")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示离桌玩家" }));
    const bob = screen.getByTestId("ranking-player-user-b");
    expect(bob).toHaveClass("ranking-player-departed");
    expect(within(bob).getAllByText("-30")[0]).toHaveClass("text-emerald-300");
    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("10分钟")).toBeInTheDocument();
  });

  it("leaves pointer handling to controls inside the swipeable drawer", async () => {
    render(<ChatDrawer connection="connected" onClose={vi.fn()} open roomId="room-a" stateVersion={1} />);
    const drawer = await screen.findByLabelText("排名和聊天抽屉");
    const toggle = screen.getByRole("button", { name: "显示离桌玩家" });
    const setPointerCapture = vi.fn();
    Object.defineProperty(drawer, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });

    fireEvent.pointerDown(toggle, { clientX: 180, clientY: 100, pointerId: 7 });

    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("closes the left drawer when swiped toward the left", async () => {
    const onClose = vi.fn();
    render(<ChatDrawer connection="connected" onClose={onClose} open roomId="room-a" stateVersion={1} />);
    const drawer = await screen.findByLabelText("排名和聊天抽屉");
    fireEvent.pointerDown(drawer, { clientX: 180, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(drawer, { clientX: 70, clientY: 110, pointerId: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the visible table backdrop and keeps players scrollable above fixed public info", async () => {
    const onClose = vi.fn();
    render(<ChatDrawer connection="connected" onClose={onClose} open roomId="room-a" stateVersion={1} />);
    await screen.findByTestId("ranking-player-user-a");
    expect(screen.getByTestId("ranking-player-scroll")).toHaveClass("table-drawer-scroll");
    expect(screen.getByLabelText("牌桌公共信息")).toHaveClass("table-drawer-fixed-footer");
    await userEvent.click(screen.getByRole("button", { name: "关闭排名和聊天并返回牌桌" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
