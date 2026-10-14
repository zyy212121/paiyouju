import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { projectedHand } from "../../../test/table-fixture.js";
import { useCommunityRunoutPresentation } from "./useCommunityRunoutPresentation.js";

describe("useCommunityRunoutPresentation", () => {
  it("paces an all-in board as flop, turn, river, then settlement at one-second intervals", () => {
    vi.useFakeTimers();
    try {
      const active = projectedHand({ board: [], street: "preflop" });
      const completed = projectedHand({
        actionHistory: [{ eventType: "BOARD_DEALT", stateVersion: 2, street: "showdown" }],
        board: ["2c", "3d", "4h", "5s", "6c"],
        street: "showdown",
      });
      const { result, rerender } = renderHook(
        ({ hand, review }: { readonly hand: typeof active; readonly review: boolean }) => useCommunityRunoutPresentation(hand, review),
        { initialProps: { hand: active, review: false } },
      );

      rerender({ hand: completed, review: true });
      act(() => vi.advanceTimersByTime(0));
      expect(result.current.hand?.board).toEqual(["2c", "3d", "4h"]);
      expect(result.current.hand?.street).toBe("flop");
      expect(result.current.settlementVisible).toBe(false);

      act(() => vi.advanceTimersByTime(999));
      expect(result.current.hand?.board).toHaveLength(3);
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.hand?.board).toHaveLength(4);
      expect(result.current.hand?.street).toBe("turn");

      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current.hand?.board).toHaveLength(5);
      expect(result.current.hand?.street).toBe("river");
      expect(result.current.settlementVisible).toBe(false);

      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current.settlementVisible).toBe(true);
      expect(result.current.hand?.street).toBe("showdown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an already completed hand immediately after refresh or reconnect", () => {
    const completed = projectedHand({ board: ["2c", "3d", "4h", "5s", "6c"], street: "showdown" });
    const { result } = renderHook(() => useCommunityRunoutPresentation(completed, true));
    expect(result.current.hand?.board).toHaveLength(5);
    expect(result.current.settlementVisible).toBe(true);
  });

  it("does not leak an automatic all-in settlement when refresh happens during its presentation window", () => {
    vi.useFakeTimers();
    try {
      const completed = projectedHand({
        actionHistory: [
          { eventType: "BOARD_DEALT", stateVersion: 2, street: "flop" },
          { eventType: "BOARD_DEALT", stateVersion: 3, street: "showdown" },
        ],
        board: ["2c", "3d", "4h", "5s", "6c"],
        street: "showdown",
      });
      const { result } = renderHook(() => useCommunityRunoutPresentation(completed, true));

      expect(result.current.hand?.board).toHaveLength(3);
      expect(result.current.settlementVisible).toBe(false);
      act(() => vi.advanceTimersByTime(3_000));
      expect(result.current.hand?.board).toHaveLength(5);
      expect(result.current.settlementVisible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not replay ordinary board updates as an automatic runout", () => {
    const active = projectedHand({ board: [], street: "preflop" });
    const completed = projectedHand({ board: ["2c", "3d", "4h", "5s", "6c"], street: "showdown" });
    const { result, rerender } = renderHook(
      ({ hand, review }: { readonly hand: typeof active; readonly review: boolean }) => useCommunityRunoutPresentation(hand, review),
      { initialProps: { hand: active, review: false } },
    );
    rerender({ hand: completed, review: true });
    expect(result.current.hand?.board).toHaveLength(5);
    expect(result.current.settlementVisible).toBe(true);
  });

  it("presents the first board and its result before dealing the second board", () => {
    vi.useFakeTimers();
    try {
      const active = projectedHand({ board: ["2c", "3d", "4h"], street: "flop" });
      const completed = projectedHand({
        actionHistory: [
          { eventType: "BOARD_DEALT", runoutIndex: 1, stateVersion: 2, street: "showdown" },
          { eventType: "BOARD_DEALT", runoutIndex: 2, stateVersion: 2, street: "showdown" },
        ],
        board: ["2c", "3d", "4h", "5s", "6c"],
        runoutBoards: [
          ["2c", "3d", "4h", "5s", "6c"],
          ["2c", "3d", "4h", "7s", "8c"],
        ],
        street: "showdown",
      });
      const { result, rerender } = renderHook(
        ({ hand, review }: { readonly hand: typeof active; readonly review: boolean }) => useCommunityRunoutPresentation(hand, review),
        { initialProps: { hand: active, review: false } },
      );

      rerender({ hand: completed, review: true });
      expect(result.current.runoutBoards).toEqual([["2c", "3d", "4h"], ["2c", "3d", "4h"]]);
      expect(result.current.completedRunoutCount).toBe(0);
      expect(result.current.settlementVisible).toBe(false);

      act(() => vi.advanceTimersByTime(2_000));
      expect(result.current.runoutBoards?.[0]).toHaveLength(5);
      expect(result.current.runoutBoards?.[1]).toHaveLength(3);

      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current.completedRunoutCount).toBe(1);

      act(() => vi.advanceTimersByTime(2_000));
      expect(result.current.runoutBoards?.[1]).toHaveLength(5);
      expect(result.current.completedRunoutCount).toBe(1);

      act(() => vi.advanceTimersByTime(2_000));
      expect(result.current.completedRunoutCount).toBe(2);
      expect(result.current.settlementVisible).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
