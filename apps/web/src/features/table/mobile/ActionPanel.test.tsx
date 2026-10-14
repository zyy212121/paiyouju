import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectedLegalActions } from "@paiyouju/shared";
import { describe, expect, it, vi } from "vitest";

import { ActionPanel } from "./ActionPanel.js";

const legal: ProjectedLegalActions = {
  allInTo: 400,
  callAmount: 20,
  canAllIn: true,
  canBet: false,
  canCall: true,
  canCheck: false,
  canFold: true,
  canRaise: true,
  maximumBet: null,
  maximumRaiseTo: 400,
  minimumBet: null,
  minimumRaiseTo: 40,
};

describe("mobile ActionPanel", () => {
  it("submits every quick size immediately while keeping the exact raise slider on the main action", async () => {
    const user = userEvent.setup();
    const act = vi.fn().mockResolvedValue(undefined);
    render(<ActionPanel actionKey="hand-a:0:deadline-a" actionTimeSeconds={30} autopilot={null} currentBet={20} deadline={new Date(Date.now() + 20_000).toISOString()} disabled={false} legal={legal} onAction={act} onToggleAutopilot={vi.fn()} pot={120} waitingCallAmount={0} />);
    for (const label of ["1/3 Pot", "1/2 Pot", "2/3 Pot", "Pot", "1.2 Pot", "All-in"]) expect(screen.getByRole("button", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}，`) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /1\/2 Pot，加注至 90/ }));
    expect(act).toHaveBeenCalledWith({ raiseTo: 90, type: "raiseTo" });
    expect(screen.queryByRole("slider", { name: "竖向加注滑杆" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^加注至 40$/ }));
    expect(screen.getByRole("slider", { name: "竖向加注滑杆" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "精确下注金额" })).toHaveValue(40);
    expect(screen.getByText("约 0.14 Pot")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "精确下注金额" }), { target: { value: "160" } });
    expect(screen.getByText("约 1.00 Pot")).toBeInTheDocument();
  });

  it("keeps a manually opened exact-raise dialog across presentation-only state updates", async () => {
    const user = userEvent.setup();
    const common = { actionTimeSeconds: 30, autopilot: null, currentBet: 20, deadline: new Date(Date.now() + 20_000).toISOString(), disabled: false, legal, onAction: vi.fn().mockResolvedValue(undefined), onToggleAutopilot: vi.fn(), pot: 120, waitingCallAmount: 0 };
    const view = render(<ActionPanel {...common} actionKey="hand-a:0:deadline-a" />);
    await user.click(screen.getByRole("button", { name: /^加注至 40$/ }));
    expect(screen.getByRole("dialog", { name: /加注至 40/ })).toBeInTheDocument();

    view.rerender(<ActionPanel {...common} actionKey="hand-a:0:deadline-a" />);
    expect(screen.getByRole("dialog", { name: /加注至 40/ })).toBeInTheDocument();

    view.rerender(<ActionPanel {...common} actionKey="hand-a:1:deadline-b" />);
    expect(screen.queryByRole("dialog", { name: /加注至 40/ })).not.toBeInTheDocument();
  });

  it("offers reversible check-or-fold and current-bet-bound auto-call while waiting", async () => {
    const toggle = vi.fn();
    const user = userEvent.setup();
    const view = render(<ActionPanel actionKey="waiting" actionTimeSeconds={30} autopilot={null} currentBet={20} deadline={null} disabled={false} legal={null} onAction={vi.fn()} onToggleAutopilot={toggle} pot={30} waitingCallAmount={10} />);
    const checkFold = screen.getByRole("button", { name: "让或弃" });
    const autoCall = screen.getByRole("button", { name: "自动跟注 10" });
    expect(checkFold).toHaveAttribute("aria-pressed", "false");
    expect(autoCall).toHaveAttribute("aria-pressed", "false");
    await user.click(checkFold);
    await user.click(autoCall);
    expect(toggle).toHaveBeenNthCalledWith(1, "CHECK_OR_FOLD");
    expect(toggle).toHaveBeenNthCalledWith(2, "CALL");

    view.rerender(<ActionPanel actionKey="waiting" actionTimeSeconds={30} autopilot={{ mode: "CALL", currentBet: 20, callAmount: 10 }} currentBet={20} deadline={null} disabled={false} legal={null} onAction={vi.fn()} onToggleAutopilot={toggle} pot={30} waitingCallAmount={10} />);
    expect(screen.getByRole("button", { name: "自动跟注 10" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("下注变化时自动取消")).toBeInTheDocument();
  });

  it("hides auto-call when there is nothing to call", () => {
    render(<ActionPanel actionKey="waiting" actionTimeSeconds={30} autopilot={{ mode: "CHECK_OR_FOLD" }} currentBet={0} deadline={null} disabled={false} legal={null} onAction={vi.fn()} onToggleAutopilot={vi.fn()} pot={0} waitingCallAmount={0} />);
    expect(screen.getByRole("button", { name: "让或弃" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /自动跟注/ })).not.toBeInTheDocument();
  });

  it("renders no action or preaction controls for a spectator", () => {
    const { container } = render(<ActionPanel actionKey="spectator" actionTimeSeconds={30} autopilot={null} canParticipate={false} currentBet={20} deadline={null} disabled={false} legal={null} onAction={vi.fn()} onToggleAutopilot={vi.fn()} pot={30} waitingCallAmount={10} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "让或弃" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /自动跟注/ })).not.toBeInTheDocument();
  });
});
