import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DoubleRunoutBoard } from "./DoubleRunoutBoard.js";
import { RunoutChoiceOverlay } from "./RunoutChoiceOverlay.js";

describe("run-it-twice table UI", () => {
  it("lets only an eligible all-in player choose and shows the selected state", async () => {
    const choose = vi.fn();
    const user = userEvent.setup();
    render(<RunoutChoiceOverlay disabled={false} onChoose={choose} userId="alice" vote={{
      deadlineAt: new Date(Date.now() + 5_000).toISOString(),
      eligibleUserIds: ["alice", "bob"],
      ownChoice: "TWICE",
      respondedUserIds: ["alice"],
    }} />);

    expect(screen.getByRole("dialog", { name: "发牌次数协商" })).toHaveTextContent("1/2 已选择");
    expect(screen.getByRole("button", { name: "发两次" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "发一次" }));
    expect(choose).toHaveBeenCalledWith("ONCE");
  });

  it("shows both boards and reveals each participant result in order", () => {
    const { rerender } = render(<DoubleRunoutBoard boards={[["2c", "3d", "4h", "5s", "6c"], ["2c", "3d", "4h"]]} completedRunoutCount={1} results={[
      { ownNetResult: -16, runoutIndex: 1, totalPot: 31, winnerUserIds: ["alice"] },
      { ownNetResult: -15, runoutIndex: 2, totalPot: 30, winnerUserIds: ["bob"] },
    ]} userId="alice" />);

    expect(screen.getByTestId("runout-board-1")).toHaveTextContent("YOU WIN");
    expect(screen.getByTestId("runout-board-2")).not.toHaveTextContent("YOU LOSE");
    rerender(<DoubleRunoutBoard boards={[["2c", "3d", "4h", "5s", "6c"], ["2c", "3d", "4h", "7s", "8c"]]} completedRunoutCount={2} results={[
      { ownNetResult: -16, runoutIndex: 1, totalPot: 31, winnerUserIds: ["alice"] },
      { ownNetResult: -15, runoutIndex: 2, totalPot: 30, winnerUserIds: ["bob"] },
    ]} userId="alice" />);
    expect(screen.getByTestId("runout-board-2")).toHaveTextContent("YOU LOSE");
  });
});
