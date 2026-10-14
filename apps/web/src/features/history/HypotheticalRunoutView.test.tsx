import type { HypotheticalRunoutResult } from "@paiyouju/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HypotheticalRunoutView } from "./HypotheticalRunoutView.js";

const mocks = vi.hoisted(() => ({ generateHypotheticalRunout: vi.fn() }));
vi.mock("../../api/hands.js", () => mocks);

const saved: HypotheticalRunoutResult = {
  actualBoard: ["2c", "3d", "4h"],
  cards: ["5s", "6c"],
  createdAt: "2026-08-24T00:00:00.000Z",
  generationSource: "ORIGINAL_REMAINING_DECK",
  handId: "10000000-0000-4000-8000-000000000002",
  simulatedBoard: ["2c", "3d", "4h", "5s", "6c"],
};

describe("HypotheticalRunoutView", () => {
  it("shows an already saved unique runout immediately after remount", () => {
    render(<HypotheticalRunoutView board={saved.actualBoard} existingResult={saved} handId={saved.handId} />);
    expect(screen.getByLabelText("发发看公共牌")).toHaveTextContent("2♣3♦4♥5♠6♣");
    expect(screen.queryByRole("button", { name: "发发看" })).not.toBeInTheDocument();
    expect(mocks.generateHypotheticalRunout).not.toHaveBeenCalled();
  });

  it("keeps the saved result when the same history page rerenders", () => {
    const view = render(<HypotheticalRunoutView board={saved.actualBoard} existingResult={saved} handId={saved.handId} />);
    view.rerender(<HypotheticalRunoutView board={saved.actualBoard} existingResult={saved} handId={saved.handId} />);
    expect(screen.getAllByRole("img")).toHaveLength(5);
  });
});
