import type { TableStateProjection } from "@paiyouju/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTableStore } from "./table-store.js";

const state = {
  bustedRebuyRequired: false,
  canOwnerStart: false,
  canRevealOwnCards: false,
  hand: null,
  lastHandSummary: null,
  nextActionAutopilot: null,
  nextActionAutopilotArmed: false,
  ownHandSummary: null,
  pendingShowCardIndices: [],
  postHandReviewEndsAt: null,
  presenceVersion: 0,
  protocolVersion: 9,
  recipient: { isOwner: true, userId: "alice" },
  reservedAwayEndsAt: null,
  room: { actionTimeSeconds: 30, bigBlind: 20, durationMinutes: 60, expiresAt: "2099-01-01T00:00:00.000Z", initialBuyIn: 400, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "牌桌", nextHandPaused: false, pointFeeRates: { actionTimeExtension: 10, handEntry: 10, hypotheticalRunout: 10, paidHandReveal: 50 }, requiresManualStart: true, runItTwiceEnabled: false, roomCode: "123456", roomId: "room", smallBlind: 10, specialMode: "NORMAL", status: "OPEN", squidRoundGraceEndsAt: null, squidRoundNumber: 1, squidStake: null, tableStartedAt: null },
  runtimeStatus: "IDLE",
  seats: [],
  startCountdownAt: null,
  stateVersion: 1,
  tableRunState: "WAITING_FOR_OWNER",
  trusteeshipEnabled: false,
} satisfies TableStateProjection;

describe("table recovery store", () => {
  beforeEach(() => useTableStore.getState().clear());
  afterEach(() => vi.useRealTimers());

  it("accepts only monotonic canonical state and invalidates legal actions while reconnecting", () => {
    useTableStore.getState().setState(state);
    useTableStore.getState().setState({ ...state, stateVersion: 0 });
    expect(useTableStore.getState().state?.stateVersion).toBe(1);
    useTableStore.getState().setConnection("reconnecting");
    expect(useTableStore.getState().connection).toBe("reconnecting");
  });

  it("replaces the same scoped state after a server restart resets presenceVersion", () => {
    useTableStore.getState().setState({ ...state, presenceVersion: 50, stateVersion: 10 });
    useTableStore.getState().replaceCanonicalState({ ...state, presenceVersion: 0, stateVersion: 10 });
    expect(useTableStore.getState().state).toMatchObject({ presenceVersion: 0, stateVersion: 10 });

    useTableStore.getState().replaceCanonicalState({ ...state, presenceVersion: 99, recipient: { isOwner: false, userId: "mallory" }, stateVersion: 11 });
    expect(useTableStore.getState().state?.recipient.userId).toBe("alice");
    useTableStore.getState().replaceCanonicalState({ ...state, presenceVersion: 99, room: { ...state.room, roomId: "another-room" }, stateVersion: 11 });
    expect(useTableStore.getState().state?.room.roomId).toBe("room");
  });

  it("renders the stable safe recovery message without server internals", () => {
    useTableStore.getState().applyError({ code: "RECOVERY_ERROR", message: "internal snapshot payload", requestId: "request" });
    expect(useTableStore.getState().error).toBe("牌桌恢复失败，已暂停操作，请保留页面并联系管理员。");
    expect(useTableStore.getState().error).not.toContain("snapshot");
  });

  it("automatically clears transient stale-state banners without clearing a newer message", () => {
    vi.useFakeTimers();
    useTableStore.getState().applyError({ code: "STALE_STATE", message: "stale", requestId: "request-1" });
    expect(useTableStore.getState().error).toBe("牌桌状态已刷新，请重新确认操作");
    vi.advanceTimersByTime(2_000);
    useTableStore.getState().applyClientError("新的提示");
    vi.advanceTimersByTime(1_000);
    expect(useTableStore.getState().error).toBe("新的提示");
    vi.advanceTimersByTime(2_000);
    expect(useTableStore.getState().error).toBeNull();
  });

  it("keeps recovery failures visible until explicitly cleared", () => {
    vi.useFakeTimers();
    useTableStore.getState().applyError({ code: "RECOVERY_ERROR", message: "internal", requestId: "request-2" });
    vi.advanceTimersByTime(30_000);
    expect(useTableStore.getState().error).toContain("牌桌恢复失败");
  });
});
