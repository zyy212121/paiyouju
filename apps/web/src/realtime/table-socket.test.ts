import type {
  CommandAcknowledgementCallback,
  CommandDataByEvent,
  CommandEventName,
  CommandPayloadByEvent,
} from "@paiyouju/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandAckClient,
  RealtimeClientError,
  TABLE_SOCKET_RECONNECTION_POLICY,
  type CommandTransport,
} from "./table-socket.js";

function transport(): CommandTransport & {
  readonly callbacks: Partial<{ [E in CommandEventName]: CommandAcknowledgementCallback<E> }>;
  connected: boolean;
} {
  const callbacks: Partial<{ [E in CommandEventName]: CommandAcknowledgementCallback<E> }> = {};
  return {
    callbacks,
    connected: true,
    emitters: {
      "action:submit": (_payload, callback) => { callbacks["action:submit"] = callback; },
      "hand:arm-next-action-autopilot": (_payload, callback) => { callbacks["hand:arm-next-action-autopilot"] = callback; },
      "hand:cancel-next-action-autopilot": (_payload, callback) => { callbacks["hand:cancel-next-action-autopilot"] = callback; },
      "hand:buy-time-extension": (_payload, callback) => { callbacks["hand:buy-time-extension"] = callback; },
      "hand:choose-runout-count": (_payload, callback) => { callbacks["hand:choose-runout-count"] = callback; },
      "hand:reveal-own-cards": (_payload, callback) => { callbacks["hand:reveal-own-cards"] = callback; },
      "room:chat-send": (_payload, callback) => { callbacks["room:chat-send"] = callback; },
      "seat:leave": (_payload, callback) => { callbacks["seat:leave"] = callback; },
      "seat:reserve-away": (_payload, callback) => { callbacks["seat:reserve-away"] = callback; },
      "seat:set-trusteeship": (_payload, callback) => { callbacks["seat:set-trusteeship"] = callback; },
      "seat:return": (_payload, callback) => { callbacks["seat:return"] = callback; },
      "seat:sit-out": (_payload, callback) => { callbacks["seat:sit-out"] = callback; },
      "seat:take": (_payload, callback) => { callbacks["seat:take"] = callback; },
      "stack:buy-in": (_payload, callback) => { callbacks["stack:buy-in"] = callback; },
      "table:request-state": (_payload, callback) => { callbacks["table:request-state"] = callback; },
      "table:start": (_payload, callback) => { callbacks["table:start"] = callback; },
      "table:subscribe": (_payload, callback) => { callbacks["table:subscribe"] = callback; },
    },
  };
}

const operation = {
  expectedStateVersion: 1,
  operationId: "11111111-1111-4111-8111-111111111111",
  roomId: "room-1",
} as const;

function expectClientError(error: Error, code: RealtimeClientError["code"]): void {
  expect(error).toBeInstanceOf(RealtimeClientError);
  expect((error as RealtimeClientError).code).toBe(code);
}

describe("typed command acknowledgement client", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects immediately while disconnected without registering work", async () => {
    const fake = transport();
    fake.connected = false;
    const client = new CommandAckClient(fake);
    await expect(client.emit("seat:return", operation)).rejects.toSatisfy((error: Error) => {
      expectClientError(error, "REALTIME_DISCONNECTED");
      return true;
    });
    expect(client.pendingCount).toBe(0);
  });

  it("rejects every pending command on disconnect and ignores later acknowledgements", async () => {
    const fake = transport();
    const client = new CommandAckClient(fake);
    const pending = client.emit("seat:return", operation);
    client.rejectDisconnected();
    await expect(pending).rejects.toSatisfy((error: Error) => {
      expectClientError(error, "REALTIME_DISCONNECTED");
      return true;
    });
    expect(client.pendingCount).toBe(0);
    fake.callbacks["seat:return"]?.({
      data: { gameSessionId: "session-1", playStatus: "ACTIVE", roomId: "room-1", seatId: "seat-1", seatIndex: 0, stack: 400, version: 1, walletBalance: 600 },
      ok: true,
      requestId: operation.operationId,
      stateVersion: 2,
    });
    expect(client.pendingCount).toBe(0);
  });

  it("times out once, clears its timer, and never leaves a hanging promise", async () => {
    vi.useFakeTimers();
    const fake = transport();
    const client = new CommandAckClient(fake);
    const pending = client.emit("seat:return", operation, { timeoutMs: 10_000 });
    const observed = pending.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(observed).resolves.toSatisfy((error: Error) => {
      expectClientError(error, "REALTIME_TIMEOUT");
      return true;
    });
    expect(client.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves typed server rejection details under a stable client code", async () => {
    const fake = transport();
    const client = new CommandAckClient(fake);
    const pending = client.emit("seat:return", operation);
    fake.callbacks["seat:return"]?.({
      error: { code: "PLAYER_NOT_SEATED", message: "你尚未入座" },
      ok: false,
      requestId: operation.operationId,
      stateVersion: 2,
    });
    await expect(pending).rejects.toSatisfy((error: Error) => {
      expectClientError(error, "REALTIME_COMMAND_REJECTED");
      const clientError = error as RealtimeClientError;
      expect(clientError.serverError).toMatchObject({ code: "PLAYER_NOT_SEATED", requestId: operation.operationId, stateVersion: 2 });
      return true;
    });
    expect(client.pendingCount).toBe(0);
  });

  it("returns event-specific data without a loose payload assertion", async () => {
    const fake = transport();
    const client = new CommandAckClient(fake);
    const pending: Promise<CommandDataByEvent["seat:take"]> = client.emit("seat:take", { ...operation, buyInAmount: 400, seatIndex: 0 });
    fake.callbacks["seat:take"]?.({
      data: { gameSessionId: "session-1", playStatus: "ACTIVE", roomId: "room-1", seatId: "seat-1", seatIndex: 0, stack: 400, version: 1, walletBalance: 600 },
      ok: true,
      requestId: operation.operationId,
      stateVersion: 2,
    });
    await expect(pending).resolves.toMatchObject({ seatIndex: 0, stack: 400 });
  });
});

describe("table socket reconnection policy", () => {
  it("uses a jittered exponential delay below the authenticated user handshake limit", () => {
    expect(TABLE_SOCKET_RECONNECTION_POLICY).toEqual({
      randomizationFactor: 0.5,
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 10_000,
    });
  });
});

// Compile-time correlation guards kept outside runtime assertions.
const _payloadGuard: CommandPayloadByEvent["seat:return"] = operation;
void _payloadGuard;
