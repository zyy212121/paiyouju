import { describe, expect, it } from "vitest";

import { readFile } from "node:fs/promises";

import {
  ActionSubmitSchema,
  BuyInCommandSchema,
  CommandAcknowledgementSchemas,
  NextActionAutopilotSchema,
  PROTOCOL_VERSION,
  RevealOwnCardsSchema,
  ReserveAwaySchema,
  RealtimeErrorSchema,
  RealtimeErrorCodeSchema,
  SeatTakeSchema,
  SeatLeaveSchema,
  TableEventSchema,
  TableStateProjectionSchema,
  TableStartSchema,
  TableSubscribeSchema,
  TrusteeshipSetSchema,
} from "./realtime.js";
import {
  ROOM_CHAT_MAX_GRAPHEMES,
  RoomChatHistorySchema,
  RoomChatMessageSchema,
  RoomChatSendSchema,
  countRoomChatGraphemes,
} from "./room-chat.js";

const operationId = "11111111-1111-4111-8111-111111111111";

describe("realtime protocol schemas", () => {
  it("accepts native emoji chat, normalizes whitespace and rejects messages beyond 120 graphemes", () => {
    const clientMessageId = "22222222-2222-4222-8222-222222222222";
    expect(RoomChatSendSchema.parse({ clientMessageId, content: "  大家好  👨‍👩‍👧‍👦  ", roomId: "room-1" })).toEqual({
      clientMessageId,
      content: "大家好 👨‍👩‍👧‍👦",
      roomId: "room-1",
    });
    expect(countRoomChatGraphemes("👨‍👩‍👧‍👦")).toBe(1);
    expect(RoomChatSendSchema.safeParse({ clientMessageId, content: "好".repeat(ROOM_CHAT_MAX_GRAPHEMES), roomId: "room-1" }).success).toBe(true);
    expect(RoomChatSendSchema.safeParse({ clientMessageId, content: "好".repeat(ROOM_CHAT_MAX_GRAPHEMES + 1), roomId: "room-1" }).success).toBe(false);
    expect(RoomChatSendSchema.safeParse({ clientMessageId, content: " \n\t ", roomId: "room-1" }).success).toBe(false);
    expect(RoomChatSendSchema.safeParse({ clientMessageId, content: "隐藏\u0000控制符", roomId: "room-1" }).success).toBe(false);
    expect(RoomChatSendSchema.safeParse({ clientMessageId, content: "伪装\u202E文本", roomId: "room-1" }).success).toBe(false);
  });

  it("strictly validates room chat messages and bounded history", () => {
    const message = {
      content: "开牌啦 🔥",
      createdAt: "2026-08-29T12:00:00.000Z",
      id: "33333333-3333-4333-8333-333333333333",
      roomId: "room-1",
      sender: { nickname: "Alice", seatIndex: 0, userId: "user-a" },
    };
    expect(RoomChatMessageSchema.parse(message)).toEqual(message);
    expect(RoomChatHistorySchema.parse({ messages: [message], roomId: "room-1" })).toEqual({ messages: [message], roomId: "room-1" });
    expect(() => RoomChatMessageSchema.parse({ ...message, html: "<script>" })).toThrow();
  });

  it("uses protocol version seven and strict server-authority payloads", () => {
    expect(PROTOCOL_VERSION).toBe(9);
    expect(TableSubscribeSchema.parse({ roomId: "room-1" })).toEqual({ roomId: "room-1" });
    expect(SeatTakeSchema.parse({ buyInAmount: 400, expectedStateVersion: 0, operationId, roomId: "room-1", seatIndex: 0 })).toMatchObject({ seatIndex: 0 });
    expect(BuyInCommandSchema.parse({ amount: 100, expectedStateVersion: 1, operationId, roomId: "room-1" })).toMatchObject({ amount: 100 });
    expect(TableStartSchema.parse({ expectedStateVersion: 1, operationId, roomId: "room-1" })).toMatchObject({ roomId: "room-1" });
    expect(NextActionAutopilotSchema.parse({ expectedStateVersion: 1, mode: "CHECK_OR_FOLD", operationId, roomId: "room-1" })).toMatchObject({ mode: "CHECK_OR_FOLD", operationId });
    expect(NextActionAutopilotSchema.parse({ expectedStateVersion: 1, mode: "CALL", operationId, roomId: "room-1" })).toMatchObject({ mode: "CALL", operationId });
    expect(() => NextActionAutopilotSchema.parse({ expectedStateVersion: 1, operationId, roomId: "room-1" })).toThrow();
    expect(ReserveAwaySchema.parse({ expectedStateVersion: 1, operationId, roomId: "room-1" })).toMatchObject({ operationId });
    expect(SeatLeaveSchema.parse({ confirmSquidPenalty: true, expectedStateVersion: 1, operationId, roomId: "room-1" })).toMatchObject({ confirmSquidPenalty: true });
    expect(TrusteeshipSetSchema.parse({ enabled: true, expectedStateVersion: 1, operationId, roomId: "room-1" })).toMatchObject({ enabled: true });
    expect(RevealOwnCardsSchema.parse({ cardIndex: 0, expectedStateVersion: 1, handId: operationId, operationId, roomId: "room-1" })).toMatchObject({ cardIndex: 0, handId: operationId });
    expect(() => RevealOwnCardsSchema.parse({ expectedStateVersion: 1, handId: operationId, operationId, roomId: "room-1" })).toThrow();
    expect(() => RevealOwnCardsSchema.parse({ cardIndex: 2, expectedStateVersion: 1, handId: operationId, operationId, roomId: "room-1" })).toThrow();
    expect(() => TableSubscribeSchema.parse({ roomId: "room-1", userId: "spoofed" })).toThrow();
    expect(() => SeatTakeSchema.parse({ buyInAmount: 400, expectedStateVersion: 0, operationId, roomId: "room-1", seatIndex: 0, stack: 999_999 })).toThrow();
  });

  it("keeps protocol v8 while defining typed transport-security errors", () => {
    expect(PROTOCOL_VERSION).toBe(9);
    for (const code of ["UNKNOWN_EVENT", "PAYLOAD_TOO_LARGE", "RATE_LIMITED"] as const) {
      expect(RealtimeErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("accepts only intent actions with raise-to total semantics", () => {
    const base = { clientActionId: operationId, expectedStateVersion: 4, handId: operationId, roomId: "room-1" };
    expect(ActionSubmitSchema.parse({ ...base, action: { type: "raiseTo", raiseTo: 120 } }).action).toEqual({ type: "raiseTo", raiseTo: 120 });
    expect(ActionSubmitSchema.parse({ ...base, action: { type: "fold" } }).action).toEqual({ type: "fold" });
    expect(() => ActionSubmitSchema.parse({ ...base, action: { type: "raise", amount: 120 } })).toThrow();
    expect(() => ActionSubmitSchema.parse({ ...base, action: { type: "call", winner: "alice" } })).toThrow();
  });

  it("round-trips strict projected state, events, errors, and typed acknowledgements", () => {
    const state = {
      hand: null,
      bustedRebuyRequired: false,
      canOwnerStart: false,
      canRevealOwnCards: false,
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
      room: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        durationMinutes: 60,
        expiresAt: "2026-01-01T01:00:00.000Z",
        initialBuyIn: 400,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "协议测试",
        nextHandPaused: false,
        pointFeeRates: { actionTimeExtension: 10, handEntry: 10, hypotheticalRunout: 10, paidHandReveal: 50 },
        requiresManualStart: true,
        runItTwiceEnabled: false,
        roomCode: "123456",
        roomId: "room-1",
        smallBlind: 10,
        specialMode: "NORMAL",
        status: "OPEN",
        squidRoundGraceEndsAt: null,
        squidRoundNumber: 1,
        squidStake: null,
        tableStartedAt: null,
      },
      runtimeStatus: "IDLE",
      seats: [],
      startCountdownAt: null,
      stateVersion: 4,
      tableRunState: "WAITING_FOR_OWNER",
      trusteeshipEnabled: false,
    } as const;
    expect(TableStateProjectionSchema.parse(state)).toEqual(state);
    expect(TableEventSchema.parse({
      event: { amount: 20, eventType: "BLIND_POSTED", playerId: "alice", seatIndex: 0, stateVersion: 1 },
      roomId: "room-1",
      stateVersion: 4,
      type: "HAND_EVENT",
    })).toMatchObject({ type: "HAND_EVENT" });
    expect(RealtimeErrorSchema.parse({ code: "STALE_STATE", latestState: state, message: "状态已更新", requestId: operationId, stateVersion: 4 })).toMatchObject({ code: "STALE_STATE" });

    expect(CommandAcknowledgementSchemas["table:subscribe"].parse({
      data: state,
      ok: true,
      requestId: operationId,
      stateVersion: 4,
    })).toMatchObject({ ok: true, stateVersion: 4 });
    expect(CommandAcknowledgementSchemas["action:submit"].parse({
      error: { code: "ILLEGAL_ACTION", message: "不可行动" },
      latestState: state,
      ok: false,
      requestId: operationId,
      stateVersion: 4,
    })).toMatchObject({ ok: false });
  });

  it("rejects malformed outbound payloads and accidental private or loose fields", () => {
    expect(() => TableEventSchema.parse({ roomId: "room-1", stateVersion: 1, type: "HAND_EVENT", value: { arbitrary: true } })).toThrow();
    expect(() => RealtimeErrorSchema.parse({ code: "STALE_STATE", deck: ["As"], message: "bad", requestId: operationId })).toThrow();
    expect(() => CommandAcknowledgementSchemas["seat:take"].parse({ data: { stack: 400 }, ok: true, requestId: operationId, stateVersion: 1 })).toThrow();
  });

  it("contains no loose core-protocol unknown escape hatch", async () => {
    const source = await readFile(new URL("./realtime.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bunknown\b/);
    expect(source).not.toMatch(/\bas any\b/);
  });
});
