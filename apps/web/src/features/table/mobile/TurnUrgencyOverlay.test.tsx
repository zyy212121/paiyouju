import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TurnUrgencyOverlay } from "./TurnUrgencyOverlay.js";

describe("TurnUrgencyOverlay", () => {
  it("appears only in the final three seconds and extends immediately without confirmation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    const extend = vi.fn();
    const urgencySecond = vi.fn();
    render(<TurnUrgencyOverlay canAfford deadline="2026-08-25T00:00:04.000Z" onExtend={extend} onUrgencySecond={urgencySecond} />);
    expect(screen.queryByTestId("turn-urgency-overlay")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_050));
    expect(screen.getByTestId("turn-urgency-overlay")).toHaveTextContent("3");
    expect(urgencySecond).toHaveBeenLastCalledWith(3);
    act(() => vi.advanceTimersByTime(1_000));
    expect(urgencySecond).toHaveBeenLastCalledWith(2);
    act(() => vi.advanceTimersByTime(1_000));
    expect(urgencySecond).toHaveBeenLastCalledWith(1);
    expect(urgencySecond.mock.calls.map(([seconds]) => seconds)).toEqual([3, 2, 1]);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "加时" }));
    expect(extend).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("does nothing when points are insufficient", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    render(<TurnUrgencyOverlay canAfford={false} deadline="2026-08-25T00:00:02.000Z" onExtend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "加时" })).toBeDisabled();
    vi.useRealTimers();
  });
});
