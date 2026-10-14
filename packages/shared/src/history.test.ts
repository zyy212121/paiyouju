import { describe, expect, it } from "vitest";

import {
  GameSessionSummarySchema,
  HandSummarySchema,
  HandDetailPlayerSchema,
  HandHistoryQuerySchema,
  HistoryErrorCodeSchema,
  HypotheticalRunoutInputSchema,
  HypotheticalRunoutResultSchema,
  PaidHandRevealResultSchema,
  PaidHandRevealInputSchema,
  PaidCardRevealInputSchema,
  ReplayPlayerSchema,
} from "./history.js";

describe("Step 6 shared history contracts", () => {
  it("rejects real cards in a hidden history projection", () => {
    expect(HandDetailPlayerSchema.safeParse({
      allIn: false,
      committed: 20,
      endingStack: 380,
      folded: true,
      handLabel: null,
      holeCards: ["As", "Kd"],
      holeCardsVisibility: "HIDDEN",
      netResult: -20,
      nickname: "对手",
      seatIndex: 1,
      startingStack: 400,
      userId: "player-b",
    }).success).toBe(false);
  });

  it("accepts a voluntary history reveal with exactly one public card slot", () => {
    const partial = HandDetailPlayerSchema.parse({
      allIn: false,
      committed: 20,
      endingStack: 380,
      folded: true,
      handLabel: null,
      holeCards: ["As", null],
      holeCardsVisibility: "PUBLIC_VOLUNTARY",
      netResult: -20,
      nickname: "对手",
      seatIndex: 1,
      startingStack: 400,
      userId: "player-b",
    });
    expect(partial.holeCards).toEqual(["As", null]);
    expect(HandDetailPlayerSchema.safeParse({ ...partial, holeCards: [null, null] }).success).toBe(false);
    expect(HandDetailPlayerSchema.safeParse({ ...partial, handLabel: "高牌" }).success).toBe(false);
  });

  it("rejects real cards in a hidden replay state", () => {
    expect(ReplayPlayerSchema.safeParse({
      allIn: false,
      committed: 0,
      folded: false,
      holeCards: ["As", "Kd"],
      holeCardsVisibility: "HIDDEN",
      nickname: "对手",
      seatIndex: 1,
      stack: 400,
      userId: "player-b",
    }).success).toBe(false);
  });

  it("distinguishes active current results from closed final results", () => {
    const common = {
      gameSessionId: "session-a",
      handsPlayed: 2,
      room: { roomCode: "123456", roomId: "room-a", roomName: "牌友桌" },
      seatIndex: 0,
      startedAt: "2026-08-20T00:00:00.000Z",
      totalBuyIn: 400,
      totalCashOut: 0,
    };
    expect(GameSessionSummarySchema.safeParse({
      ...common,
      currentStack: 520,
      endedAt: null,
      netResult: null,
      provisionalNetResult: 120,
      status: "ACTIVE",
    }).success).toBe(true);
    expect(GameSessionSummarySchema.safeParse({
      ...common,
      currentStack: null,
      endedAt: "2026-08-20T01:00:00.000Z",
      netResult: 120,
      provisionalNetResult: null,
      status: "CLOSED",
      totalCashOut: 520,
    }).success).toBe(true);
  });

  it("requires one strict operation identifier for a paid reveal", () => {
    expect(PaidCardRevealInputSchema.parse({
      operationId: "10000000-0000-4000-8000-000000000001",
      targetUserId: "player-b",
    })).toEqual({
      operationId: "10000000-0000-4000-8000-000000000001",
      targetUserId: "player-b",
    });
    expect(PaidCardRevealInputSchema.safeParse({
      idempotencyKey: "second-channel",
      operationId: "10000000-0000-4000-8000-000000000001",
      targetUserId: "player-b",
    }).success).toBe(false);
  });

  it("uses a hand-level reveal purchase without accepting a target player", () => {
    expect(PaidHandRevealInputSchema.parse({ operationId: "10000000-0000-4000-8000-000000000001" }))
      .toEqual({ operationId: "10000000-0000-4000-8000-000000000001" });
    expect(PaidHandRevealInputSchema.safeParse({
      operationId: "10000000-0000-4000-8000-000000000001",
      targetUserId: "player-b",
    }).success).toBe(false);
  });

  it("types a persisted hypothetical runout without exposing excluded cards", () => {
    const input = HypotheticalRunoutInputSchema.parse({ operationId: "10000000-0000-4000-8000-000000000001" });
    expect(input.operationId).toBeTruthy();
    const result = HypotheticalRunoutResultSchema.parse({
      actualBoard: ["2c", "3d", "4h"],
      cards: ["5s", "6c"],
      createdAt: "2026-08-24T00:00:00.000Z",
      generationSource: "ORIGINAL_REMAINING_DECK",
      handId: "10000000-0000-4000-8000-000000000002",
      simulatedBoard: ["2c", "3d", "4h", "5s", "6c"],
    });
    expect(result).not.toHaveProperty("remainingDeck");
    expect(result).not.toHaveProperty("holeCards");
  });

  it("orders history date bounds by their instants instead of ISO offset text", () => {
    expect(HandHistoryQuerySchema.safeParse({
      finishedFrom: "2025-12-31T23:00:00-12:00",
      finishedTo: "2026-01-01T00:00:00+14:00",
    }).success).toBe(false);
    expect(HandHistoryQuerySchema.safeParse({
      finishedFrom: "2026-01-01T00:00:00+14:00",
      finishedTo: "2025-12-31T23:00:00-12:00",
    }).success).toBe(true);
  });

  it("exposes stable public history and reveal error codes", () => {
    for (const code of ["HAND_NOT_FOUND", "REPLAY_NOT_AVAILABLE", "INSUFFICIENT_WALLET_BALANCE", "IDEMPOTENCY_CONFLICT"] as const) {
      expect(HistoryErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("accepts nine hidden opponents for a spectator at a full table", () => {
    expect(HandSummarySchema.parse({
      board: ["As", "Kd", "Qc", "Jh", "Ts"],
      displayHandNumber: "98",
      finishReason: "SHOWDOWN",
      finishedAt: "2026-08-30T14:35:33.000Z",
      handId: "10000000-0000-4000-8000-000000000098",
      handNumber: 98,
      runoutIndex: null,
      hiddenOpponentCount: 9,
      netResult: null,
      ownHoleCards: null,
      paidCardRevealCost: 10,
      paidCardRevealEnabled: true,
      room: { roomCode: "606076", roomId: "room-full", roomName: "九人测试桌" },
      seatIndex: null,
      splitPot: false,
      startingStack: null,
      endingStack: null,
      viewerParticipated: false,
      wonAnyPot: null,
    }).hiddenOpponentCount).toBe(9);
    expect(PaidHandRevealResultSchema.parse({
      alreadyOwned: false,
      cost: 10,
      operationId: "10000000-0000-4000-8000-000000000099",
      paidHandRevealPurchaseId: "purchase-full-table",
      revealedPlayerCount: 9,
      walletBalance: 990,
    }).revealedPlayerCount).toBe(9);
  });
});
