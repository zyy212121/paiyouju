import type { TableStateProjection } from "@paiyouju/shared";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeClientError, tableSocket } from "../../../realtime/table-socket.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useTableStore } from "../../../stores/table-store.js";
import { projectedHand, projectedSeat, tableState } from "../../../test/table-fixture.js";
import { MobileTableExperience } from "./MobileTableExperience.js";

const variants = [6, 9].flatMap((maxSeats) => ["NORMAL", "SQUID", "SHORT_DECK", "BOMB_POT"].map((specialMode) => ({ maxSeats, specialMode: specialMode as TableStateProjection["room"]["specialMode"] })));

function playingState(maxSeats = 6, specialMode: TableStateProjection["room"]["specialMode"] = "SQUID") {
  const base = tableState();
  return tableState({
    hand: projectedHand(), runtimeStatus: "PLAYING", stateVersion: 138,
    room: { ...base.room, maxSeats, specialMode, squidStake: specialMode === "SQUID" ? 20 : null },
    seats: [projectedSeat(), projectedSeat(1)].map((seat) => ({ ...seat, squidMarked: true, squidRoundParticipant: specialMode === "SQUID" })),
  });
}

function experience(state: TableStateProjection) {
  return <MemoryRouter><MobileTableExperience connection="connected" error={null} online roomId={state.room.roomId} state={state} /></MemoryRouter>;
}

function stale(latestState: TableStateProjection) {
  useTableStore.getState().applyError({ code: "STALE_STATE", latestState, message: "牌桌状态已更新", requestId: "request-1" });
  return new RealtimeClientError("REALTIME_COMMAND_REJECTED", "牌桌状态已更新", { code: "STALE_STATE", latestState, message: "牌桌状态已更新", requestId: "request-1" });
}

async function stand() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开牌桌菜单" }));
  await user.click(screen.getByRole("button", { name: /站起围观/u }));
  if (screen.queryByRole("dialog", { name: "离开鱿鱼牌局" })) await user.click(screen.getByRole("button", { name: "确认" }));
}

describe("stand and spectator lifecycle", () => {
  beforeEach(() => {
    useTableStore.getState().clear();
    useAuthStore.setState({ status: "authenticated", user: { avatarId: "avatar-01", createdAt: "2026-08-20T00:00:00.000Z", hasPhoneNumber: false, id: "user-0", nickname: "自己", phoneMasked: null, role: "USER", username: "alice", walletBalance: 10_000 } });
    vi.spyOn(tableSocket, "requestState").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); useTableStore.getState().clear(); });

  it.each(variants)("retries a stale stand once with canonical authority at $maxSeats seats in $specialMode", async ({ maxSeats, specialMode }) => {
    const initial = playingState(maxSeats, specialMode);
    const latest = { ...initial, stateVersion: 139 };
    const sent: Array<{ event: string; version: number; operationId: string }> = [];
    vi.spyOn(tableSocket, "command").mockImplementation(async (event, payload) => {
      if (event !== "seat:leave" || !("operationId" in payload)) throw new Error("unexpected command");
      sent.push({ event, operationId: payload.operationId, version: payload.expectedStateVersion });
      if (payload.expectedStateVersion === 138) throw stale(latest);
      return { cashOutAmount: 0, deferred: true, gameSessionId: "session-0", playStatus: "LEAVE_AFTER_HAND", roomId: initial.room.roomId, seatId: "seat-0", seatIndex: 0, stack: 400, version: 2, walletBalance: 10_000 };
    });
    render(experience(initial));
    await stand();
    await waitFor(() => expect(screen.queryByRole("region", { name: "牌桌菜单" })).not.toBeInTheDocument());
    expect(sent.map((command) => command.version)).toEqual([138, 139]);
    expect(sent[1]!.operationId).not.toBe(sent[0]!.operationId);
    expect(useTableStore.getState().error).toBeNull();
    expect(screen.getByText(/已安排本手结束后站起/u)).toHaveAttribute("role", "status");
  });

  it("requires fresh consent when a marked squid player becomes unmarked during a stale stand", async () => {
    const initial = playingState();
    const latest = { ...initial, stateVersion: 139, seats: initial.seats.map((seat) => ({ ...seat, squidMarked: false })) };
    const command = vi.spyOn(tableSocket, "command").mockRejectedValue(stale(latest));
    render(experience(initial));
    await stand();
    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hero-hand")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "离开鱿鱼牌局" })).toHaveTextContent("每人支付 20 点");
  });

  it("reconfirms a new squid penalty if the mark changes while the original dialog stays open", async () => {
    const initial = playingState();
    const command = vi.spyOn(tableSocket, "command").mockRejectedValue(stale({ ...initial, stateVersion: 140, seats: initial.seats.map((seat) => ({ ...seat, squidMarked: false })) }));
    const view = render(experience(initial));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "打开牌桌菜单" }));
    await user.click(screen.getByRole("button", { name: /站起围观/u }));
    expect(screen.getByRole("dialog", { name: "离开鱿鱼牌局" })).toHaveTextContent("鱿鱼标记会丢失");
    view.rerender(experience({ ...initial, stateVersion: 139, seats: initial.seats.map((seat) => ({ ...seat, squidMarked: false })) }));
    await user.click(screen.getByRole("button", { name: "确认" }));
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "离开鱿鱼牌局" })).toHaveTextContent("每人支付 20 点");
  });

  it("does not loop or hide a second version conflict", async () => {
    const initial = playingState(9, "NORMAL");
    const command = vi.spyOn(tableSocket, "command").mockRejectedValue(stale({ ...initial, stateVersion: 139 }));
    render(experience(initial));
    await stand();
    expect(command).toHaveBeenCalledTimes(2);
    expect(useTableStore.getState().error).not.toBeNull();
    expect(screen.getByTestId("hero-hand")).toBeInTheDocument();
  });

  it.each(["REALTIME_TIMEOUT", "REALTIME_DISCONNECTED"] as const)("preserves the operation identity after an uncertain %s instead of auto-retrying", async (code) => {
    const initial = playingState(6, "NORMAL");
    const command = vi.spyOn(tableSocket, "command").mockRejectedValue(new RealtimeClientError(code, "操作结果未知"));
    render(experience(initial));
    await stand();
    expect(command).toHaveBeenCalledTimes(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /站起围观/u }));
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1]![1]).toEqual(command.mock.calls[0]![1]);
  });

  it.each(["released", "deferred"])("accepts an already %s seat from canonical authority without another penalty command", async (status) => {
    const initial = playingState();
    const latest = { ...initial, stateVersion: 139, seats: status === "released" ? [initial.seats[1]!] : initial.seats.map((seat) => ({ ...seat, playStatus: "LEAVE_AFTER_HAND" as const })) };
    const command = vi.spyOn(tableSocket, "command").mockRejectedValue(stale(latest));
    render(experience(initial));
    await stand();
    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "牌桌菜单" })).not.toBeInTheDocument();
    expect(useTableStore.getState().error).toBeNull();
  });

  it.each(variants)("removes reserved hero and action space after standing at $maxSeats seats in $specialMode", ({ maxSeats, specialMode }) => {
    const initial = playingState(maxSeats, specialMode);
    const view = render(experience(initial));
    expect(screen.getByTestId("mobile-table-stage")).toHaveAttribute("data-view-mode", "seated");
    const spectator = { ...initial, seats: [initial.seats[1]!], hand: projectedHand({ ownHoleCards: [] }), stateVersion: 140 };
    view.rerender(experience(spectator));
    expect(screen.getByTestId("mobile-table-stage")).toHaveAttribute("data-view-mode", "spectator");
    expect(screen.queryByTestId("hero-hand")).not.toBeInTheDocument();
    expect(view.container.querySelector(".table-hero-layer")).toBeNull();
    expect(view.container.querySelector(".table-action-layer")).toBeNull();
    expect(screen.getByRole("button", { name: "选择座位 1" })).toBeEnabled();
  });
});
