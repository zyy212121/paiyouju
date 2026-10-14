import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "./ActionBar.js";

const raiseLegal = {
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
  minimumRaiseTo: 60,
};

describe("server-authoritative action controls", () => {
  it("submits raise-to totals and offers pot/all-in shortcuts", () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(<ActionBar disabled={false} legal={raiseLegal} onAction={onAction} pot={120} />);
    expect(screen.getByRole("button", { name: "1/2 池" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2/3 池" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "满池" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("加注至"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "加注至 180" }));
    expect(onAction).toHaveBeenCalledWith({ raiseTo: 180, type: "raiseTo" });
  });

  it("disables every write action when the socket is disconnected", () => {
    render(<ActionBar disabled legal={raiseLegal} onAction={vi.fn()} pot={120} />);
    for (const button of [
      screen.getByRole("button", { name: /^弃牌$/u }),
      screen.getByRole("button", { name: /^跟注/u }),
      screen.getByRole("button", { name: /^加注至/u }),
      screen.getByRole("button", { name: /^全下 \d+$/u }),
    ]) {
      expect(button).toBeDisabled();
    }
  });

  it("rejects exponent and non-integer text before emitting an action", () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(<ActionBar disabled={false} legal={raiseLegal} onAction={onAction} pot={120} />);
    fireEvent.change(screen.getByLabelText("加注至"), { target: { value: "1e2" } });
    fireEvent.click(screen.getByRole("button", { name: "加注至 60" }));
    expect(onAction).toHaveBeenCalledWith({ raiseTo: 60, type: "raiseTo" });
  });
});
