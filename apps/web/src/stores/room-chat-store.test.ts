import type { RoomChatMessage } from "@paiyouju/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRoomChatStore } from "./room-chat-store.js";

function message(index: number): RoomChatMessage {
  return {
    content: `消息 ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 29, 12, 0, index)).toISOString(),
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    roomId: "room-a",
    sender: { nickname: "Alice", seatIndex: 0, userId: "user-a" },
  };
}

describe("room chat store", () => {
  beforeEach(() => useRoomChatStore.getState().clear());
  afterEach(() => {
    useRoomChatStore.getState().clear();
    vi.useRealTimers();
  });

  it("restores history without replaying old avatar bubbles", () => {
    useRoomChatStore.getState().replaceHistory({ messages: [message(1)], roomId: "room-a" });
    expect(useRoomChatStore.getState().messages).toHaveLength(1);
    expect(useRoomChatStore.getState().latestLiveByUser).toEqual({});
  });

  it("deduplicates live delivery and exposes only the newest live message per sender", () => {
    useRoomChatStore.getState().receiveMessage(message(1));
    useRoomChatStore.getState().receiveMessage(message(1));
    useRoomChatStore.getState().receiveMessage(message(2));
    expect(useRoomChatStore.getState().messages).toHaveLength(2);
    expect(useRoomChatStore.getState().latestLiveByUser["user-a"]?.id).toBe(message(2).id);
  });

  it("never queues a standing message for a later seat bubble", () => {
    useRoomChatStore.getState().receiveMessage({ ...message(1), sender: { ...message(1).sender, seatIndex: null } });
    expect(useRoomChatStore.getState().messages).toHaveLength(1);
    expect(useRoomChatStore.getState().latestLiveByUser).toEqual({});
  });

  it("expires live bubbles independently of seat component mounts and prunes them when the sender stands", () => {
    vi.useFakeTimers();
    useRoomChatStore.getState().receiveMessage(message(1));
    useRoomChatStore.getState().pruneLiveForSeats([]);
    expect(useRoomChatStore.getState().latestLiveByUser).toEqual({});

    useRoomChatStore.getState().receiveMessage(message(2));
    vi.advanceTimersByTime(3_000);
    expect(useRoomChatStore.getState().latestLiveByUser).toEqual({});
  });
});
