import { create } from "zustand";
import type { RoomArchiveResult } from "@paiyouju/shared";

import {
  apiRequest,
  createOperationId,
  postJson,
  readableError,
  type CreateRoomInput,
  type PublicRoom,
  type WalletSummary,
} from "../api/client.js";
import { useAuthStore } from "./auth-store.js";

interface RoomState {
  readonly closedRooms: readonly PublicRoom[];
  readonly closedRoomsNextCursor: string | null;
  readonly currentRoom: PublicRoom | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly rooms: readonly PublicRoom[];
  readonly wallet: WalletSummary | null;
  clearError(): void;
  archiveAllClosedRooms(): Promise<number>;
  archiveRoom(roomId: string, operationId: string): Promise<RoomArchiveResult>;
  createRoom(input: CreateRoomInput): Promise<PublicRoom>;
  joinRoom(input: { readonly password?: string; readonly roomCode: string }): Promise<PublicRoom>;
  loadLobby(): Promise<void>;
  loadClosedRooms(append?: boolean): Promise<void>;
  loadRoom(roomId: string): Promise<PublicRoom>;
  ownerAction(roomId: string, action: "pause" | "resume" | "close"): Promise<PublicRoom>;
  refreshWallet(): Promise<void>;
}

export const useRoomStore = create<RoomState>((set) => ({
  archiveAllClosedRooms: async () => {
    set({ error: null });
    const archivedIds = new Set<string>();
    try {
      let cursor: string | null = null;
      const ownedRooms: PublicRoom[] = [];
      do {
        const query = new URLSearchParams({ limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const page = await apiRequest<{ readonly items: readonly PublicRoom[]; readonly nextCursor: string | null }>(`/api/rooms/closed?${query}`);
        ownedRooms.push(...page.items.filter((room) => room.memberRole === "OWNER"));
        cursor = page.nextCursor;
      } while (cursor);
      for (const room of ownedRooms) {
        await postJson<RoomArchiveResult>(`/api/rooms/${encodeURIComponent(room.id)}/archive`, { operationId: createOperationId() });
        archivedIds.add(room.id);
        set((state) => ({ closedRooms: state.closedRooms.filter((item) => item.id !== room.id) }));
      }
      return archivedIds.size;
    } catch (error: unknown) {
      set({ error: readableError(error) });
      throw error;
    }
  },
  archiveRoom: async (roomId, operationId) => {
    set({ error: null });
    try {
      const result = await postJson<RoomArchiveResult>(`/api/rooms/${encodeURIComponent(roomId)}/archive`, { operationId });
      set((state) => ({ closedRooms: state.closedRooms.filter((room) => room.id !== roomId) }));
      return result;
    } catch (error: unknown) {
      set({ error: readableError(error) });
      throw error;
    }
  },
  clearError: () => set({ error: null }),
  closedRooms: [],
  closedRoomsNextCursor: null,
  createRoom: async (input) => {
    set({ error: null, loading: true });
    try {
      const room = await postJson<PublicRoom>("/api/rooms", input, { "idempotency-key": createOperationId() });
      set((state) => ({ currentRoom: room, loading: false, rooms: [room, ...state.rooms.filter((item) => item.id !== room.id)] }));
      return room;
    } catch (error: unknown) {
      set({ error: readableError(error), loading: false });
      throw error;
    }
  },
  currentRoom: null,
  error: null,
  joinRoom: async (input) => {
    set({ error: null, loading: true });
    try {
      const room = await postJson<PublicRoom>("/api/rooms/join", input);
      set((state) => ({ currentRoom: room, loading: false, rooms: [room, ...state.rooms.filter((item) => item.id !== room.id)] }));
      return room;
    } catch (error: unknown) {
      set({ error: readableError(error), loading: false });
      throw error;
    }
  },
  loadLobby: async () => {
    set({ error: null, loading: true });
    try {
      const [rooms, wallet] = await Promise.all([
        apiRequest<readonly PublicRoom[]>("/api/rooms"),
        apiRequest<WalletSummary>("/api/wallet"),
      ]);
      useAuthStore.getState().updateWalletBalance(wallet.balance);
      set({ loading: false, rooms, wallet });
    } catch (error: unknown) {
      set({ error: readableError(error), loading: false });
    }
  },
  loading: false,
  loadClosedRooms: async (append = false) => {
    set({ error: null });
    try {
      const cursor = append ? useRoomStore.getState().closedRoomsNextCursor : null;
      const query = new URLSearchParams({ limit: "25" });
      if (cursor) query.set("cursor", cursor);
      const page = await apiRequest<{ readonly items: readonly PublicRoom[]; readonly nextCursor: string | null }>(`/api/rooms/closed?${query}`);
      set((state) => ({
        closedRooms: append ? [...state.closedRooms, ...page.items] : page.items,
        closedRoomsNextCursor: page.nextCursor,
      }));
    } catch (error: unknown) {
      set({ error: readableError(error) });
    }
  },
  loadRoom: async (roomId) => {
    set({ error: null, loading: true });
    try {
      const room = await apiRequest<PublicRoom>(`/api/rooms/${roomId}`);
      set({ currentRoom: room, loading: false });
      return room;
    } catch (error: unknown) {
      set({ error: readableError(error), loading: false });
      throw error;
    }
  },
  ownerAction: async (roomId, action) => {
    set({ error: null, loading: true });
    try {
      const room = await postJson<PublicRoom>(`/api/rooms/${roomId}/${action}`);
      set((state) => ({ currentRoom: room, loading: false, rooms: state.rooms.map((item) => item.id === room.id ? room : item) }));
      return room;
    } catch (error: unknown) {
      set({ error: readableError(error), loading: false });
      throw error;
    }
  },
  refreshWallet: async () => {
    const wallet = await apiRequest<WalletSummary>("/api/wallet");
    useAuthStore.getState().updateWalletBalance(wallet.balance);
    set({ wallet });
  },
  rooms: [],
  wallet: null,
}));
