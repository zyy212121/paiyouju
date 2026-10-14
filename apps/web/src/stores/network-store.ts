import { create } from "zustand";

interface NetworkState {
  readonly online: boolean;
  readonly pendingWrites: number;
  readonly refreshVersion: number;
  beginWrite(): void;
  endWrite(): void;
  setOnline(online: boolean): void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  beginWrite: () => set((state) => ({ pendingWrites: state.pendingWrites + 1 })),
  endWrite: () => set((state) => ({ pendingWrites: Math.max(0, state.pendingWrites - 1) })),
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pendingWrites: 0,
  refreshVersion: 0,
  setOnline: (online) => set((state) => ({
    online,
    refreshVersion: online && !state.online ? state.refreshVersion + 1 : state.refreshVersion,
  })),
}));
