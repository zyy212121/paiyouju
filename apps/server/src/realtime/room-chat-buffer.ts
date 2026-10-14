import {
  ROOM_CHAT_HISTORY_LIMIT,
  type RoomChatHistory,
  type RoomChatMessage,
} from "@paiyouju/shared";

interface BufferedRoomChatMessage {
  readonly clientMessageId: string;
  readonly message: RoomChatMessage;
}

export interface RoomChatAppendResult {
  readonly inserted: boolean;
  readonly message: RoomChatMessage;
}

export class RoomChatBuffer {
  private readonly entriesByRoom = new Map<string, BufferedRoomChatMessage[]>();

  append(clientMessageId: string, message: RoomChatMessage): RoomChatAppendResult {
    const entries = this.entriesByRoom.get(message.roomId) ?? [];
    const existing = entries.find((entry) => entry.clientMessageId === clientMessageId && entry.message.sender.userId === message.sender.userId);
    if (existing) return { inserted: false, message: existing.message };

    entries.push({ clientMessageId, message });
    if (entries.length > ROOM_CHAT_HISTORY_LIMIT) entries.splice(0, entries.length - ROOM_CHAT_HISTORY_LIMIT);
    this.entriesByRoom.set(message.roomId, entries);
    return { inserted: true, message };
  }

  clear(): void {
    this.entriesByRoom.clear();
  }

  history(roomId: string): RoomChatHistory {
    return {
      messages: (this.entriesByRoom.get(roomId) ?? []).map((entry) => entry.message),
      roomId,
    };
  }
}
