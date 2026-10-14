import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CardBack, PlayingCard, SuitSymbol } from "./PlayingCard.js";
import { PokerChip } from "./PokerChip.js";

describe("original card and chip visuals", () => {
  it("renders a readable rank and suit for an authorized face-up card", () => {
    const { container } = render(<PlayingCard code="Ah" highlighted size="large" />);
    expect(screen.getByRole("img", { name: "A♥" })).toBeInTheDocument();
    expect(container.querySelector('[data-card-code="Ah"]')).not.toBeNull();
    expect(screen.getAllByText("A")).toHaveLength(1);
  });

  it("renders a fixed back without exposing a supplied card code", () => {
    const { container } = render(<PlayingCard code="As" faceDown />);
    expect(screen.getByRole("img", { name: "隐藏底牌" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("As");
    expect(container.querySelector("[data-card-code]")).toBeNull();
  });

  it("provides reusable suit, compact back and numeric chip primitives", () => {
    render(<><SuitSymbol suit="s" /><CardBack size="compact" /><PokerChip amount={2_000_000_000} label="底池" /></>);
    expect(screen.getByText("♠")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "隐藏底牌" })).toBeInTheDocument();
    expect(screen.getByLabelText("底池 2,000,000,000")).toHaveTextContent("2,000,000,000");
  });

  it("renders rank ten as 10 while retaining the canonical T card code", () => {
    render(<PlayingCard code="Th" small />);
    expect(screen.getByLabelText("10♥")).toHaveAttribute("data-card-code", "Th");
    expect(screen.getByText("10")).toHaveClass("playing-card-rank");
    expect(screen.queryByText("T")).not.toBeInTheDocument();
  });
});
