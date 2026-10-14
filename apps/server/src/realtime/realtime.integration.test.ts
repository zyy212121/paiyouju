import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "../db/client.js";
import { buildApp } from "../app.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../integration/database.js";
import { loadEnvironment } from "../config/environment.js";
import { attachRealtimeTransport, type RealtimeLogger } from "../realtime.js";
import { TableRuntimeManager } from "../modules/tables/runtime/table-runtime-manager.js";
import { FakeClockScheduler, FixedDeckProvider } from "../modules/tables/runtime/testing.js";
import { createTableAccountingService } from "../modules/tables/table-accounting.service.js";
import { createRoomLifecyclePersistence } from "../modules/tables/persistence/room-lifecycle-persistence.js";
import { ADMINISTRATOR_ROOM_LOG_DIRECTORY, administratorRoomLogFileName } from "../modules/tables/room-file-diagnostic-log.js";
import { createStandardDeck, serializeCard } from "@paiyouju/poker-core";
import type { RoomChatHistory, RoomChatMessage, TableStateProjection } from "@paiyouju/shared";

function connect(url: string, cookie?: string, origin = "http://localhost:5173") {
  return io(url, {
    autoConnect: false,
    extraHeaders: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    forceNew: true,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    socket.connect();
  });
}

function waitForProjectedState(socket: Socket, predicate: (state: TableStateProjection) => boolean): Promise<TableStateProjection> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("table:state", listener);
      reject(new Error("timed out waiting for projected table state"));
    }, 2_000);
    const listener = (state: TableStateProjection) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      socket.off("table:state", listener);
      resolve(state);
    };
    socket.on("table:state", listener);
  });
}

function waitForConnectError(socket: Socket): Promise<Error> {
  return new Promise((resolve) => {
    socket.once("connect_error", resolve);
    socket.connect();
  });
}

function waitForSocketEvent<T>(socket: Socket, eventName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`timed out waiting for ${eventName}`));
    }, 2_000);
    const listener = (value: T) => {
      clearTimeout(timeout);
      socket.off(eventName, listener);
      resolve(value);
    };
    socket.on(eventName, listener);
  });
}

function jsonStringValues(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStringValues);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(jsonStringValues);
  return [];
}

describe("authenticated realtime transport", () => {
  let database: DatabaseClient;
  const sockets: Socket[] = [];

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => { for (const socket of sockets) socket.disconnect(); await database.$disconnect(); });

  async function start(options: { readonly beforeSubscriptionAttach?: () => void | Promise<void>; readonly logger?: RealtimeLogger; readonly time?: FakeClockScheduler; readonly runtimes?: TableRuntimeManager } = {}) {
    const environment = loadEnvironment();
    const runtimes = options.runtimes ?? new TableRuntimeManager();
    const roomLifecycle = createRoomLifecyclePersistence(database, runtimes);
    const app = await buildApp({
      database,
      environment,
      onSessionRevoked: async (sessionId) => realtime.sessionControl.disconnectSession(sessionId),
      onRoomUpdating: roomLifecycle.onRoomUpdating,
      rateLimit: false,
      runtimes,
      runRoomMutation: roomLifecycle.runRoomMutation,
    });
    let handIndex = 0;
    const realtime = attachRealtimeTransport(app.server, {
      ...(options.beforeSubscriptionAttach ? { beforeSubscriptionAttach: options.beforeSubscriptionAttach } : {}),
      database,
      environment,
      ...(options.logger ? { logger: options.logger } : {}),
      runtimes,
      ...(options.time ? { clock: options.time, deckProvider: new FixedDeckProvider(createStandardDeck()), idFactory: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++handIndex).padStart(12, "0")}`, scheduler: options.time } : {}),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    return { app, realtime, url: `http://127.0.0.1:${address.port}` };
  }

  async function ownerStart(socket: Socket, runtime: NonNullable<ReturnType<TableRuntimeManager["get"]>>, roomId: string, operationId: string) {
    const result = await socket.emitWithAck("table:start", { expectedStateVersion: runtime.stateVersion, operationId, roomId });
    expect(result).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
    return result;
  }

  async function createSeatedTwoPlayerTable(roomCode: string, actionTimeSeconds = 15, expiresAt?: Date, administratorOwner = false, squid = false, runItTwice = false, bombPot = false, bombPotInitiallyDue = true) {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    if (administratorOwner) await database.user.update({ data: { role: "ADMIN" }, where: { id: alice.userId } });
    const room = await database.room.create({
      data: {
        actionTimeSeconds,
        bigBlind: 20,
        ...(bombPot ? {
          bombPotBlindMultiplier: 3,
          bombPotIntervalMinutes: 5,
          ...(bombPotInitiallyDue ? { bombPotNextAt: new Date("2026-01-01T00:00:00.000Z") } : {}),
        } : {}),
        ...(expiresAt ? { expiresAt, tableStartedAt: new Date("2026-01-01T00:00:00.000Z") } : {}),
        initialBuyIn: 400,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: `实时规则-${roomCode}`,
        ownerId: alice.userId,
        paidCardRevealCost: 10,
        paidCardRevealEnabled: true,
        runItTwiceEnabled: runItTwice,
        roomCode,
        smallBlind: 10,
        ...(bombPot ? { specialMode: "BOMB_POT" as const } : squid ? { specialMode: "SQUID" as const, squidStake: 4 } : {}),
      },
    });
    if (administratorOwner) {
      await rm(join(ADMINISTRATOR_ROOM_LOG_DIRECTORY, administratorRoomLogFileName(room.roomCode, room.id)), { force: true });
    }
    await database.roomMember.createMany({
      data: [
        { role: "OWNER", roomId: room.id, userId: alice.userId },
        { role: "MEMBER", roomId: room.id, userId: bob.userId },
      ],
    });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
    const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
    await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
    const runtime = runtimes.get(room.id)!;
    const aliceSeat = await aliceSocket.emitWithAck("seat:take", {
      buyInAmount: 400,
      expectedStateVersion: runtime.stateVersion,
      operationId: `${roomCode}00-0000-4000-8000-000000000001`,
      roomId: room.id,
      seatIndex: 0,
    });
    expect(aliceSeat).toMatchObject({ ok: true });
    const bobSeat = await bobSocket.emitWithAck("seat:take", {
      buyInAmount: 400,
      expectedStateVersion: runtime.stateVersion,
      operationId: `${roomCode}00-0000-4000-8000-000000000002`,
      roomId: room.id,
      seatIndex: 1,
    });
    expect(bobSeat).toMatchObject({ ok: true });
    return { alice, aliceSocket, bob, bobSocket, room, runtime, runtimes, server, time };
  }

  it("persists an idempotent two-player run-it-twice vote and both unique boards", async () => {
    const fixture = await createSeatedTwoPlayerTable("737373", 15, undefined, false, false, true);
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "73737300-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const first = fixture.runtime.currentHand!.state;
      const firstActor = first.players.find((player) => player.seatIndex === first.currentActorSeat)!;
      const firstSocket = firstActor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const firstAction = await firstSocket.emitWithAck("action:submit", {
        action: { type: "allIn" },
        clientActionId: "73737300-0000-4000-8000-000000000004",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: first.handId,
        roomId: fixture.room.id,
      });
      expect(firstAction).toMatchObject({ ok: true });
      const facing = fixture.runtime.currentHand!.state;
      const secondActor = facing.players.find((player) => player.seatIndex === facing.currentActorSeat)!;
      const secondSocket = secondActor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const secondAction = await secondSocket.emitWithAck("action:submit", {
        action: { type: "call" },
        clientActionId: "73737300-0000-4000-8000-000000000005",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: facing.handId,
        roomId: fixture.room.id,
      });
      expect(secondAction).toMatchObject({ ok: true });
      expect(fixture.runtime.currentHand?.state.status).toBe("runout_choice");

      const vote = fixture.runtime.currentHand!.runoutVote!;
      const socketByUser = new Map([
        [fixture.alice.userId, fixture.aliceSocket],
        [fixture.bob.userId, fixture.bobSocket],
      ]);
      const firstVoteInput = {
        choice: "TWICE",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: facing.handId,
        operationId: "73737300-0000-4000-8000-000000000006",
        roomId: fixture.room.id,
      } as const;
      const firstVote = await socketByUser.get(vote.eligibleUserIds[0])!.emitWithAck("hand:choose-runout-count", firstVoteInput);
      expect(firstVote).toMatchObject({ data: { alreadyProcessed: false, resolvedRunoutCount: null }, ok: true });
      const replayedVote = await socketByUser.get(vote.eligibleUserIds[0])!.emitWithAck("hand:choose-runout-count", firstVoteInput);
      expect(replayedVote).toMatchObject({ data: { alreadyProcessed: true, resolvedRunoutCount: null }, ok: true });
      const secondVote = await socketByUser.get(vote.eligibleUserIds[1])!.emitWithAck("hand:choose-runout-count", {
        choice: "TWICE",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: facing.handId,
        operationId: "73737300-0000-4000-8000-000000000007",
        roomId: fixture.room.id,
      });
      expect(secondVote).toMatchObject({ data: { alreadyProcessed: false, resolvedRunoutCount: 2 }, ok: true });
      expect(fixture.runtime.status).toBe("POST_HAND_REVIEW");

      const record = await database.handRecord.findUnique({
        include: { runouts: { include: { pots: true }, orderBy: { runoutIndex: "asc" } } },
        where: { id: facing.handId },
      });
      expect(record).toMatchObject({ runoutCount: 2 });
      expect(record?.runouts).toHaveLength(2);
      expect(record?.runouts.flatMap((runout) => runout.board)).toHaveLength(10);
      expect(new Set(record?.runouts.flatMap((runout) => runout.board)).size).toBe(10);
      expect(record?.runouts[0]?.pots.map((pot) => pot.amount)).toEqual(record?.runouts[1]?.pots.map((pot) => pot.amount));
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
    }
  });

  it("round-trips persistent trusteeship and preserves typed squid lifecycle errors", async () => {
    const fixture = await createSeatedTwoPlayerTable("303030", 15, undefined, false, true);
    try {
      const trusteeship = await fixture.aliceSocket.emitWithAck("seat:set-trusteeship", {
        enabled: true,
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "30303000-0000-4000-8000-000000000003",
        roomId: fixture.room.id,
      });
      expect(trusteeship).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      expect(fixture.runtime.seats.get(0)?.trusteeshipEnabled).toBe(true);

      const reserved = await fixture.aliceSocket.emitWithAck("seat:reserve-away", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "30303000-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      });
      expect(reserved).toMatchObject({ error: { code: "SQUID_RESERVED_AWAY_DISABLED" }, ok: false });

      const satOut = await fixture.aliceSocket.emitWithAck("seat:sit-out", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "30303000-0000-4000-8000-000000000005",
        roomId: fixture.room.id,
      });
      expect(satOut).toMatchObject({ error: { code: "SQUID_RESERVED_AWAY_DISABLED" }, ok: false });
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
    }
  });

  it("posts every mandatory bomb blind before trusteeship can choose an action", async () => {
    const fixture = await createSeatedTwoPlayerTable("303031", 15, undefined, false, false, false, true);
    try {
      const trusteeship = await fixture.bobSocket.emitWithAck("seat:set-trusteeship", {
        enabled: true,
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "30303100-0000-4000-8000-000000000003",
        roomId: fixture.room.id,
      });
      expect(trusteeship).toMatchObject({ ok: true });

      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "30303100-0000-4000-8000-000000000004");
      await fixture.time.advanceBy(5_000);

      const hand = fixture.runtime.currentHand?.state;
      expect(hand).toMatchObject({ bombPotBlind: 60, currentBet: 0, street: "flop" });
      expect(hand?.players.map((player) => ({
        committedThisHand: player.committedThisHand,
        committedThisStreet: player.committedThisStreet,
        stack: player.stack,
      }))).toEqual([
        { committedThisHand: 60, committedThisStreet: 0, stack: 340 },
        { committedThisHand: 60, committedThisStreet: 0, stack: 340 },
      ]);
      expect(hand?.actionHistory.filter((event) => event.eventType === "BLIND_POSTED")).toHaveLength(2);
      expect(fixture.runtime.seats.get(1)?.trusteeshipEnabled).toBe(true);
      expect(fixture.runtime.room.bombPotNextAt).toEqual(new Date("2026-01-01T00:05:05.000Z"));
      await expect(database.room.findUniqueOrThrow({ where: { id: fixture.room.id } })).resolves.toMatchObject({
        bombPotNextAt: new Date("2026-01-01T00:05:05.000Z"),
      });
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
    }
  });

  it("starts the bomb timer only when the owner starts the table and keeps the first hand ordinary", async () => {
    const fixture = await createSeatedTwoPlayerTable("303033", 15, undefined, false, false, false, true, false);
    try {
      expect(fixture.runtime.room.bombPotNextAt).toBeNull();

      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "30303300-0000-4000-8000-000000000003");
      expect(fixture.runtime.room.bombPotNextAt).toEqual(new Date("2026-01-01T00:05:00.000Z"));
      await fixture.time.advanceBy(5_000);

      const hand = fixture.runtime.currentHand?.state;
      expect(hand).toMatchObject({ currentBet: 20, street: "preflop" });
      expect(hand?.bombPotBlind).toBeUndefined();
      await expect(database.room.findUniqueOrThrow({ where: { id: fixture.room.id } })).resolves.toMatchObject({
        bombPotNextAt: new Date("2026-01-01T00:05:00.000Z"),
      });
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
    }
  });

  it("posts normal small and big blinds even while a player is in trusteeship", async () => {
    const fixture = await createSeatedTwoPlayerTable("303032");
    try {
      const trusteeship = await fixture.bobSocket.emitWithAck("seat:set-trusteeship", {
        enabled: true,
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "30303200-0000-4000-8000-000000000003",
        roomId: fixture.room.id,
      });
      expect(trusteeship).toMatchObject({ ok: true });

      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "30303200-0000-4000-8000-000000000004");
      await fixture.time.advanceBy(5_000);

      const hand = fixture.runtime.currentHand?.state;
      expect(hand).toMatchObject({ currentBet: 20, street: "preflop" });
      expect(hand?.bombPotBlind).toBeUndefined();
      expect(hand?.players.map((player) => player.committedThisHand).sort((left, right) => left - right)).toEqual([10, 20]);
      expect(hand?.actionHistory.filter((event) => event.eventType === "BLIND_POSTED").map((event) => event.amount).sort((left, right) => left! - right!)).toEqual([10, 20]);
      expect(fixture.runtime.seats.get(1)?.trusteeshipEnabled).toBe(true);
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
    }
  });

  it("charges each participant the fixed diamond hand-entry fee in the same committed start", async () => {
    const fixture = await createSeatedTwoPlayerTable("313131");
    try {
      const walletsBefore = await database.wallet.findMany({ orderBy: { userId: "asc" } });
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "31313100-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const handId = fixture.runtime.currentHand!.state.handId;
      const walletsAfter = await database.wallet.findMany({ orderBy: { userId: "asc" } });
      expect(walletsAfter.map((wallet) => wallet.balance)).toEqual(walletsBefore.map((wallet) => wallet.balance - 10));
      expect(await database.walletLedgerEntry.findMany({
        orderBy: { userId: "asc" },
        where: { relatedRoomId: fixture.room.id, type: "HAND_ENTRY_FEE" },
      })).toEqual(expect.arrayContaining([
        expect.objectContaining({ metadata: { handId }, relatedHandId: null, signedAmount: -10 }),
        expect.objectContaining({ metadata: { handId }, relatedHandId: null, signedAmount: -10 }),
      ]));
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("writes administrator-room table diagnostics without persisting private room chat", async () => {
    const fixture = await createSeatedTwoPlayerTable("313132", 15, undefined, true);
    const logPath = join(ADMINISTRATOR_ROOM_LOG_DIRECTORY, administratorRoomLogFileName(fixture.room.roomCode, fixture.room.id));
    try {
      const chat = await fixture.aliceSocket.emitWithAck("room:chat-send", {
        clientMessageId: "31313200-0000-4000-8000-000000000003",
        content: "这条聊天不应进入诊断日志 🔒",
        roomId: fixture.room.id,
      });
      expect(chat).toMatchObject({ ok: true });
      await vi.waitFor(async () => {
        const raw = await readFile(logPath, "utf8");
        const entries = raw.trim().split("\n").map((line) => JSON.parse(line) as { eventName?: string; kind: string });
        expect(entries.filter((entry) => entry.kind === "COMMAND" && entry.eventName === "seat:take")).toHaveLength(2);
        expect(entries.some((entry) => entry.kind === "SNAPSHOT")).toBe(true);
        expect(entries.some((entry) => entry.eventName === "room:chat-send")).toBe(false);
        expect(raw).not.toContain("这条聊天不应进入诊断日志");
      });
    } finally {
      await fixture.server.realtime.shutdown();
      await fixture.server.app.close();
      await rm(logPath, { force: true });
    }
  });

  it("clears the countdown instead of freezing when a participant cannot pay the hand-entry diamonds", async () => {
    const fixture = await createSeatedTwoPlayerTable("323232");
    try {
      // Simulate an account whose remaining diamonds were consumed elsewhere
      // after the player bought into this table but before the hand committed.
      await database.wallet.update({ data: { balance: 0 }, where: { userId: fixture.bob.userId } });
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "32323200-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);

      expect(fixture.runtime.currentHand).toBeNull();
      expect(fixture.runtime.status).toBe("IDLE");
      expect(fixture.runtime.startCountdownAt).toBeNull();
      expect(await database.walletLedgerEntry.count({
        where: { relatedRoomId: fixture.room.id, type: "HAND_ENTRY_FEE" },
      })).toBe(0);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("rejects missing, expired, and wrong-origin sessions with stable safe errors", async () => {
    const server = await start();
    try {
      const missing = connect(server.url); sockets.push(missing);
      expect((await waitForConnectError(missing)).message).toBe("SOCKET_AUTH_REQUIRED");
      const expired = await createTestIdentity(database, "expired", 10_000);
      await database.userSession.updateMany({ data: { expiresAt: new Date("2000-01-01") }, where: { userId: expired.userId } });
      const expiredSocket = connect(server.url, expired.cookie); sockets.push(expiredSocket);
      expect((await waitForConnectError(expiredSocket)).message).toBe("SOCKET_AUTH_REQUIRED");
      const valid = await createTestIdentity(database, "valid", 10_000);
      const wrongOrigin = connect(server.url, valid.cookie, "https://evil.example"); sockets.push(wrongOrigin);
      expect((await waitForConnectError(wrongOrigin)).message).toBe("ROOM_ACCESS_DENIED");
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("limits sockets per current database user and releases capacity on disconnect", async () => {
    const identity = await createTestIdentity(database, "socket-limit-user", 10_000);
    const server = await start();
    try {
      const opened: Socket[] = [];
      for (let index = 0; index < 5; index += 1) {
        const socket = connect(server.url, identity.cookie);
        sockets.push(socket);
        opened.push(socket);
        await waitForConnect(socket);
      }
      const sixth = connect(server.url, identity.cookie); sockets.push(sixth);
      expect((await waitForConnectError(sixth)).message).toBe("SOCKET_LIMIT_REACHED");

      opened[0]?.disconnect();
      await vi.waitFor(() => expect(opened[0]?.connected).toBe(false));
      const replacement = connect(server.url, identity.cookie); sockets.push(replacement);
      await expect(waitForConnect(replacement)).resolves.toBeUndefined();
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("rate-limits repeated authenticated reconnects per user without blocking another user on the same IP", async () => {
    const firstIdentity = await createTestIdentity(database, "reconnect-limit-user", 10_000);
    const secondIdentity = await createTestIdentity(database, "reconnect-limit-neighbor", 10_000);
    const server = await start();
    try {
      for (let index = 0; index < 12; index += 1) {
        const socket = connect(server.url, firstIdentity.cookie); sockets.push(socket); await waitForConnect(socket);
        socket.disconnect();
        await vi.waitFor(() => expect(socket.connected).toBe(false));
      }
      const denied = connect(server.url, firstIdentity.cookie); sockets.push(denied);
      expect((await waitForConnectError(denied)).message).toBe("SOCKET_USER_CONNECTION_RATE_LIMITED");

      const neighbor = connect(server.url, secondIdentity.cookie); sockets.push(neighbor);
      await expect(waitForConnect(neighbor)).resolves.toBeUndefined();
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("cleans up simultaneous room disconnects without racing runtime eviction", async () => {
    const alice = await createTestIdentity(database, "disconnect-race-alice", 10_000);
    const bob = await createTestIdentity(database, "disconnect-race-bob", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 15,
        bigBlind: 20,
        initialBuyIn: 400,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "断线清理竞态",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "606064",
        smallBlind: 10,
      },
    });
    await database.roomMember.createMany({
      data: [
        { role: "OWNER", roomId: room.id, userId: alice.userId },
        { role: "MEMBER", roomId: room.id, userId: bob.userId },
      ],
    });
    const error = vi.fn();
    const runtimes = new TableRuntimeManager();
    const server = await start({ logger: { error, info: vi.fn() }, runtimes });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      expect(runtimes.get(room.id)?.hasPresence()).toBe(true);

      aliceSocket.disconnect();
      bobSocket.disconnect();

      await vi.waitFor(() => expect(runtimes.get(room.id)).toBeUndefined());
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(error).not.toHaveBeenCalledWith(
        expect.objectContaining({ roomId: room.id }),
        "socket disconnect cleanup failed",
      );
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("returns typed errors for unknown events and excessive command bursts", async () => {
    const identity = await createTestIdentity(database, "socket-command-guard", 10_000);
    const server = await start();
    try {
      const socket = connect(server.url, identity.cookie); sockets.push(socket); await waitForConnect(socket);
      const unknown = await socket.emitWithAck("security:unknown-event", { hidden: "value" });
      expect(unknown).toMatchObject({ error: { code: "UNKNOWN_EVENT" }, ok: false });

      let last: unknown;
      let firstLimitedAt: number | null = null;
      for (let index = 0; index <= 120; index += 1) {
        last = await socket.emitWithAck("table:subscribe", {});
        if (firstLimitedAt === null && (last as { readonly error?: { readonly code?: string } }).error?.code === "RATE_LIMITED") firstLimitedAt = index;
      }
      expect(firstLimitedAt).toBe(79);
      expect(last).toMatchObject({ error: { code: "RATE_LIMITED" }, ok: false });
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("rate-limits repeated seat lifecycle mutations across a user's concurrent sockets", async () => {
    const identity = await createTestIdentity(database, "socket-seat-guard", 10_000);
    const server = await start();
    try {
      const first = connect(server.url, identity.cookie); sockets.push(first); await waitForConnect(first);
      const second = connect(server.url, identity.cookie); sockets.push(second); await waitForConnect(second);
      const results = [];
      for (let index = 0; index < 7; index += 1) {
        results.push(await (index % 2 === 0 ? first : second).emitWithAck("seat:leave", {}));
      }
      expect(results.slice(0, 6).every((result) => result.error?.code === "INVALID_REQUEST")).toBe(true);
      expect(results[6]).toMatchObject({ error: { code: "RATE_LIMITED" }, ok: false });
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("rejects an oversized command with a typed acknowledgement before schema handling", async () => {
    const identity = await createTestIdentity(database, "socket-payload-guard", 10_000);
    const server = await start();
    try {
      const socket = connect(server.url, identity.cookie); sockets.push(socket); await waitForConnect(socket);
      const result = await socket.timeout(2_000).emitWithAck("table:subscribe", {
        padding: "x".repeat(65 * 1_024),
        roomId: "not-evaluated",
      });
      expect(result).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" }, ok: false });
      expect(socket.connected).toBe(true);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("disconnects a subscribed socket on HTTP logout without waiting for another command", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "主动登出", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505252", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const environment = loadEnvironment();
    const runtimes = new TableRuntimeManager();
    const app = await buildApp({
      database,
      environment,
      onSessionRevoked: async (sessionId) => realtime.sessionControl.disconnectSession(sessionId),
      rateLimit: false,
      runtimes,
    });
    const realtime = attachRealtimeTransport(app.server, { database, environment, runtimes });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    try {
      const socket = connect(`http://127.0.0.1:${address.port}`, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));

      const logout = await app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: "/api/auth/logout" });

      expect(logout.statusCode).toBe(200);
      await disconnected;
      await vi.waitFor(() => expect(runtimes.get(room.id)).toBeUndefined());
    } finally { await realtime.close(); await app.close(); }
  });

  it("allows members to subscribe and returns their authoritative projection", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const outsider = await createTestIdentity(database, "outsider", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "实时", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505050", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const server = await start();
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const memberResult = await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      expect(memberResult.data).toMatchObject({ protocolVersion: 9, recipient: { userId: alice.userId }, room: { roomId: room.id }, stateVersion: 0 });

      const outsiderSocket = connect(server.url, outsider.cookie); sockets.push(outsiderSocket); await waitForConnect(outsiderSocket);
      const denied = await outsiderSocket.emitWithAck("table:subscribe", { roomId: room.id });
      expect(denied.error).toMatchObject({ code: "ROOM_ACCESS_DENIED" });
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("broadcasts normalized emoji chat to room members, deduplicates retries and restores bounded history", async () => {
    const alice = await createTestIdentity(database, "chat-alice", 10_000);
    const bob = await createTestIdentity(database, "chat-bob", 10_000);
    const outsider = await createTestIdentity(database, "chat-outsider", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "聊天边界", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "515151", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [
      { role: "OWNER", roomId: room.id, userId: alice.userId },
      { role: "MEMBER", roomId: room.id, userId: bob.userId },
    ] });
    const server = await start();
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });

      const clientMessageId = "51515100-0000-4000-8000-000000000001";
      const aliceReceived = waitForSocketEvent<RoomChatMessage>(aliceSocket, "room:chat-message");
      const bobReceived = waitForSocketEvent<RoomChatMessage>(bobSocket, "room:chat-message");
      const sent = await aliceSocket.emitWithAck("room:chat-send", { clientMessageId, content: "  大家好  👨‍👩‍👧‍👦  ", roomId: room.id });
      expect(sent).toMatchObject({ data: { content: "大家好 👨‍👩‍👧‍👦", roomId: room.id, sender: { nickname: "chat-alice", seatIndex: null, userId: alice.userId } }, ok: true });
      await expect(aliceReceived).resolves.toMatchObject({ id: sent.data.id });
      await expect(bobReceived).resolves.toMatchObject({ id: sent.data.id });

      let duplicateBroadcasts = 0;
      const duplicateListener = () => { duplicateBroadcasts += 1; };
      bobSocket.on("room:chat-message", duplicateListener);
      const retried = await aliceSocket.emitWithAck("room:chat-send", { clientMessageId, content: "被重试内容忽略", roomId: room.id });
      await new Promise((resolve) => setTimeout(resolve, 25));
      bobSocket.off("room:chat-message", duplicateListener);
      expect(retried).toMatchObject({ data: { content: "大家好 👨‍👩‍👧‍👦", id: sent.data.id }, ok: true });
      expect(duplicateBroadcasts).toBe(0);

      const reconnect = connect(server.url, bob.cookie); sockets.push(reconnect); await waitForConnect(reconnect);
      const historyReceived = waitForSocketEvent<RoomChatHistory>(reconnect, "room:chat-history");
      await reconnect.emitWithAck("table:subscribe", { roomId: room.id });
      await expect(historyReceived).resolves.toMatchObject({ messages: [{ id: sent.data.id }], roomId: room.id });

      await database.roomMember.delete({ where: { roomId_userId: { roomId: room.id, userId: bob.userId } } });
      let removedMemberDeliveries = 0;
      const removedMemberListener = () => { removedMemberDeliveries += 1; };
      bobSocket.on("room:chat-message", removedMemberListener);
      reconnect.on("room:chat-message", removedMemberListener);
      const afterRemoval = await aliceSocket.emitWithAck("room:chat-send", { clientMessageId: "51515100-0000-4000-8000-000000000002", content: "成员移除后不可接收", roomId: room.id });
      expect(afterRemoval).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
      bobSocket.off("room:chat-message", removedMemberListener);
      reconnect.off("room:chat-message", removedMemberListener);
      expect(removedMemberDeliveries).toBe(0);

      const outsiderSocket = connect(server.url, outsider.cookie); sockets.push(outsiderSocket); await waitForConnect(outsiderSocket);
      const denied = await outsiderSocket.emitWithAck("room:chat-send", { clientMessageId: "51515100-0000-4000-8000-000000000002", content: "越权", roomId: room.id });
      expect(denied).toMatchObject({ error: { code: "ROOM_ACCESS_DENIED" }, ok: false });

      for (let index = 3; index <= 5; index += 1) {
        const result = await aliceSocket.emitWithAck("room:chat-send", { clientMessageId: `51515100-0000-4000-8000-${String(index).padStart(12, "0")}`, content: `消息 ${index}`, roomId: room.id });
        expect(result).toMatchObject({ ok: true });
      }
      const limited = await aliceSocket.emitWithAck("room:chat-send", { clientMessageId: "51515100-0000-4000-8000-000000000006", content: "过于频繁", roomId: room.id });
      expect(limited).toMatchObject({ error: { code: "RATE_LIMITED" }, ok: false });
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("requires the owner for the first start, then automatically resumes after players return", async () => {
    const fixture = await createSeatedTwoPlayerTable("525252");
    try {
      const onePlayerAttemptId = "52525200-0000-4000-8000-000000000003";
      await fixture.bobSocket.emitWithAck("seat:sit-out", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      });
      const onePlayer = await fixture.aliceSocket.emitWithAck("table:start", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: onePlayerAttemptId,
        roomId: fixture.room.id,
      });
      expect(onePlayer).toMatchObject({ error: { code: "TABLE_START_NOT_ALLOWED" }, ok: false });
      await fixture.bobSocket.emitWithAck("seat:return", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000005",
        roomId: fixture.room.id,
      });
      expect(fixture.runtime).toMatchObject({ currentHand: null, status: "IDLE" });
      expect(fixture.runtime.room.requiresManualStart).toBe(true);

      const nonOwner = await fixture.bobSocket.emitWithAck("table:start", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000006",
        roomId: fixture.room.id,
      });
      expect(nonOwner).toMatchObject({ error: { code: "ROOM_OWNER_REQUIRED" }, ok: false });

      const operationId = "52525200-0000-4000-8000-000000000007";
      const payload = { expectedStateVersion: fixture.runtime.stateVersion, operationId, roomId: fixture.room.id };
      const started = await fixture.aliceSocket.emitWithAck("table:start", payload);
      expect(started).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      expect(fixture.runtime.status).toBe("START_COUNTDOWN");
      const firstStartedAt = fixture.runtime.room.tableStartedAt?.toISOString();
      expect(firstStartedAt).toBe(fixture.time.now().toISOString());
      const firstExpiresAt = fixture.runtime.room.expiresAt.toISOString();
      expect(firstExpiresAt).toBe(new Date(fixture.time.now().getTime() + fixture.runtime.room.durationMinutes * 60_000).toISOString());

      const replay = await fixture.aliceSocket.emitWithAck("table:start", payload);
      expect(replay).toMatchObject({ data: { alreadyProcessed: true }, ok: true });
      const conflict = await fixture.aliceSocket.emitWithAck("table:start", {
        ...payload,
        expectedStateVersion: fixture.runtime.stateVersion,
      });
      expect(conflict).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" }, ok: false });
      const duplicateStart = await fixture.aliceSocket.emitWithAck("table:start", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000008",
        roomId: fixture.room.id,
      });
      expect(duplicateStart).toMatchObject({ error: { code: "TABLE_START_NOT_ALLOWED" }, ok: false });

      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "52525200-0000-4000-8000-000000000009",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      await fixture.bobSocket.emitWithAck("seat:sit-out", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000010",
        roomId: fixture.room.id,
      });
      await fixture.time.advanceBy(4_000);
      expect(fixture.runtime).toMatchObject({ currentHand: null, status: "IDLE" });
      expect(fixture.runtime.room).toMatchObject({ requiresManualStart: false, status: "OPEN" });
      expect(fixture.runtime.room.tableStartedAt?.toISOString()).toBe(firstStartedAt);
      expect(fixture.runtime.room.expiresAt.toISOString()).toBe(firstExpiresAt);

      await fixture.bobSocket.emitWithAck("seat:return", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "52525200-0000-4000-8000-000000000011",
        roomId: fixture.room.id,
      });
      expect(fixture.runtime.status).toBe("START_COUNTDOWN");
      await fixture.time.advanceBy(5_000);
      expect(fixture.runtime.status).toBe("PLAYING");
      expect(fixture.runtime.room.tableStartedAt?.toISOString()).toBe(firstStartedAt);
      expect(fixture.runtime.room.expiresAt.toISOString()).toBe(firstExpiresAt);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("broadcasts reconnect presence to members who are already subscribed", async () => {
    const fixture = await createSeatedTwoPlayerTable("535353");
    try {
      const disconnectedState = waitForProjectedState(fixture.aliceSocket, (state) => state.seats.some((seat) => seat.userId === fixture.bob.userId && !seat.connected));
      fixture.bobSocket.disconnect();
      expect((await disconnectedState).seats.find((seat) => seat.userId === fixture.bob.userId)).toMatchObject({ connected: false });

      const connectedState = waitForProjectedState(fixture.aliceSocket, (state) => state.seats.some((seat) => seat.userId === fixture.bob.userId && seat.connected));
      const reconnected = connect(fixture.server.url, fixture.bob.cookie); sockets.push(reconnected);
      await waitForConnect(reconnected);
      const subscribed = await reconnected.emitWithAck("table:subscribe", { roomId: fixture.room.id });
      expect(subscribed).toMatchObject({ ok: true });
      expect((await connectedState).seats.find((seat) => seat.userId === fixture.bob.userId)).toMatchObject({ connected: true });
      reconnected.disconnect();
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("starts and continues with a disconnected seated player under check-or-fold trusteeship", async () => {
    const fixture = await createSeatedTwoPlayerTable("534353");
    try {
      const disconnectedState = waitForProjectedState(fixture.aliceSocket, (state) => state.seats.some((seat) => seat.userId === fixture.bob.userId && !seat.connected));
      fixture.bobSocket.disconnect();
      await disconnectedState;

      const started = await fixture.aliceSocket.emitWithAck("table:start", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "53435300-0000-4000-8000-000000000003",
        roomId: fixture.room.id,
      });
      expect(started).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      await fixture.time.advanceBy(5_000);

      const dealtHand = fixture.runtime.currentHand ?? fixture.runtime.lastCompletedHand;
      expect(dealtHand?.state.players.map((player) => player.playerId)).toContain(fixture.bob.userId);
      expect(fixture.runtime.seats.get(1)).toMatchObject({ playStatus: "ACTIVE", userId: fixture.bob.userId });
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("cancels one-shot autopilot before it fires and otherwise folds without paying", async () => {
    const fixture = await createSeatedTwoPlayerTable("535353");
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "53535300-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const actionsBefore = fixture.runtime.currentHand!.actions.length;

      const armed = await actorSocket.emitWithAck("hand:arm-next-action-autopilot", {
        expectedStateVersion: fixture.runtime.stateVersion,
        mode: "CHECK_OR_FOLD",
        operationId: "53535300-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      });
      expect(armed).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      expect([...fixture.runtime.seats.values()].find((seat) => seat.userId === actor.playerId)?.nextActionAutopilotArmed).toBe(true);
      const cancelled = await actorSocket.emitWithAck("hand:cancel-next-action-autopilot", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "53535300-0000-4000-8000-000000000005",
        roomId: fixture.room.id,
      });
      expect(cancelled).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      await fixture.time.advanceBy(0);
      expect(fixture.runtime.currentHand?.actions).toHaveLength(actionsBefore);
      expect(fixture.runtime.currentHand?.state.currentActorSeat).toBe(actor.seatIndex);

      await actorSocket.emitWithAck("hand:arm-next-action-autopilot", {
        expectedStateVersion: fixture.runtime.stateVersion,
        mode: "CHECK_OR_FOLD",
        operationId: "53535300-0000-4000-8000-000000000006",
        roomId: fixture.room.id,
      });
      await fixture.time.advanceBy(0);

      expect(fixture.runtime.status).toBe("POST_HAND_REVIEW");
      expect([...fixture.runtime.seats.values()].find((seat) => seat.userId === actor.playerId)?.nextActionAutopilotArmed).toBe(false);
      expect(await database.handActionRecord.findFirstOrThrow({ where: { handId: hand.handId, userId: actor.playerId } })).toMatchObject({
        actionType: "FOLD",
        amount: null,
        automatic: true,
        automaticReason: "NEXT_DECISION_AUTOPILOT",
        raiseTo: null,
      });
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("durably binds auto-call to the current bet, calls once, and clears the pre-action", async () => {
    const fixture = await createSeatedTwoPlayerTable("536363");
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "53636300-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;

      const armed = await actorSocket.emitWithAck("hand:arm-next-action-autopilot", {
        expectedStateVersion: fixture.runtime.stateVersion,
        mode: "CALL",
        operationId: "53636300-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      });
      expect(armed).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      expect([...fixture.runtime.seats.values()].find((seat) => seat.userId === actor.playerId)).toMatchObject({
        nextActionAutoCallCurrentBet: 20,
        nextActionAutopilotArmed: true,
      });

      await fixture.time.advanceBy(0);

      expect(fixture.runtime.currentHand?.actions.at(-1)).toMatchObject({
        actionType: "CALL",
        amount: 10,
        automatic: true,
        automaticReason: "NEXT_DECISION_AUTO_CALL",
      });
      expect(await database.tableSeat.findFirstOrThrow({ where: { roomId: fixture.room.id, userId: actor.playerId } })).toMatchObject({
        nextActionAutoCallCurrentBet: null,
        nextActionAutopilotArmed: false,
      });
      const projected = await actorSocket.emitWithAck("table:request-state", { roomId: fixture.room.id });
      expect(projected.data).toMatchObject({ nextActionAutopilot: null, nextActionAutopilotArmed: false });
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("uses reserved-away autopilot for the active actor without calling, betting, or raising", async () => {
    const fixture = await createSeatedTwoPlayerTable("545454");
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "54545400-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const reserved = await actorSocket.emitWithAck("seat:reserve-away", {
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "54545400-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      });
      expect(reserved).toMatchObject({ data: { playStatus: "RESERVED_AWAY" }, ok: true });
      expect(new Date(reserved.data.reservedAwayEndsAt ?? fixture.runtime.seats.get(actor.seatIndex)?.reservedAwayEndsAt).getTime()).toBe(fixture.time.now().getTime() + 60_000);

      await fixture.time.advanceBy(0);

      expect(fixture.runtime.status).toBe("POST_HAND_REVIEW");
      expect(await database.handActionRecord.findFirstOrThrow({ where: { handId: hand.handId, userId: actor.playerId } })).toMatchObject({
        actionType: "FOLD",
        amount: null,
        automatic: true,
        automaticReason: "RESERVED_AWAY",
        raiseTo: null,
      });
      expect(await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: fixture.room.id, userId: actor.playerId } } })).toMatchObject({ playStatus: "RESERVED_AWAY" });
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("restores a reserved-away deadline across restart and preserves the detached stack", async () => {
    const alice = await createTestIdentity(database, "reserve-recovery", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 45, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "保位恢复", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "555555", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const time = new FakeClockScheduler();
    const firstRuntimes = new TableRuntimeManager();
    const first = await start({ runtimes: firstRuntimes, time });
    const socket = connect(first.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
    await socket.emitWithAck("table:subscribe", { roomId: room.id });
    const runtime = firstRuntimes.get(room.id)!;
    const seated = await socket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "55555500-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    await socket.emitWithAck("seat:reserve-away", { expectedStateVersion: runtime.stateVersion, operationId: "55555500-0000-4000-8000-000000000002", roomId: room.id });
    await time.advanceBy(30_000);
    const returned = await socket.emitWithAck("seat:return", { expectedStateVersion: runtime.stateVersion, operationId: "55555500-0000-4000-8000-000000000003", roomId: room.id });
    expect(returned).toMatchObject({ data: { playStatus: "ACTIVE" }, ok: true });
    await socket.emitWithAck("seat:reserve-away", { expectedStateVersion: runtime.stateVersion, operationId: "55555500-0000-4000-8000-000000000004", roomId: room.id });
    const deadline = runtime.seats.get(0)?.reservedAwayEndsAt;
    expect(deadline?.getTime()).toBe(time.now().getTime() + 60_000);
    socket.disconnect();
    await first.realtime.shutdown(); await first.app.close();

    const recoveredRuntimes = new TableRuntimeManager();
    const recovered = await start({ runtimes: recoveredRuntimes, time });
    try {
      expect(await recovered.realtime.recoverTables()).toEqual({ degradedRooms: 0, recoveredRooms: 1 });
      expect(recoveredRuntimes.get(room.id)?.seats.get(0)).toMatchObject({ playStatus: "RESERVED_AWAY", stack: 400 });
      await time.advanceBy(59_999);
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(1);
      await time.advanceBy(1);
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
      expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 10_000 });
      expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: seated.data.gameSessionId, type: "CASH_OUT" } })).toBe(0);
      expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: seated.data.gameSessionId, type: "CASH_OUT" } })).toBe(0);
      expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.data.gameSessionId } })).toMatchObject({ detachedStack: 400, status: "ACTIVE", totalCashOut: 0 });
      await time.advanceBy(60_000);
      expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: seated.data.gameSessionId, type: "CASH_OUT" } })).toBe(0);
      expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: seated.data.gameSessionId, type: "CASH_OUT" } })).toBe(0);
    } finally { await recovered.realtime.shutdown(); await recovered.app.close(); }
  });

  it("marks an in-hand reserved seat leave-after-hand at expiry and releases it after settlement", async () => {
    const fixture = await createSeatedTwoPlayerTable("565656", 45);
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "56565600-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const away = hand.players.find((player) => player.playerId !== actor.playerId)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const awaySocket = away.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const awaySeat = [...fixture.runtime.seats.values()].find((seat) => seat.userId === away.playerId)!;
      await awaySocket.emitWithAck("seat:reserve-away", { expectedStateVersion: fixture.runtime.stateVersion, operationId: "56565600-0000-4000-8000-000000000004", roomId: fixture.room.id });

      // Advance the live hand one millisecond after reserving so the next actor's
      // action deadline is later than the reserved-away expiry being tested.
      await fixture.time.advanceBy(1);
      const continued = await actorSocket.emitWithAck("action:submit", {
        action: { type: "call" },
        clientActionId: "56565600-0000-4000-8000-000000000005",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      expect(continued).toMatchObject({ ok: true });
      await fixture.time.advanceBy(59_999);

      expect(fixture.runtime.currentHand?.state.status).toBe("active");
      expect([...fixture.runtime.seats.values()].find((seat) => seat.userId === away.playerId)).toMatchObject({ playStatus: "LEAVE_AFTER_HAND", reservedAwayEndsAt: null });
      expect(await database.tableSeat.findUniqueOrThrow({ where: { id: awaySeat.seatId } })).toMatchObject({ playStatus: "LEAVE_AFTER_HAND", reservedAwayEndsAt: null });
      await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "56565600-0000-4000-8000-000000000006",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      expect(await database.tableSeat.findUnique({ where: { id: awaySeat.seatId } })).toBeNull();
      expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: awaySeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
      await fixture.time.advanceBy(60_000);
      expect(await database.walletLedgerEntry.count({ where: { relatedGameSessionId: awaySeat.gameSessionId, type: "CASH_OUT" } })).toBe(0);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("toggles a private pending-show card during play and publishes it only when review begins", async () => {
    const fixture = await createSeatedTwoPlayerTable("575757");
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "57575700-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const observerSocket = actor.playerId === fixture.alice.userId ? fixture.bobSocket : fixture.aliceSocket;
      const deadlineBefore = fixture.runtime.currentHand?.turnDeadlineAt?.toISOString();
      const walletsBefore = await database.wallet.findMany({ orderBy: { userId: "asc" } });
      const operationId = "57575700-0000-4000-8000-000000000005";
      const payload = { cardIndex: 0 as const, expectedStateVersion: fixture.runtime.stateVersion, handId: hand.handId, operationId, roomId: fixture.room.id };

      const pending = await actorSocket.emitWithAck("hand:reveal-own-cards", payload);
      expect(pending).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      const replay = await actorSocket.emitWithAck("hand:reveal-own-cards", payload);
      expect(replay).toMatchObject({ data: { alreadyProcessed: true }, ok: true });
      const actorPlayingState = (await actorSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      const observerPlayingState = (await observerSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      const actorCards = actor.holeCards.map(serializeCard);
      expect(actorPlayingState.pendingShowCardIndices).toEqual([0]);
      expect(observerPlayingState.pendingShowCardIndices).toEqual([]);
      expect(observerPlayingState.hand?.publicHoleCardSlots?.[actor.playerId]).toBeUndefined();
      expect(jsonStringValues(observerPlayingState)).not.toContain(actorCards[0]);
      expect(fixture.runtime.currentHand?.turnDeadlineAt?.toISOString()).toBe(deadlineBefore);

      await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "57575700-0000-4000-8000-000000000004",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      const reviewEndsAt = fixture.runtime.postHandReview?.endsAt.toISOString();
      const firstObserverState = (await observerSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      expect(firstObserverState.hand?.publicHoleCardSlots?.[actor.playerId]).toEqual([actorCards[0], null]);
      expect(firstObserverState.hand?.publicHoleCards[actor.playerId]).toBeUndefined();
      expect(jsonStringValues(firstObserverState)).not.toContain(actorCards[1]);
      expect(firstObserverState.seats.find((seat) => seat.userId === actor.playerId)).toMatchObject({ voluntarilyRevealed: true, voluntarilyRevealedCardIndices: [0] });
      expect(firstObserverState.lastHandSummary?.voluntarilyRevealedUserIds).not.toContain(actor.playerId);
      expect(fixture.runtime.postHandReview?.endsAt.toISOString()).toBe(reviewEndsAt);
      expect(await database.handPlayerRecord.findUniqueOrThrow({ where: { handId_userId: { handId: hand.handId, userId: actor.playerId } } })).toMatchObject({
        holeCardsPublic: false,
        holeCardsPublicReason: "VOLUNTARY",
        voluntarilyRevealedCardIndices: [0],
      });

      const addedDuringReview = await actorSocket.emitWithAck("hand:reveal-own-cards", {
        cardIndex: 1,
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        operationId: "57575700-0000-4000-8000-000000000006",
        roomId: fixture.room.id,
      });
      expect(addedDuringReview).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      const fullyShown = (await observerSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      expect(fullyShown.hand?.publicHoleCards[actor.playerId]).toEqual(actorCards);
      expect(fullyShown.seats.find((seat) => seat.userId === actor.playerId)?.voluntarilyRevealedCardIndices).toEqual([0, 1]);
      const withdrawnDuringReview = await actorSocket.emitWithAck("hand:reveal-own-cards", {
        cardIndex: 0,
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        operationId: "57575700-0000-4000-8000-000000000007",
        roomId: fixture.room.id,
      });
      expect(withdrawnDuringReview).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      const withdrawnState = (await observerSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      expect(withdrawnState.hand?.publicHoleCardSlots?.[actor.playerId]).toEqual([null, actorCards[1]]);
      expect(await database.handPlayerRecord.findUniqueOrThrow({ where: { handId_userId: { handId: hand.handId, userId: actor.playerId } } })).toMatchObject({
        holeCardsPublic: false,
        holeCardsPublicReason: "VOLUNTARY",
        voluntarilyRevealedCardIndices: [1],
      });
      expect(await database.wallet.findMany({ orderBy: { userId: "asc" } })).toEqual(walletsBefore);
      expect(await database.walletLedgerEntry.count({ where: { relatedHandId: hand.handId, type: "PAID_CARD_REVEAL" } })).toBe(0);

      await fixture.time.advanceBy(4_001);
      await fixture.time.advanceBy(5_000);
      const nextState = (await actorSocket.emitWithAck("table:request-state", { roomId: fixture.room.id })).data as TableStateProjection;
      expect(nextState.pendingShowCardIndices).toEqual([]);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("charges an auditable rounded fee and extends only the current actor deadline by half the base time", async () => {
    const fixture = await createSeatedTwoPlayerTable("585858", 30);
    try {
      await ownerStart(fixture.aliceSocket, fixture.runtime, fixture.room.id, "58585800-0000-4000-8000-000000000003");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      const originalDeadline = fixture.runtime.currentHand!.turnDeadlineAt!;
      await fixture.time.advanceBy(27_100);
      const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: actor.playerId } });
      const payload = {
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        operationId: "58585800-0000-4000-8000-000000000004",
        roomId: fixture.room.id,
      };
      const extended = await actorSocket.emitWithAck("hand:buy-time-extension", payload);
      expect(extended).toMatchObject({ data: { alreadyProcessed: false, cost: 10, walletBalance: walletBefore.balance - 10 }, ok: true });
      expect(fixture.runtime.currentHand?.turnDeadlineAt?.getTime()).toBe(originalDeadline.getTime() + 15_000);
      const replay = await actorSocket.emitWithAck("hand:buy-time-extension", payload);
      expect(replay).toMatchObject({ data: { alreadyProcessed: true, cost: 10, walletBalance: walletBefore.balance - 10 }, ok: true });
      expect(await database.walletLedgerEntry.findFirst({
        where: { idempotencyKey: `action-time-extension:${payload.operationId}`, type: "ACTION_TIME_EXTENSION" },
      })).toMatchObject({ metadata: { addedSeconds: 15, handId: hand.handId }, relatedHandId: null, signedAmount: -10 });

      await database.wallet.update({ data: { balance: 0 }, where: { userId: actor.playerId } });
      await fixture.time.advanceBy(15_000);
      const insufficient = await actorSocket.emitWithAck("hand:buy-time-extension", {
        ...payload,
        expectedStateVersion: fixture.runtime.stateVersion,
        operationId: "58585800-0000-4000-8000-000000000005",
      });
      expect(insufficient).toMatchObject({ error: { code: "INSUFFICIENT_WALLET_BALANCE" }, ok: false });
      await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "58585800-0000-4000-8000-000000000006",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      expect(await database.walletLedgerEntry.count({
        where: { relatedHandId: hand.handId, type: "ACTION_TIME_EXTENSION" },
      })).toBe(1);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("moves an expired room into closing, finishes the current hand, and never deals another", async () => {
    const fixture = await createSeatedTwoPlayerTable("595959", 30, new Date("2026-01-01T00:00:12.000Z"));
    try {
      expect(fixture.runtime.status).toBe("START_COUNTDOWN");
      await fixture.time.advanceBy(5_000);
      const hand = fixture.runtime.currentHand!.state;
      await fixture.time.advanceBy(7_000);
      expect(fixture.runtime.room.status).toBe("CLOSING");
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
      const actorSocket = actor.playerId === fixture.alice.userId ? fixture.aliceSocket : fixture.bobSocket;
      await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "59595900-0000-4000-8000-000000000004",
        expectedStateVersion: fixture.runtime.stateVersion,
        handId: hand.handId,
        roomId: fixture.room.id,
      });
      await fixture.time.advanceBy(4_001);
      expect(fixture.runtime.room.status).toBe("CLOSED");
      expect(fixture.runtime.currentHand).toBeNull();
      expect(await database.handRecord.count({ where: { roomId: fixture.room.id } })).toBe(1);
      expect(await database.tableSeat.count({ where: { roomId: fixture.room.id } })).toBe(0);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("closes and cashes out an idle seated room when its room clock expires", async () => {
    const fixture = await createSeatedTwoPlayerTable("595958", 30, new Date("2026-01-01T00:00:02.000Z"));
    try {
      await fixture.time.advanceBy(2_001);
      expect(fixture.runtime.room.status).toBe("CLOSED");
      expect(fixture.runtime.seats.size).toBe(0);
      expect(await database.tableSeat.count({ where: { roomId: fixture.room.id } })).toBe(0);
      expect((await database.wallet.findMany({
        orderBy: { userId: "asc" },
        where: { userId: { in: [fixture.alice.userId, fixture.bob.userId] } },
      })).map((wallet) => wallet.balance)).toEqual([10_000, 10_000]);
    } finally { await fixture.server.realtime.shutdown(); await fixture.server.app.close(); }
  });

  it("uses the confirmed current nickname when an already-connected socket takes a seat", async () => {
    const alice = await createTestIdentity(database, "nickname-alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "昵称入座", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505153", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const updated = await server.app.inject({
        headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" },
        method: "PATCH",
        payload: { nickname: "连接后新昵称" },
        url: "/api/profile",
      });
      expect(updated.statusCode, updated.body).toBe(200);

      const seated = await socket.emitWithAck("seat:take", {
        buyInAmount: 400,
        expectedStateVersion: 0,
        operationId: "50515300-0000-4000-8000-000000000001",
        roomId: room.id,
        seatIndex: 0,
      });

      expect(seated).toMatchObject({ ok: true });
      expect(runtimes.get(room.id)?.seats.get(0)?.nickname).toBe("连接后新昵称");
      expect((await socket.emitWithAck("table:request-state", { roomId: room.id })).data.seats[0]).toMatchObject({ nickname: "连接后新昵称" });
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("rejects commands after the connected session is revoked or expires", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "会话撤销", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505151", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const server = await start();
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const authError = new Promise<{ readonly code: string }>((resolve) => socket.once("table:error", resolve));
      const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));
      await database.userSession.updateMany({ data: { revokedAt: new Date() }, where: { userId: alice.userId } });

      const denied = await socket.timeout(2_000).emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "50515100-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });

      expect(denied.error).toMatchObject({ code: "SOCKET_AUTH_REQUIRED" });
      await expect(authError).resolves.toMatchObject({ code: "SOCKET_AUTH_REQUIRED" });
      await disconnected;
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("disconnects a quiet subscribed socket when its session naturally expires", async () => {
    const time = new FakeClockScheduler();
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "会话过期", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505152", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    await database.userSession.updateMany({
      data: { expiresAt: new Date(time.now().getTime() + 1_000) },
      where: { userId: alice.userId },
    });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      expect(runtimes.get(room.id)?.isConnected(alice.userId)).toBe(true);
      const authError = new Promise<{ readonly code: string }>((resolve) => socket.once("table:error", resolve));
      const disconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));

      await time.advanceBy(1_000);

      await expect(authError).resolves.toMatchObject({ code: "SOCKET_AUTH_REQUIRED" });
      await disconnected;
      await vi.waitFor(() => expect(runtimes.get(room.id)).toBeUndefined());
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("does not leave ghost presence when logout interrupts subscription attachment", async () => {
    let releaseAttach!: () => void;
    let attachStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseAttach = resolve; });
    const started = new Promise<void>((resolve) => { attachStarted = resolve; });
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "订阅竞态", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "505153", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({
      beforeSubscriptionAttach: async () => {
        attachStarted();
        await release;
      },
      runtimes,
    });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      const pendingSubscribe = socket.timeout(2_000).emitWithAck("table:subscribe", { roomId: room.id }).catch(() => undefined);
      await started;

      const logout = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: "/api/auth/logout" });
      expect(logout.statusCode).toBe(200);
      releaseAttach();
      await pendingSubscribe;

      await vi.waitFor(() => expect(runtimes.get(room.id)?.isConnected(alice.userId)).toBe(false));
      expect(runtimes.get(room.id)?.hasPresence()).toBe(false);
    } finally { releaseAttach(); await server.realtime.close(); await server.app.close(); }
  });

  it("allows a sitting-out player who is not in the current hand to top up", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const carol = await createTestIdentity(database, "carol", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 3, minimumBuyIn: 400, name: "暂停追加", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "515151", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }, { role: "MEMBER", roomId: room.id, userId: carol.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      const carolSocket = connect(server.url, carol.cookie); sockets.push(carolSocket); await waitForConnect(carolSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await carolSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51000000-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await carolSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51000000-0000-4000-8000-000000000003", roomId: room.id, seatIndex: 2 });
      await carolSocket.emitWithAck("seat:sit-out", { expectedStateVersion: runtime.stateVersion, operationId: "51000000-0000-4000-8000-000000000004", roomId: room.id });
      await ownerStart(aliceSocket, runtime, room.id, "51000000-0000-4000-8000-000000000006");
      await time.advanceBy(5_000);

      expect(runtime.currentHand?.state.players.some((player) => player.playerId === carol.userId)).toBe(false);
      const toppedUp = await carolSocket.emitWithAck("stack:buy-in", { amount: 100, expectedStateVersion: runtime.stateVersion, operationId: "51000000-0000-4000-8000-000000000005", roomId: room.id });

      expect(toppedUp.error).toBeUndefined();
      expect(toppedUp.data).toMatchObject({ stack: 500, walletBalance: 10_000 });
      expect(runtime.currentHand?.state.status).toBe("active");
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it.each([6, 9].flatMap((maxSeats) => ["NORMAL", "SQUID", "SHORT_DECK", "BOMB_POT"].map((specialMode) => ({ maxSeats, specialMode: specialMode as "NORMAL" | "SQUID" | "SHORT_DECK" | "BOMB_POT" }))))(
    "stands an unfolded actor safely at a full $maxSeats-seat $specialMode table",
    async ({ maxSeats, specialMode }) => {
      const players = [];
      for (let index = 0; index < maxSeats; index += 1) players.push(await createTestIdentity(database, `stand-${index}`, 10_000));
      const room = await database.room.create({ data: {
        actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000,
        maxSeats, minimumBuyIn: 400, name: "站起回归", ownerId: players[0]!.userId,
        roomCode: "515153", smallBlind: 10, specialMode,
        ...(specialMode === "SQUID" ? { squidStake: 4 } : {}),
        ...(specialMode === "BOMB_POT" ? {
          bombPotBlindMultiplier: 2, bombPotIntervalMinutes: 1,
          // An already-started room whose next hand is due to be a bomb pot.
          bombPotNextAt: new Date("2025-12-31T23:59:00.000Z"), tableStartedAt: new Date("2025-12-31T23:58:00.000Z"),
        } : {}),
      } });
      await database.roomMember.createMany({ data: players.map((player, index) => ({ role: index === 0 ? "OWNER" : "MEMBER", roomId: room.id, userId: player.userId })) });
      const time = new FakeClockScheduler();
      const runtimes = new TableRuntimeManager();
      const server = await start({ runtimes, time });
      const clients: Socket[] = [];
      const errors: unknown[] = [];
      try {
        for (const [seatIndex, player] of players.entries()) {
          const socket = connect(server.url, player.cookie); sockets.push(socket); clients.push(socket);
          socket.on("table:error", (error: unknown) => errors.push(error));
          await waitForConnect(socket);
          await socket.emitWithAck("table:subscribe", { roomId: room.id });
          const seated = await socket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtimes.get(room.id)!.stateVersion, operationId: randomUUID(), roomId: room.id, seatIndex });
          expect(seated.ok).toBe(true);
        }
        const runtime = runtimes.get(room.id)!;
        if (specialMode !== "BOMB_POT") await ownerStart(clients[0]!, runtime, room.id, randomUUID());
        await time.advanceBy(specialMode === "SQUID" ? 10_000 : 5_000);
        expect(runtime.currentHand!.state.players).toHaveLength(maxSeats);
        if (specialMode === "BOMB_POT") expect(runtime.currentHand!.state).toMatchObject({ bombPotBlind: 40, street: "flop" });
        const actorIndex = runtime.currentHand!.state.currentActorSeat!;
        const actor = players[actorIndex]!;
        const beforeLeaveVersion = runtime.stateVersion;
        const rejected = await clients[actorIndex]!.emitWithAck("seat:leave", {
          confirmSquidPenalty: specialMode === "SQUID", expectedStateVersion: beforeLeaveVersion - 1,
          operationId: randomUUID(), roomId: room.id,
        });
        expect(rejected).toMatchObject({ ok: false, error: { code: "STALE_STATE" }, latestState: { stateVersion: beforeLeaveVersion } });
        expect(runtime.stateVersion).toBe(beforeLeaveVersion);
        expect(runtime.seats.get(actorIndex)?.playStatus).toBe("ACTIVE");
        expect(runtime.currentHand!.state.players.find((player) => player.playerId === actor.userId)!.hasFolded).toBe(false);
        const leaving = await clients[actorIndex]!.emitWithAck("seat:leave", {
          confirmSquidPenalty: specialMode === "SQUID", expectedStateVersion: runtime.stateVersion,
          operationId: randomUUID(), roomId: room.id,
        });
        expect(leaving).toMatchObject({ ok: true, data: { deferred: true, playStatus: "LEAVE_AFTER_HAND" } });
        await time.advanceBy(0);
        const leavingPlayer = runtime.currentHand!.state.players.find((player) => player.playerId === actor.userId)!;
        expect(leavingPlayer.hasFolded).toBe(specialMode !== "BOMB_POT");
        if (specialMode === "BOMB_POT") expect(leavingPlayer.committedThisHand).toBe(40);
        expect(runtime.seats.get(actorIndex)?.playStatus).toBe("LEAVE_AFTER_HAND");
        while (runtime.currentHand) {
          const hand = runtime.currentHand.state;
          const nextActor = hand.currentActorSeat!;
          const folded = await clients[nextActor]!.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: randomUUID(), expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: room.id });
          expect(folded.ok).toBe(true);
          await time.advanceBy(0);
        }
        expect(runtime.status).toBe("POST_HAND_REVIEW");
        expect(runtime.seats.has(actorIndex)).toBe(false);
        const state = (await clients[actorIndex]!.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
        expect(state.seats.some((seat) => seat.userId === actor.userId)).toBe(false);
        expect(state.hand?.legalActions ?? null).toBeNull();
        expect(errors).toEqual([]);
        const session = await database.gameSession.findFirstOrThrow({ where: { roomId: room.id, userId: actor.userId } });
        expect(session).toMatchObject({ status: "ACTIVE", detachedStack: specialMode === "SQUID" ? (maxSeats === 6 ? 380 : 368) : specialMode === "BOMB_POT" ? (maxSeats === 6 ? 600 : 720) : 400 });
      } finally { await server.realtime.close(); await server.app.close(); }
    },
  );

  it("defers an unmarked squid leave outside the active hand without changing hand-player stacks", async () => {
    const alice = await createTestIdentity(database, "squid-race-alice", 10_000);
    const bob = await createTestIdentity(database, "squid-race-bob", 10_000);
    const carol = await createTestIdentity(database, "squid-race-carol", 10_000);
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 15,
        bigBlind: 20,
        initialBuyIn: 400,
        maximumBuyIn: 2_000,
        maxSeats: 3,
        minimumBuyIn: 400,
        name: "鱿鱼离桌并发保护",
        ownerId: alice.userId,
        paidCardRevealCost: 0,
        roomCode: "515152",
        smallBlind: 10,
        specialMode: "SQUID",
        squidStake: 4,
      },
    });
    await database.roomMember.createMany({
      data: [
        { role: "OWNER", roomId: room.id, userId: alice.userId },
        { role: "MEMBER", roomId: room.id, userId: bob.userId },
        { role: "MEMBER", roomId: room.id, userId: carol.userId },
      ],
    });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      const carolSocket = connect(server.url, carol.cookie); sockets.push(carolSocket); await waitForConnect(carolSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await carolSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51515200-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51515200-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtime, room.id, "51515200-0000-4000-8000-000000000003");
      await time.advanceBy(10_000);

      const hand = runtime.currentHand!.state;
      expect(hand.players.map((player) => player.playerId)).not.toContain(carol.userId);
      const openingStacks = new Map(hand.players.map((player) => [player.playerId, player.startingStack]));
      const carolSeat = await carolSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "51515200-0000-4000-8000-000000000004", roomId: room.id, seatIndex: 2 });
      expect(carolSeat).toMatchObject({ data: { playStatus: "ACTIVE", stack: 400 }, ok: true });
      const left = await carolSocket.emitWithAck("seat:leave", {
        confirmSquidPenalty: true,
        expectedStateVersion: runtime.stateVersion,
        operationId: "51515200-0000-4000-8000-000000000005",
        roomId: room.id,
      });

      expect(left).toMatchObject({ data: { deferred: true, playStatus: "LEAVE_AFTER_HAND" }, ok: true });
      expect(await database.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).toBe(0);
      for (const [userId, startingStack] of openingStacks) {
        expect((await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: room.id, userId } } })).stack).toBe(startingStack);
      }

      const actor = runtime.currentHand!.state.players.find((player) => player.seatIndex === runtime.currentHand!.state.currentActorSeat)!;
      const actorSocket = actor.playerId === alice.userId ? aliceSocket : bobSocket;
      const folded = await actorSocket.emitWithAck("action:submit", {
        action: { type: "fold" },
        clientActionId: "51515200-0000-4000-8000-000000000006",
        expectedStateVersion: runtime.stateVersion,
        handId: hand.handId,
        roomId: room.id,
      });
      expect(folded).toMatchObject({ ok: true });
      expect(runtime.status).toBe("POST_HAND_REVIEW");
      expect(await database.handRecord.count({ where: { id: hand.handId } })).toBe(1);
      expect(await database.tableStackLedgerEntry.count({ where: { roomId: room.id, type: "SQUID_SETTLEMENT" } })).toBeGreaterThan(0);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("runs an authoritative two-player hand, keeps cards private, persists settlement, and reconnects", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const spectator = await createTestIdentity(database, "spectator", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "完整实时", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "606060", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }, { role: "MEMBER", roomId: room.id, userId: spectator.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      const spectatorSocket = connect(server.url, spectator.cookie); sockets.push(spectatorSocket); await waitForConnect(spectatorSocket);
      const first = await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const second = await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await spectatorSocket.emitWithAck("table:subscribe", { roomId: room.id });

      const aliceSeat = await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: first.data.stateVersion, operationId: "10000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      expect(aliceSeat.data).toMatchObject({ stack: 400, walletBalance: 10_000 });
      const bobSeat = await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: aliceSeat.data.version === 1 ? 1 : second.data.stateVersion, operationId: "10000000-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      expect(bobSeat.data).toMatchObject({ stack: 400, walletBalance: 10_000 });
      await ownerStart(aliceSocket, runtimes.get(room.id)!, room.id, "10000000-0000-4000-8000-000000000003");
      expect(runtimes.get(room.id)?.status).toBe("START_COUNTDOWN");
      await time.advanceBy(5_000);

      const aliceState = (await aliceSocket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
      const bobState = (await bobSocket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
      const spectatorState = (await spectatorSocket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
      expect(aliceState.hand?.ownHoleCards).toHaveLength(2);
      expect(bobState.hand?.ownHoleCards).toHaveLength(2);
      expect(spectatorState.hand?.ownHoleCards).toEqual([]);
      expect(JSON.stringify(aliceState)).not.toContain(JSON.stringify(bobState.hand!.ownHoleCards[0]));
      expect(JSON.stringify(bobState)).not.toContain(JSON.stringify(aliceState.hand!.ownHoleCards[0]));
      for (const state of [aliceState, bobState, spectatorState]) {
        expect(JSON.stringify(state)).not.toMatch(/remainingDeck|"deck"|futureBoard/i);
      }

      const actorState = aliceState.hand?.legalActions ? aliceState : bobState;
      const actorSocket = actorState.recipient.userId === alice.userId ? aliceSocket : bobSocket;
      const stale = await actorSocket.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: "20000000-0000-4000-8000-000000000001", expectedStateVersion: actorState.stateVersion - 1, handId: actorState.hand!.handId, roomId: room.id });
      expect(stale).toMatchObject({ error: { code: "STALE_STATE" }, latestState: { stateVersion: actorState.stateVersion } });
      const foldInput = { action: { type: "fold" as const }, clientActionId: "20000000-0000-4000-8000-000000000001", expectedStateVersion: actorState.stateVersion, handId: actorState.hand!.handId, roomId: room.id };
      const folded = await actorSocket.emitWithAck("action:submit", foldInput);
      const replay = await actorSocket.emitWithAck("action:submit", foldInput);
      expect(replay).toMatchObject({
        data: { ...folded.data, alreadyProcessed: true },
        ok: true,
        stateVersion: folded.stateVersion,
      });
      expect(await database.handRecord.count({ where: { roomId: room.id } })).toBe(1);
      expect(await database.tableStackLedgerEntry.count({ where: { handId: actorState.hand!.handId, type: "HAND_RESULT" } })).toBe(2);
      expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(29_980);
      expect((await database.tableSeat.aggregate({ _sum: { stack: true } }))._sum.stack).toBe(800);
      expect(runtimes.get(room.id)?.status).toBe("POST_HAND_REVIEW");
      await time.advanceBy(4_000);

      aliceSocket.disconnect();
      const reconnected = connect(server.url, alice.cookie); sockets.push(reconnected); await waitForConnect(reconnected);
      const restored = await reconnected.emitWithAck("table:subscribe", { roomId: room.id });
      expect(restored.data).toMatchObject({ recipient: { userId: alice.userId }, runtimeStatus: "PLAYING" });
      expect(restored.data.stateVersion).toBeGreaterThanOrEqual(folded.data.stateVersion);
      expect(await database.tableSeat.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(1);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("reloads the latest durable authority after a snapshot revision conflict", async () => {
    const alice = await createTestIdentity(database, "conflict-alice", 10_000);
    const bob = await createTestIdentity(database, "conflict-bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "快照冲突", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "606063", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60606300-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60606300-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtime, room.id, "60606300-0000-4000-8000-000000000004");
      await time.advanceBy(5_000);
      const hand = runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
      const actorSocket = actor === alice.userId ? aliceSocket : bobSocket;
      const input = { action: { type: "fold" as const }, clientActionId: "60606300-0000-4000-8000-000000000003", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: room.id };
      const previousRevision = runtime.snapshotRevision;
      await database.tableSnapshot.update({ data: { snapshotRevision: { increment: 1 } }, where: { roomId: room.id } });

      const conflict = await actorSocket.emitWithAck("action:submit", input);

      expect(conflict).toMatchObject({ error: { code: "SNAPSHOT_CONFLICT" }, latestState: { stateVersion: input.expectedStateVersion }, ok: false });
      expect(runtime).toMatchObject({ snapshotRevision: previousRevision + 1, stateVersion: input.expectedStateVersion, status: "PLAYING" });
      expect(await database.tableActionReceipt.count({ where: { clientActionId: input.clientActionId } })).toBe(0);

      const retried = await actorSocket.emitWithAck("action:submit", input);
      expect(retried).toMatchObject({ data: { alreadyProcessed: false }, ok: true });
      expect(await database.tableActionReceipt.count({ where: { clientActionId: input.clientActionId } })).toBe(1);
      expect(await database.handRecord.count({ where: { id: hand.handId } })).toBe(1);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("notifies every player and hides uncommitted results when a user action cannot persist", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "用户结算失败", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "606161", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60616100-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60616100-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtime, room.id, "60616100-0000-4000-8000-000000000004");
      await time.advanceBy(5_000);
      const hand = runtime.currentHand!.state;
      const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
      const actorSocket = actor === alice.userId ? aliceSocket : bobSocket;
      await database.tableSeat.delete({ where: { roomId_userId: { roomId: room.id, userId: actor } } });
      const aliceError = new Promise<{ readonly code: string }>((resolve) => aliceSocket.once("table:error", resolve));
      const bobError = new Promise<{ readonly code: string }>((resolve) => bobSocket.once("table:error", resolve));

      const failed = await actorSocket.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: "60616100-0000-4000-8000-000000000003", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: room.id });

      expect(failed.error).toMatchObject({ code: "PERSISTENCE_ERROR" });
      await expect(Promise.all([aliceError, bobError])).resolves.toEqual([
        expect.objectContaining({ code: "PERSISTENCE_ERROR" }),
        expect.objectContaining({ code: "PERSISTENCE_ERROR" }),
      ]);
      for (const socket of [aliceSocket, bobSocket]) {
        const state = (await socket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
        expect(state).toMatchObject({ hand: null, runtimeStatus: "PERSISTENCE_ERROR" });
        expect(state.seats.map((seat) => seat.stack)).toEqual([400, 400]);
      }
      expect(await database.handRecord.count({ where: { roomId: room.id } })).toBe(0);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("notifies every player and hides uncommitted results when a timer action cannot persist", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "超时结算失败", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "606262", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60626200-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "60626200-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtime, room.id, "60626200-0000-4000-8000-000000000004");
      await time.advanceBy(5_000);
      await database.tableSeat.delete({ where: { roomId_userId: { roomId: room.id, userId: alice.userId } } });
      const aliceError = new Promise<{ readonly code: string }>((resolve) => aliceSocket.once("table:error", resolve));
      const bobError = new Promise<{ readonly code: string }>((resolve) => bobSocket.once("table:error", resolve));

      await time.advanceBy(15_000);

      await expect(Promise.all([aliceError, bobError])).resolves.toEqual([
        expect.objectContaining({ code: "PERSISTENCE_ERROR" }),
        expect.objectContaining({ code: "PERSISTENCE_ERROR" }),
      ]);
      for (const socket of [aliceSocket, bobSocket]) {
        const state = (await socket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection;
        expect(state).toMatchObject({ hand: null, runtimeStatus: "PERSISTENCE_ERROR" });
        expect(state.seats.map((seat) => seat.stack)).toEqual([400, 400]);
      }
      expect(await database.handRecord.count({ where: { roomId: room.id } })).toBe(0);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("keeps the active hand during pause, resumes countdown, and safely closes after settlement", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "生命周期", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707171", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "71000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 1, operationId: "71000000-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtimes.get(room.id)!, room.id, "71000000-0000-4000-8000-000000000003");
      await time.advanceBy(5_000);
      const runtime = runtimes.get(room.id)!;
      const firstHandId = runtime.currentHand!.state.handId;

      const paused = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${room.id}/pause` });
      expect(paused.statusCode).toBe(200);
      expect(runtime.currentHand?.state.handId).toBe(firstHandId);
      expect(runtime.room.nextHandPaused).toBe(true);
      expect(runtime.status).toBe("PLAYING");

      let actor = runtime.currentHand!.state.players.find((player) => player.seatIndex === runtime.currentHand!.state.currentActorSeat)!;
      let actorSocket = actor.playerId === alice.userId ? aliceSocket : bobSocket;
      await actorSocket.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: "72000000-0000-4000-8000-000000000001", expectedStateVersion: runtime.stateVersion, handId: firstHandId, roomId: room.id });
      expect(runtime.currentHand).toBeNull();
      expect(runtime.status).toBe("POST_HAND_REVIEW");
      await time.advanceBy(4_000);
      expect(runtime.status).toBe("PAUSED");
      await time.advanceBy(30_000);
      expect(runtime.currentHand).toBeNull();

      const resumed = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${room.id}/resume` });
      expect(resumed.statusCode).toBe(200);
      expect(runtime.status).toBe("START_COUNTDOWN");
      await time.advanceBy(5_000);
      expect(runtime.currentHand?.state.status).toBe("active");

      const closing = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${room.id}/close` });
      expect(closing.statusCode).toBe(200);
      expect(runtime.status).toBe("CLOSING");
      actor = runtime.currentHand!.state.players.find((player) => player.seatIndex === runtime.currentHand!.state.currentActorSeat)!;
      actorSocket = actor.playerId === alice.userId ? aliceSocket : bobSocket;
      await actorSocket.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: "72000000-0000-4000-8000-000000000002", expectedStateVersion: runtime.stateVersion, handId: runtime.currentHand!.state.handId, roomId: room.id });

      expect(runtime.status).toBe("POST_HAND_REVIEW");
      await time.advanceBy(4_000);
      expect(runtime.status).toBe("CLOSED");
      expect(runtime.seats.size).toBe(0);
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
      expect(await database.gameSession.count({ where: { roomId: room.id, status: "CLOSED" } })).toBe(2);
      expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: room.id, type: "CASH_OUT" } })).toBe(0);
      expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(19_960);
      expect((await database.room.findUniqueOrThrow({ where: { id: room.id } })).status).toBe("CLOSED");
    } finally { await server.realtime.close(); await server.app.close(); }
  }, 15_000);

  it("preserves PERSISTENCE_ERROR when a room-closing notification arrives", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "持久化保护", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707373", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const time = new FakeClockScheduler();
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes, time });
    try {
      const aliceSocket = connect(server.url, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(server.url, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "74000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "74000000-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      await ownerStart(aliceSocket, runtime, room.id, "74000000-0000-4000-8000-000000000004");
      await time.advanceBy(5_000);
      runtime.status = "PERSISTENCE_ERROR";

      const frozen = await aliceSocket.emitWithAck("seat:sit-out", {
        expectedStateVersion: runtime.stateVersion,
        operationId: "74000000-0000-4000-8000-000000000003",
        roomId: room.id,
      });
      expect(frozen.error).toMatchObject({ code: "PERSISTENCE_ERROR" });
      expect(await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: room.id, userId: alice.userId } } })).toMatchObject({ playStatus: "ACTIVE", stack: 400 });

      const closing = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${room.id}/close` });

      expect(closing.statusCode).toBe(200);
      expect(runtime.room.status).toBe("CLOSING");
      expect(runtime.status).toBe("PERSISTENCE_ERROR");
      expect(runtime.currentHand).not.toBeNull();
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("hydrates and cashes out an occupied room when close is requested before any runtime exists", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "重启后关房", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707575", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    await createTableAccountingService(database).takeSeat(alice.userId, {
      buyInAmount: 400,
      expectedStateVersion: 0,
      operationId: "76000000-0000-4000-8000-000000000001",
      roomId: room.id,
      seatIndex: 0,
    });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      expect(runtimes.get(room.id)).toBeUndefined();

      const closing = await server.app.inject({ headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" }, method: "POST", url: `/api/rooms/${room.id}/close` });

      expect(closing.statusCode).toBe(200);
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
      expect(await database.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ status: "CLOSED" });
      expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: 10_000 });
      expect(runtimes.get(room.id)).toBeUndefined();
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("finalizes a detached stack when the last standing player closes the room", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "站起后关房", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707576", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      const seated = await socket.emitWithAck("seat:take", {
        buyInAmount: 999,
        expectedStateVersion: runtime.stateVersion,
        operationId: "76500000-0000-4000-8000-000000000001",
        roomId: room.id,
        seatIndex: 0,
      });
      await socket.emitWithAck("stack:buy-in", {
        amount: 100,
        expectedStateVersion: runtime.stateVersion,
        operationId: "76500000-0000-4000-8000-000000000002",
        roomId: room.id,
      });
      const left = await socket.emitWithAck("seat:leave", {
        expectedStateVersion: runtime.stateVersion,
        operationId: "76500000-0000-4000-8000-000000000003",
        roomId: room.id,
      });

      expect(seated).toMatchObject({ data: { stack: 400 }, ok: true });
      expect(left).toMatchObject({ data: { stack: 500 }, ok: true });
      expect(runtime.seats.size).toBe(0);
      expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.data.gameSessionId } })).toMatchObject({
        detachedStack: 500,
        status: "ACTIVE",
        totalBuyIn: 500,
      });

      const closing = await server.app.inject({
        headers: { cookie: alice.cookie, origin: "http://localhost:5173", "x-wepoker-request": "1" },
        method: "POST",
        url: `/api/rooms/${room.id}/close`,
      });

      expect(closing.statusCode).toBe(200);
      expect(runtime.status).toBe("CLOSED");
      expect(await database.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ status: "CLOSED" });
      expect(await database.gameSession.findUniqueOrThrow({ where: { id: seated.data.gameSessionId } })).toMatchObject({
        detachedStack: null,
        status: "CLOSED",
        totalBuyIn: 500,
        totalCashOut: 500,
      });
      expect(await database.tableStackLedgerEntry.count({
        where: { gameSessionId: seated.data.gameSessionId, type: "CASH_OUT" },
      })).toBe(1);
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
      expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("keeps duplicate concurrent room-closing notifications idempotently CLOSED", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "重复关房", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707676", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      await socket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "77000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      await database.room.update({ data: { closeRequestedAt: new Date(), status: "CLOSING" }, where: { id: room.id } });

      await Promise.all([runtimes.notify(room.id), runtimes.notify(room.id)]);

      expect(runtime.status).toBe("CLOSED");
      expect(runtime.room.status).toBe("CLOSED");
      expect(runtime.seats.size).toBe(0);
      expect(await database.room.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ status: "CLOSED" });
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("serializes two sockets for one user and never creates a second seat", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "双标签", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707272", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      const firstSocket = connect(server.url, alice.cookie); sockets.push(firstSocket); await waitForConnect(firstSocket);
      const secondSocket = connect(server.url, alice.cookie); sockets.push(secondSocket); await waitForConnect(secondSocket);
      await firstSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await secondSocket.emitWithAck("table:subscribe", { roomId: room.id });
      const seated = await firstSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "73000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      expect(seated.error).toBeUndefined();
      const duplicate = await secondSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtimes.get(room.id)!.stateVersion, operationId: "73000000-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
      expect(duplicate.error).toMatchObject({ code: "USER_ALREADY_SEATED" });
      expect(await database.tableSeat.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(1);
      expect((await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).balance).toBe(10_000);
    } finally { await server.realtime.close(); await server.app.close(); }
  });

  it("returns exact durable replays without rolling the runtime back to an older seat lifecycle", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "回放隔离", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "707474", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const runtimes = new TableRuntimeManager();
    const server = await start({ runtimes });
    try {
      const socket = connect(server.url, alice.cookie); sockets.push(socket); await waitForConnect(socket);
      await socket.emitWithAck("table:subscribe", { roomId: room.id });
      const runtime = runtimes.get(room.id)!;
      const firstSeatInput = { buyInAmount: 400, expectedStateVersion: 0, operationId: "75000000-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 };
      const firstSeat = await socket.emitWithAck("seat:take", firstSeatInput);
      await socket.emitWithAck("stack:buy-in", { amount: 100, expectedStateVersion: runtime.stateVersion, operationId: "75000000-0000-4000-8000-000000000002", roomId: room.id });
      const versionAfterTopUp = runtime.stateVersion;

      expect(await socket.emitWithAck("seat:take", firstSeatInput)).toMatchObject({ data: firstSeat.data, ok: true });
      expect(runtime.seats.get(0)).toMatchObject({ stack: 500, version: 2 });
      expect(runtime.stateVersion).toBe(versionAfterTopUp);

      const sitOutInput = { expectedStateVersion: runtime.stateVersion, operationId: "75000000-0000-4000-8000-000000000003", roomId: room.id };
      const firstSitOut = await socket.emitWithAck("seat:sit-out", sitOutInput);
      await socket.emitWithAck("seat:return", { expectedStateVersion: runtime.stateVersion, operationId: "75000000-0000-4000-8000-000000000004", roomId: room.id });
      const versionAfterReturn = runtime.stateVersion;

      expect(await socket.emitWithAck("seat:sit-out", sitOutInput)).toMatchObject({ data: firstSitOut.data, ok: true });
      expect(runtime.seats.get(0)?.playStatus).toBe("ACTIVE");
      expect(runtime.stateVersion).toBe(versionAfterReturn);

      const leaveInput = { expectedStateVersion: runtime.stateVersion, operationId: "75000000-0000-4000-8000-000000000005", roomId: room.id };
      const firstLeave = await socket.emitWithAck("seat:leave", leaveInput);
      const secondSeat = await socket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: runtime.stateVersion, operationId: "75000000-0000-4000-8000-000000000006", roomId: room.id, seatIndex: 1 });
      const versionAfterReseat = runtime.stateVersion;

      expect(await socket.emitWithAck("seat:leave", leaveInput)).toMatchObject({ data: firstLeave.data, ok: true });
      expect(secondSeat.data.gameSessionId).toBe(firstSeat.data.gameSessionId);
      expect(runtime.seats.get(1)).toMatchObject({ gameSessionId: firstSeat.data.gameSessionId, stack: 500, userId: alice.userId });
      expect(runtime.stateVersion).toBe(versionAfterReseat);
      expect(await database.tableSeat.count({ where: { roomId: room.id, userId: alice.userId } })).toBe(1);
    } finally { await server.realtime.close(); await server.app.close(); }
  });
});
