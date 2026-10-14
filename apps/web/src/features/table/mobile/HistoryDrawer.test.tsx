import type { HandDetail, HandSummary } from "@paiyouju/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryDrawer } from "./HistoryDrawer.js";

const mocks = vi.hoisted(() => ({ getHand: vi.fn(), listHands: vi.fn() }));
vi.mock("../../../api/hands.js", () => mocks);

const room = { roomCode: "123456", roomId: "room-a", roomName: "分页牌桌" } as const;
const handId = (number: number) => `30000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

function summary(number: number): HandSummary {
  return {
    board: ["2c", "7d", "9h", "2d", "Kh"], displayHandNumber: String(number), finishReason: "SHOWDOWN", finishedAt: `2026-08-20T00:0${number}:00.000Z`, handId: handId(number), handNumber: number, runoutIndex: null,
    hiddenOpponentCount: 0, netResult: 20, ownHoleCards: ["Kc", "Kd"], paidCardRevealCost: 0, paidCardRevealEnabled: false,
    room, seatIndex: 0, splitPot: false, startingStack: 400, endingStack: 420, viewerParticipated: true, wonAnyPot: true,
  };
}

function detail(number: number): HandDetail {
  return {
    actions: [{ actorSeat: 0, actorUserId: "user-a", amount: 20, automatic: true, cards: null, potIndex: null, raiseTo: null, sequence: 1, stateVersion: 2, street: "PREFLOP", type: "PLAYER_CALLED", visibility: null, winners: [] }],
    bigBlindAmount: 20, bigBlindSeat: 1, board: ["2c", "7d", "9h", "2d", "Kh"], buttonSeat: 0, displayHandNumber: String(number), finishReason: "SHOWDOWN", finishedAt: `2026-08-20T00:0${number}:00.000Z`, handId: handId(number), handNumber: number,
    hypotheticalRunout: null, ownResult: 20, paidRevealConfig: { cost: 0, enabled: false }, reviewEndsAt: null,
    players: [
      { allIn: false, committed: 20, endingStack: 420, folded: false, handLabel: "葫芦", holeCards: ["Kc", "Kd"], holeCardsVisibility: "OWN", netResult: 20, nickname: `Alice ${number}`, seatIndex: 0, startingStack: 400, userId: "user-a" },
      { allIn: false, committed: 20, endingStack: 380, folded: false, handLabel: "一对", holeCards: ["Ac", "Qc"], holeCardsVisibility: "PUBLIC_SHOWDOWN", netResult: -20, nickname: `Bob ${number}`, seatIndex: 1, startingStack: 400, userId: "user-b" },
    ],
    pots: [{ amount: 40, contributors: ["user-a", "user-b"], eligiblePlayers: ["user-a", "user-b"], oddChipRecipients: [], potIndex: 0, winners: ["user-a"] }],
    room, runoutIndex: null, settlement: { totalCommitted: 40, totalPot: 40, uncalledReturnTotal: 0, winnerUserIds: ["user-a"] }, smallBlindAmount: 10, smallBlindSeat: 0, startedAt: `2026-08-20T00:0${number - 1}:00.000Z`,
  };
}

describe("HistoryDrawer", () => {
  beforeEach(() => {
    mocks.listHands.mockReset().mockImplementation(({ cursor }: { readonly cursor?: string }) => Promise.resolve(cursor
      ? { items: [summary(1)], nextCursor: null }
      : { items: [summary(3), summary(2)], nextCursor: "older" }));
    mocks.getHand.mockReset().mockImplementation((id: string) => Promise.resolve(detail(Number(id.slice(-1)))));
  });

  it("loads every cursor page and exposes first/previous/next/last one-hand navigation", async () => {
    const user = userEvent.setup();
    render(<HistoryDrawer onClose={vi.fn()} open roomId="room-a" />);
    expect(await screen.findByText("3/3")).toBeInTheDocument();
    expect(await screen.findByText("Alice 3")).toBeInTheDocument();
    expect(screen.getByText("翻牌前：跟注 20")).toBeInTheDocument();
    expect(screen.getByText("葫芦")).toBeInTheDocument();
    expect(screen.getByText(/D · SB/u)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上一手" }));
    expect(await screen.findByText("2/3")).toBeInTheDocument();
    expect(await screen.findByText("Alice 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "第一手" }));
    expect(await screen.findByText("1/3")).toBeInTheDocument();
    expect(await screen.findByText("Alice 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "最后一手" }));
    expect(await screen.findByText("3/3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /精彩对局/u })).not.toBeInTheDocument();
    expect(mocks.listHands).toHaveBeenCalledTimes(2);
  });

  it("closes the right drawer when swiped toward the right", async () => {
    const onClose = vi.fn();
    render(<HistoryDrawer onClose={onClose} open roomId="room-a" />);
    const drawer = await screen.findByLabelText("牌桌历史抽屉");
    fireEvent.pointerDown(drawer, { clientX: 80, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(drawer, { clientX: 190, clientY: 110, pointerId: 1 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes from the visible table backdrop and pins history controls below the player scroller", async () => {
    const onClose = vi.fn();
    render(<HistoryDrawer onClose={onClose} open roomId="room-a" />);
    await screen.findByText("Alice 3");
    expect(screen.getByTestId("history-player-scroll")).toHaveClass("table-drawer-scroll");
    expect(screen.getByTestId("history-fixed-controls")).toHaveClass("table-drawer-fixed-footer");
    await userEvent.click(screen.getByRole("button", { name: "关闭历史并返回牌桌" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
