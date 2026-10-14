import type { RoomChatMessage } from "@paiyouju/shared";
import { describe, expect, it } from "vitest";

import { RoomChatBuffer } from "./room-chat-buffer.js";

function message(index: number, userId = "user-a"): RoomChatMessage {
  return {
    content: `消息 ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 29, 12, 0, index)).toISOString(),
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    roomId: "room-a",
    sender: { nickname: "Alice", seatIndex: 0, userId },
  };
}

describe("room chat buffer", () => {
  it("deduplicates retries by sender and client id without broadcasting twice", () => {
    const buffer = new RoomChatBuffer();
    const first = buffer.append("client-1", message(1));
    const retry = buffer.append("client-1", message(2));
    const otherUser = buffer.append("client-1", message(3, "user-b"));

    expect(first.inserted).toBe(true);
    expect(retry).toEqual({ inserted: false, message: first.message });
    expect(otherUser.inserted).toBe(true);
    expect(buffer.history("room-a").messages).toHaveLength(2);
  });

  it("retains only the latest 50 messages per room", () => {
    const buffer = new RoomChatBuffer();
    for (let index = 1; index <= 55; index += 1) buffer.append(`client-${index}`, message(index));
    const history = buffer.history("room-a");
    expect(history.messages).toHaveLength(50);
    expect(history.messages[0]?.content).toBe("消息 6");
    expect(history.messages.at(-1)?.content).toBe("消息 55");
  });
});
