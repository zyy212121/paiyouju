import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HistoryHoleCards } from "./HistoryCards.js";

const base = {
  allIn: false,
  committed: 20,
  endingStack: 380,
  folded: true,
  handLabel: null,
  netResult: -20,
  nickname: "对手",
  seatIndex: 1,
  startingStack: 400,
  userId: "opponent",
};

describe("HistoryHoleCards privacy", () => {
  it("renders a fixed card back with no secret code in DOM or accessibility text", () => {
    const view = render(<HistoryHoleCards player={{ ...base, holeCards: null, holeCardsVisibility: "HIDDEN" }} />);
    expect(screen.getAllByLabelText("隐藏底牌")).toHaveLength(2);
    expect(view.container.innerHTML).not.toMatch(/As|Kd|data-code|title=/);
  });

  it("renders only explicitly authorized cards", () => {
    render(<HistoryHoleCards player={{ ...base, handLabel: "高牌", holeCards: ["As", "Kd"], holeCardsVisibility: "PURCHASED" }} />);
    expect(screen.getByLabelText("A♠")).toBeInTheDocument();
    expect(screen.getByLabelText("K♦")).toBeInTheDocument();
    expect(screen.getByText("高牌")).toBeInTheDocument();
  });
});
