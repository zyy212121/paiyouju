import type { RoomChatMessage } from "@paiyouju/shared";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayerChatBubble } from "./PlayerChatBubble.js";

const message: RoomChatMessage = {
  content: `${"一".repeat(24)}${"二".repeat(24)}三👍`,
  createdAt: "2026-08-29T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  roomId: "room-a",
  sender: { nickname: "Alice", seatIndex: 0, userId: "user-a" },
};

describe("player chat bubble", () => {
  afterEach(() => vi.useRealTimers());

  it("replaces 24-grapheme pages instead of scrolling and disappears after the final page", () => {
    vi.useFakeTimers();
    render(<PlayerChatBubble message={message} placement="above" />);
    expect(screen.getByTestId("player-chat-bubble")).toHaveTextContent("一".repeat(24));
    expect(screen.getByTestId("player-chat-bubble")).not.toHaveTextContent("二");

    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.getByTestId("player-chat-bubble")).toHaveTextContent("二".repeat(24));
    act(() => vi.advanceTimersByTime(1_800));
    expect(screen.getByTestId("player-chat-bubble")).toHaveTextContent("三👍");
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByTestId("player-chat-bubble")).not.toBeInTheDocument();
  });
});
