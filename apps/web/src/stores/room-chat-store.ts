import { ROOM_CHAT_BUBBLE_GRAPHEMES, ROOM_CHAT_HISTORY_LIMIT, countRoomChatGraphemes, type RoomChatHistory, type RoomChatMessage } from "@paiyouju/shared";
import { create } from "zustand";

interface RoomChatState {
  readonly latestLiveByUser: Readonly<Record<string, RoomChatMessage>>;
  readonly messages: readonly RoomChatMessage[];
  readonly roomId: string | null;
  clear(): void;
  openRoom(roomId: string): void;
  pruneLiveForSeats(seats: readonly { readonly seatIndex: number; readonly userId: string }[]): void;
  receiveMessage(message: RoomChatMessage): void;
  replaceHistory(history: RoomChatHistory): void;
}

const emptyState = {
  latestLiveByUser: {},
  messages: [],
  roomId: null,
} as const;

const CHAT_BUBBLE_PAGE_DURATION_MS = 1_800;
const CHAT_BUBBLE_FINAL_DURATION_MS = 3_000;

export const useRoomChatStore = create<RoomChatState>((set, get) => {
  const liveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancelLive = (userId: string) => {
    const timer = liveTimers.get(userId);
    if (timer) clearTimeout(timer);
    liveTimers.delete(userId);
  };
  const cancelAllLive = () => {
    for (const timer of liveTimers.values()) clearTimeout(timer);
    liveTimers.clear();
  };
  const scheduleExpiry = (message: RoomChatMessage) => {
    cancelLive(message.sender.userId);
    const pages = Math.max(1, Math.ceil(countRoomChatGraphemes(message.content) / ROOM_CHAT_BUBBLE_GRAPHEMES));
    const lifetime = (pages - 1) * CHAT_BUBBLE_PAGE_DURATION_MS + CHAT_BUBBLE_FINAL_DURATION_MS;
    liveTimers.set(message.sender.userId, setTimeout(() => {
      liveTimers.delete(message.sender.userId);
      set((current) => {
        if (current.latestLiveByUser[message.sender.userId]?.id !== message.id) return current;
        const latestLiveByUser = { ...current.latestLiveByUser };
        delete latestLiveByUser[message.sender.userId];
        return { latestLiveByUser };
      });
    }, lifetime));
  };

  return {
    ...emptyState,
    clear: () => { cancelAllLive(); set(emptyState); },
    openRoom: (roomId) => {
      if (get().roomId === roomId) return;
      cancelAllLive();
      set({ ...emptyState, roomId });
    },
    pruneLiveForSeats: (seats) => {
      const current = get();
      const seated = new Map(seats.map((seat) => [seat.userId, seat.seatIndex]));
      const latestLiveByUser = { ...current.latestLiveByUser };
      let changed = false;
      for (const [userId, message] of Object.entries(current.latestLiveByUser)) {
        if (message.sender.seatIndex !== null && seated.get(userId) === message.sender.seatIndex) continue;
        cancelLive(userId);
        delete latestLiveByUser[userId];
        changed = true;
      }
      if (changed) set({ latestLiveByUser });
    },
    receiveMessage: (message) => {
      const current = get();
      if (current.roomId !== null && current.roomId !== message.roomId) return;
      if (current.messages.some((candidate) => candidate.id === message.id)) return;
      const latestLiveByUser = { ...current.latestLiveByUser };
      if (message.sender.seatIndex === null) {
        cancelLive(message.sender.userId);
        delete latestLiveByUser[message.sender.userId];
      } else {
        latestLiveByUser[message.sender.userId] = message;
        scheduleExpiry(message);
      }
      set({
        latestLiveByUser,
        messages: [...current.messages, message].slice(-ROOM_CHAT_HISTORY_LIMIT),
        roomId: message.roomId,
      });
    },
    replaceHistory: (history) => {
      const current = get();
      if (current.roomId !== null && current.roomId !== history.roomId) return;
      cancelAllLive();
      set({
        latestLiveByUser: {},
        messages: history.messages.slice(-ROOM_CHAT_HISTORY_LIMIT),
        roomId: history.roomId,
      });
    },
  };
});
