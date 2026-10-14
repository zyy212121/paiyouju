import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { projectedSeat, tableState } from "../../../test/table-fixture.js";
import { TableCenterInfo } from "./TableCenterInfo.js";

describe("TableCenterInfo", () => {
  it("shows invite for one eligible player and owner start for two", async () => {
    const user = userEvent.setup();
    const copy = vi.fn();
    const start = vi.fn();
    const one = tableState({ canOwnerStart: false, seats: [projectedSeat(0, "user-0")] });
    const view = render(<TableCenterInfo onCopyInvite={copy} onStart={start} state={one} working={false} />);
    await user.click(screen.getByRole("button", { name: "邀请好友" }));
    expect(copy).toHaveBeenCalledOnce();
    view.rerender(<TableCenterInfo onCopyInvite={copy} onStart={start} state={tableState()} working={false} />);
    await user.click(screen.getByRole("button", { name: "开始游戏" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("shows the authoritative room countdown while insufficient players stop dealing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:30:00.000Z"));
    render(<TableCenterInfo onCopyInvite={vi.fn()} onStart={vi.fn()} state={tableState({ canOwnerStart: false, tableRunState: "STOPPED_INSUFFICIENT_PLAYERS" })} working={false} />);
    expect(screen.getByText("有效玩家不足，牌局停发")).toBeInTheDocument();
    expect(screen.queryByText(/计时|倒计时继续/u)).not.toBeInTheDocument();
    expect(screen.getByTestId("table-remaining")).toHaveTextContent("00:30:00");
    vi.useRealTimers();
  });

  it("shows the next bomb-pot countdown and switches to the due-state label", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-24T00:30:00.000Z"));
      const base = tableState();
      const state = tableState({ room: {
        ...base.room,
        bombPotBlindMultiplier: 3,
        bombPotIntervalMinutes: 10,
        bombPotNextAt: "2026-08-24T00:30:30.000Z",
        specialMode: "BOMB_POT",
      } });
      render(<TableCenterInfo onCopyInvite={vi.fn()} onStart={vi.fn()} state={state} working={false} />);
      expect(screen.getByTestId("bomb-pot-countdown")).toHaveTextContent("暴击倒计时 00:30");
      act(() => vi.advanceTimersByTime(31_000));
      expect(screen.getByTestId("bomb-pot-countdown")).toHaveTextContent("下一手暴击");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start the bomb-pot countdown before the table starts", () => {
    const base = tableState();
    const state = tableState({ room: {
      ...base.room,
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 10,
      bombPotNextAt: null,
      specialMode: "BOMB_POT",
      tableStartedAt: null,
    } });
    render(<TableCenterInfo onCopyInvite={vi.fn()} onStart={vi.fn()} state={state} working={false} />);
    expect(screen.getByTestId("bomb-pot-countdown")).toHaveTextContent("暴击倒计时 等待开桌");
  });
});
