import type { RealtimeError, TableStateProjection } from "@paiyouju/shared";
import { create } from "zustand";

interface TableState {
  readonly connection: "connected" | "reconnecting" | "disconnected";
  readonly error: string | null;
  readonly state: TableStateProjection | null;
  applyClientError(message: string): void;
  applyError(error: RealtimeError): void;
  clear(): void;
  clearError(): void;
  invalidateLegalActions(): void;
  replaceCanonicalState(state: TableStateProjection): void;
  setConnection(connection: TableState["connection"]): void;
  setState(state: TableStateProjection): void;
}

const TRANSIENT_ERROR_DURATION_MS = 3_000;
let transientErrorGeneration = 0;
let transientErrorTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTransientError(): void {
  transientErrorGeneration += 1;
  if (transientErrorTimer !== null) clearTimeout(transientErrorTimer);
  transientErrorTimer = null;
}

function scheduleTransientError(set: (update: Partial<TableState>) => void, message: string): void {
  cancelTransientError();
  const generation = transientErrorGeneration;
  set({ error: message });
  transientErrorTimer = setTimeout(() => {
    if (generation !== transientErrorGeneration) return;
    transientErrorTimer = null;
    set({ error: null });
  }, TRANSIENT_ERROR_DURATION_MS);
}

function shouldAccept(current: TableStateProjection | null, incoming: TableStateProjection): boolean {
  return current === null
    || incoming.stateVersion > current.stateVersion
    || (incoming.stateVersion === current.stateVersion && incoming.presenceVersion > current.presenceVersion);
}

function hasCanonicalScope(current: TableStateProjection | null, incoming: TableStateProjection): boolean {
  return current === null
    || (current.room.roomId === incoming.room.roomId && current.recipient.userId === incoming.recipient.userId);
}

export const useTableStore = create<TableState>((set) => ({
  applyClientError: (error) => scheduleTransientError(set, error),
  applyError: (error) => {
    const message = error.code === "STALE_STATE"
      ? "牌桌状态已刷新，请重新确认操作"
      : error.code === "RECOVERY_ERROR"
        ? "牌桌恢复失败，已暂停操作，请保留页面并联系管理员。"
        : error.message;
    if (error.code === "RECOVERY_ERROR") {
      cancelTransientError();
      set((current) => ({
        error: message,
        state: error.latestState && shouldAccept(current.state, error.latestState) ? error.latestState : current.state,
      }));
      return;
    }
    set((current) => ({
      state: error.latestState && shouldAccept(current.state, error.latestState) ? error.latestState : current.state,
    }));
    scheduleTransientError(set, message);
  },
  clear: () => { cancelTransientError(); set({ connection: "disconnected", error: null, state: null }); },
  clearError: () => { cancelTransientError(); set({ error: null }); },
  connection: "disconnected",
  error: null,
  invalidateLegalActions: () => set((current) => {
    if (!current.state?.hand?.legalActions) return current;
    return {
      state: {
        ...current.state,
        hand: { ...current.state.hand, legalActions: null },
      },
    };
  }),
  replaceCanonicalState: (incoming) => set((current) => hasCanonicalScope(current.state, incoming) ? { state: incoming } : current),
  setConnection: (connection) => set({ connection }),
  setState: (incoming) => set((current) => shouldAccept(current.state, incoming) ? { state: incoming } : current),
  state: null,
}));
