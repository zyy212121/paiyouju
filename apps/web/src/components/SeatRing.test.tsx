import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { projectedHand, tableState } from "../test/table-fixture.js";
import { SeatRing } from "./SeatRing.js";

describe("SeatRing action statuses", () => {
  it("shows each player's latest action only for the current street", () => {
    const hand = projectedHand({
      actionHistory: [
        { eventType: "PLAYER_CALLED", amount: 20, playerId: "user-a", stateVersion: 2, street: "preflop" },
        { eventType: "STREET_ADVANCED", stateVersion: 3, street: "flop" },
        { eventType: "PLAYER_ALL_IN", amount: 380, playerId: "user-1", stateVersion: 4, street: "flop" },
      ],
      street: "flop",
    });
    render(<SeatRing maxSeats={2} state={tableState({ hand })} />);

    expect(screen.getByText("全下")).toHaveClass("seat-action-label");
    expect(screen.queryByText("跟注")).not.toBeInTheDocument();
    expect(screen.getByText("十二个中文字符昵称测试玩家")).toBeInTheDocument();
  });

  it("places avatar chat bubbles toward free space instead of the top bar or hero controls", () => {
    const messages = {
      "user-0": { content: "底部消息", createdAt: "2026-08-29T12:00:00.000Z", id: "40000000-0000-4000-8000-000000000001", roomId: "room-1", sender: { nickname: "自己", seatIndex: 0, userId: "user-0" } },
      "user-1": { content: "顶部消息", createdAt: "2026-08-29T12:00:00.000Z", id: "40000000-0000-4000-8000-000000000002", roomId: "room-1", sender: { nickname: "对手", seatIndex: 1, userId: "user-1" } },
    } as const;
    const { container } = render(<SeatRing chatMessagesByUser={messages} maxSeats={2} state={tableState()} />);

    expect(container.querySelector('[data-visual-seat="0"] .player-chat-bubble')).toHaveClass("chat-placement-above");
    expect(container.querySelector('[data-visual-seat="1"] .player-chat-bubble')).toHaveClass("chat-placement-below");
  });
});
