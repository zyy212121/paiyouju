import { createStandardDeck } from "@paiyouju/poker-core";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../app.js";
import { loadEnvironment } from "../../../config/environment.js";
import type { DatabaseClient } from "../../../db/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../../integration/database.js";
import { attachRealtimeTransport } from "../../../realtime.js";
import { createTableAccountingService } from "../table-accounting.service.js";
import { FakeClockScheduler, FixedDeckProvider } from "../runtime/testing.js";
import { TableRuntimeManager } from "../runtime/table-runtime-manager.js";

function connect(url: string, cookie: string): Socket {
  return io(url, {
    autoConnect: false,
    extraHeaders: { Cookie: cookie, Origin: "http://localhost:5173" },
    forceNew: true,
    transports: ["websocket"],
  });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
}

describe("table startup recovery", () => {
  let database: DatabaseClient;
  const sockets: Socket[] = [];

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => { for (const socket of sockets) socket.disconnect(); await database.$disconnect(); });

  it("recovers the same active hand and preserves its future absolute deadline", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const bob = await createTestIdentity(database, "bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "恢复", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "818181", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const environment = loadEnvironment();
    const time = new FakeClockScheduler();
    const firstRuntimes = new TableRuntimeManager();
    const firstApp = await buildApp({ database, environment, rateLimit: false, runtimes: firstRuntimes });
    let handIndex = 0;
    const firstRealtime = attachRealtimeTransport(firstApp.server, { clock: time, database, deckProvider: new FixedDeckProvider(createStandardDeck()), environment, idFactory: () => `81818181-8181-4181-8181-${String(++handIndex).padStart(12, "0")}`, runtimes: firstRuntimes, scheduler: time });
    await firstApp.listen({ host: "127.0.0.1", port: 0 });
    const firstAddress = firstApp.server.address();
    if (!firstAddress || typeof firstAddress === "string") throw new Error("missing first address");
    const aliceSocket = connect(`http://127.0.0.1:${firstAddress.port}`, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
    const bobSocket = connect(`http://127.0.0.1:${firstAddress.port}`, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
    await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "81818181-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 1, operationId: "81818181-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
    await aliceSocket.emitWithAck("table:start", { expectedStateVersion: firstRuntimes.get(room.id)!.stateVersion, operationId: "81818181-0000-4000-8000-000000000003", roomId: room.id });
    await time.advanceBy(5_000);
    const before = firstRuntimes.get(room.id)!;
    const beforeHand = structuredClone(before.currentHand!);
    const beforeVersion = before.stateVersion;
    aliceSocket.disconnect(); bobSocket.disconnect();
    await firstRealtime.shutdown(); await firstApp.close();

    const secondRuntimes = new TableRuntimeManager();
    const secondApp = await buildApp({ database, environment, rateLimit: false, runtimes: secondRuntimes });
    const secondRealtime = attachRealtimeTransport(secondApp.server, { clock: time, database, environment, runtimes: secondRuntimes, scheduler: time });
    try {
      expect(await secondRealtime.recoverTables()).toEqual({ degradedRooms: 0, recoveredRooms: 1 });
      const recovered = secondRuntimes.get(room.id)!;
      expect(recovered.currentHand).toEqual(beforeHand);
      expect(recovered.stateVersion).toBe(beforeVersion);
      expect(recovered.hasPresence()).toBe(false);
    } finally { await secondRealtime.shutdown(); await secondApp.close(); }
  });

  it("recovers the remaining post-hand review window and voluntary reveal without repeating settlement", async () => {
    const alice = await createTestIdentity(database, "review-alice", 10_000);
    const bob = await createTestIdentity(database, "review-bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "观察期恢复", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "819191", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const environment = loadEnvironment();
    const time = new FakeClockScheduler();
    const firstRuntimes = new TableRuntimeManager();
    const firstApp = await buildApp({ database, environment, rateLimit: false, runtimes: firstRuntimes });
    const firstRealtime = attachRealtimeTransport(firstApp.server, { clock: time, database, deckProvider: new FixedDeckProvider(createStandardDeck()), environment, idFactory: () => "81919191-8191-4191-8191-819191919191", runtimes: firstRuntimes, scheduler: time });
    await firstApp.listen({ host: "127.0.0.1", port: 0 });
    const firstAddress = firstApp.server.address();
    if (!firstAddress || typeof firstAddress === "string") throw new Error("missing review address");
    const aliceSocket = connect(`http://127.0.0.1:${firstAddress.port}`, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
    const bobSocket = connect(`http://127.0.0.1:${firstAddress.port}`, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
    await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "81919191-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 1, operationId: "81919191-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
    const runtime = firstRuntimes.get(room.id)!;
    await aliceSocket.emitWithAck("table:start", { expectedStateVersion: runtime.stateVersion, operationId: "81919191-0000-4000-8000-000000000003", roomId: room.id });
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const actorSocket = actor.playerId === alice.userId ? aliceSocket : bobSocket;
    await actorSocket.emitWithAck("hand:reveal-own-cards", { cardIndex: 0, expectedStateVersion: runtime.stateVersion, handId: hand.handId, operationId: "81919191-0000-4000-8000-000000000005", roomId: room.id });
    await actorSocket.emitWithAck("action:submit", { action: { type: "fold" }, clientActionId: "81919191-0000-4000-8000-000000000004", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: room.id });
    const reviewEndsAt = runtime.postHandReview!.endsAt.toISOString();
    const settledStacks = await database.tableSeat.findMany({ orderBy: { userId: "asc" } });
    const wallets = await database.wallet.findMany({ orderBy: { userId: "asc" } });
    await time.advanceBy(1_000);
    aliceSocket.disconnect(); bobSocket.disconnect();
    await firstRealtime.shutdown(); await firstApp.close();

    const recoveredRuntimes = new TableRuntimeManager();
    const recoveredApp = await buildApp({ database, environment, rateLimit: false, runtimes: recoveredRuntimes });
    const recoveredRealtime = attachRealtimeTransport(recoveredApp.server, { clock: time, database, environment, runtimes: recoveredRuntimes, scheduler: time });
    try {
      expect(await recoveredRealtime.recoverTables()).toEqual({ degradedRooms: 0, recoveredRooms: 1 });
      const recovered = recoveredRuntimes.get(room.id)!;
      expect(recovered.status).toBe("POST_HAND_REVIEW");
      expect(recovered.postHandReview?.endsAt.toISOString()).toBe(reviewEndsAt);
      expect(recovered.postHandReview?.voluntarilyRevealedCardIndicesByUser[actor.playerId]).toEqual([0]);
      expect(recovered.postHandReview?.voluntarilyRevealedUserIds).not.toContain(actor.playerId);
      expect(await database.handRecord.count({ where: { id: hand.handId } })).toBe(1);
      expect(await database.tableStackLedgerEntry.count({ where: { handId: hand.handId, type: "HAND_RESULT" } })).toBe(2);
      expect(await database.tableSeat.findMany({ orderBy: { userId: "asc" } })).toEqual(settledStacks);
      expect(await database.wallet.findMany({ orderBy: { userId: "asc" } })).toEqual(wallets);
      await time.advanceBy(2_999);
      expect(recovered.status).toBe("POST_HAND_REVIEW");
      await time.advanceBy(1);
      expect(recovered).toMatchObject({
        currentHand: { handNumber: 2 },
        postHandReview: null,
        status: "PLAYING",
      });
      expect(recovered.currentHand?.state.handId).not.toBe(hand.handId);
      expect(recovered.currentHand?.state.players.map((player) => player.playerId).sort()).toEqual([alice.userId, bob.userId].sort());
      expect(recovered.room).toMatchObject({ requiresManualStart: false, status: "OPEN" });
      expect(await database.handRecord.count({ where: { id: hand.handId } })).toBe(1);
      expect(await database.tableStackLedgerEntry.count({ where: { handId: hand.handId, type: "HAND_RESULT" } })).toBe(2);
    } finally { await recoveredRealtime.shutdown(); await recoveredApp.close(); }
  });

  it("resets a recovered START_COUNTDOWN to IDLE because startup Presence is empty", async () => {
    const alice = await createTestIdentity(database, "countdown-alice", 10_000);
    const bob = await createTestIdentity(database, "countdown-bob", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "倒计时恢复", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "858585", smallBlind: 10 } });
    await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
    const environment = loadEnvironment();
    const time = new FakeClockScheduler();
    const firstRuntimes = new TableRuntimeManager();
    const firstApp = await buildApp({ database, environment, rateLimit: false, runtimes: firstRuntimes });
    const firstRealtime = attachRealtimeTransport(firstApp.server, { clock: time, database, deckProvider: new FixedDeckProvider(createStandardDeck()), environment, runtimes: firstRuntimes, scheduler: time });
    await firstApp.listen({ host: "127.0.0.1", port: 0 });
    const address = firstApp.server.address();
    if (!address || typeof address === "string") throw new Error("missing countdown address");
    const aliceSocket = connect(`http://127.0.0.1:${address.port}`, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
    const bobSocket = connect(`http://127.0.0.1:${address.port}`, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
    await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
    await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: "85858585-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 1, operationId: "85858585-0000-4000-8000-000000000002", roomId: room.id, seatIndex: 1 });
    await aliceSocket.emitWithAck("table:start", { expectedStateVersion: firstRuntimes.get(room.id)!.stateVersion, operationId: "85858585-0000-4000-8000-000000000003", roomId: room.id });
    const countdownVersion = firstRuntimes.get(room.id)!.stateVersion;
    expect(firstRuntimes.get(room.id)).toMatchObject({ status: "START_COUNTDOWN" });
    aliceSocket.disconnect(); bobSocket.disconnect(); await firstRealtime.shutdown(); await firstApp.close();

    const runtimes = new TableRuntimeManager();
    const app = await buildApp({ database, environment, rateLimit: false, runtimes });
    const realtime = attachRealtimeTransport(app.server, { clock: time, database, environment, runtimes, scheduler: time });
    try {
      expect(await realtime.recoverTables()).toEqual({ degradedRooms: 0, recoveredRooms: 1 });
      expect(runtimes.get(room.id)).toMatchObject({ currentHand: null, startCountdownAt: null, stateVersion: countdownVersion + 1, status: "IDLE" });
      expect(runtimes.get(room.id)?.hasPresence()).toBe(false);
      expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } })).toMatchObject({ activeHandId: null, runtimeStatus: "IDLE", startDeadlineAt: null, stateVersion: countdownVersion + 1 });
    } finally { await realtime.shutdown(); await app.close(); }
  });

  it("isolates an unsupported snapshot as RECOVERY_ERROR without changing money", async () => {
    const alice = await createTestIdentity(database, "alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "损坏", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "828282", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const environment = loadEnvironment();
    const bootstrapRuntimes = new TableRuntimeManager();
    const bootstrapApp = await buildApp({ database, environment, rateLimit: false, runtimes: bootstrapRuntimes });
    const bootstrapRealtime = attachRealtimeTransport(bootstrapApp.server, { database, environment, runtimes: bootstrapRuntimes });
    await bootstrapApp.listen({ host: "127.0.0.1", port: 0 });
    const address = bootstrapApp.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const socket = connect(`http://127.0.0.1:${address.port}`, alice.cookie); sockets.push(socket); await waitForConnect(socket);
    await socket.emitWithAck("table:subscribe", { roomId: room.id });
    socket.disconnect(); await bootstrapRealtime.shutdown(); await bootstrapApp.close();
    await database.tableSnapshot.update({ data: { schemaVersion: 999 }, where: { roomId: room.id } });
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });

    const runtimes = new TableRuntimeManager();
    const app = await buildApp({ database, environment, rateLimit: false, runtimes });
    const realtime = attachRealtimeTransport(app.server, { database, environment, runtimes });
    try {
      expect(await realtime.recoverTables()).toEqual({ degradedRooms: 1, recoveredRooms: 0 });
      expect(runtimes.get(room.id)?.status).toBe("RECOVERY_ERROR");
      expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } })).toMatchObject({ recoveryStatus: "ERROR", runtimeStatus: "RECOVERY_ERROR" });
      expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toMatchObject({ balance: walletBefore.balance, version: walletBefore.version });
    } finally { await realtime.shutdown(); await app.close(); }
  });

  it("R11 isolates duplicate cards, broken conservation, invalid actors, reveal-config drift, and unsupported schemas without touching Wallet", async () => {
    const corruptions = ["duplicate-card", "chip-conservation", "invalid-actor", "reveal-config", "schema-version"] as const;
    const environment = loadEnvironment();
    for (const [index, corruption] of corruptions.entries()) {
      const alice = await createTestIdentity(database, `corrupt-a-${index}`, 10_000);
      const bob = await createTestIdentity(database, `corrupt-b-${index}`, 10_000);
      const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: corruption, ownerId: alice.userId, paidCardRevealCost: 0, roomCode: `83${String(index).repeat(4)}`, smallBlind: 10 } });
      await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
      const time = new FakeClockScheduler();
      const bootstrapRuntimes = new TableRuntimeManager();
      const bootstrapApp = await buildApp({ database, environment, rateLimit: false, runtimes: bootstrapRuntimes });
      const bootstrapRealtime = attachRealtimeTransport(bootstrapApp.server, { clock: time, database, deckProvider: new FixedDeckProvider(createStandardDeck()), environment, idFactory: () => `83838383-8383-4383-8383-${String(index).padStart(12, "0")}`, runtimes: bootstrapRuntimes, scheduler: time });
      await bootstrapApp.listen({ host: "127.0.0.1", port: 0 });
      const address = bootstrapApp.server.address();
      if (!address || typeof address === "string") throw new Error("missing corruption address");
      const aliceSocket = connect(`http://127.0.0.1:${address.port}`, alice.cookie); sockets.push(aliceSocket); await waitForConnect(aliceSocket);
      const bobSocket = connect(`http://127.0.0.1:${address.port}`, bob.cookie); sockets.push(bobSocket); await waitForConnect(bobSocket);
      await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
      await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 0, operationId: `83838383-0000-4000-8000-${String(index * 2 + 1).padStart(12, "0")}`, roomId: room.id, seatIndex: 0 });
      await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: 1, operationId: `83838383-0000-4000-8000-${String(index * 2 + 2).padStart(12, "0")}`, roomId: room.id, seatIndex: 1 });
      await aliceSocket.emitWithAck("table:start", { expectedStateVersion: bootstrapRuntimes.get(room.id)!.stateVersion, operationId: `83838383-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, roomId: room.id });
      await time.advanceBy(5_000);
      aliceSocket.disconnect(); bobSocket.disconnect(); await bootstrapRealtime.shutdown(); await bootstrapApp.close();
      const snapshot = await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } });
      const payload = structuredClone(snapshot.payload) as Record<string, unknown>;
      const hand = payload.currentHand as { paidCardRevealCost: number; paidCardRevealEnabled: boolean; state: { currentActorSeat: number; deck: string[]; players: Array<{ committedThisHand: number; stack: number }> } };
      if (corruption === "duplicate-card") hand.state.deck[0] = (hand.state as unknown as { players: Array<{ holeCards: string[] }> }).players[0]!.holeCards[0]!;
      if (corruption === "chip-conservation") hand.state.players[0]!.stack += 1;
      if (corruption === "invalid-actor") hand.state.currentActorSeat = 8;
      if (corruption === "reveal-config") {
        hand.paidCardRevealEnabled = false;
        hand.paidCardRevealCost = 10;
      }
      await database.tableSnapshot.update({ data: corruption === "schema-version" ? { schemaVersion: 999 } : { payload: payload as Prisma.InputJsonObject }, where: { roomId: room.id } });
      const walletsBefore = await database.wallet.findMany({ orderBy: { userId: "asc" }, where: { userId: { in: [alice.userId, bob.userId] } } });

      const runtimes = new TableRuntimeManager();
      const app = await buildApp({ database, environment, rateLimit: false, runtimes });
      const realtime = attachRealtimeTransport(app.server, { database, environment, runtimes });
      try {
        expect(await realtime.recoverTables()).toEqual({ degradedRooms: 1, recoveredRooms: 0 });
        expect(runtimes.get(room.id)?.status).toBe("RECOVERY_ERROR");
        expect(await database.wallet.findMany({ orderBy: { userId: "asc" }, where: { userId: { in: [alice.userId, bob.userId] } } })).toEqual(walletsBefore);
      } finally { await realtime.shutdown(); await app.close(); }
      await clearIntegrationDatabase(database);
    }
  });

  it("R12 creates an IDLE snapshot for an occupied legacy room without guessing an active hand or changing stacks", async () => {
    const alice = await createTestIdentity(database, "legacy-alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "旧房间", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "848484", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    await createTableAccountingService(database).takeSeat(alice.userId, { buyInAmount: 400, expectedStateVersion: 0, operationId: "84848484-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });
    const environment = loadEnvironment();
    const runtimes = new TableRuntimeManager();
    const app = await buildApp({ database, environment, rateLimit: false, runtimes });
    const realtime = attachRealtimeTransport(app.server, { database, environment, runtimes });
    try {
      expect(await realtime.recoverTables()).toEqual({ degradedRooms: 0, recoveredRooms: 1 });
      expect(runtimes.get(room.id)).toMatchObject({ currentHand: null, status: "IDLE" });
      expect(runtimes.get(room.id)?.seats.get(0)).toMatchObject({ stack: 400, userId: alice.userId });
      expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: room.id } })).toMatchObject({ activeHandId: null, runtimeStatus: "IDLE", stateVersion: 0 });
      expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toEqual(walletBefore);
    } finally { await realtime.shutdown(); await app.close(); }
  });

  it("freezes mutations and returns only a safe projection for RECOVERY_ERROR rooms", async () => {
    const alice = await createTestIdentity(database, "frozen-alice", 10_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 400, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "冻结恢复", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "868686", smallBlind: 10 } });
    await database.roomMember.create({ data: { role: "OWNER", roomId: room.id, userId: alice.userId } });
    const environment = loadEnvironment();
    const bootstrapRuntimes = new TableRuntimeManager();
    const bootstrapApp = await buildApp({ database, environment, rateLimit: false, runtimes: bootstrapRuntimes });
    const bootstrapRealtime = attachRealtimeTransport(bootstrapApp.server, { database, environment, runtimes: bootstrapRuntimes });
    await bootstrapApp.listen({ host: "127.0.0.1", port: 0 });
    const bootstrapAddress = bootstrapApp.server.address();
    if (!bootstrapAddress || typeof bootstrapAddress === "string") throw new Error("missing frozen address");
    const bootstrapSocket = connect(`http://127.0.0.1:${bootstrapAddress.port}`, alice.cookie); sockets.push(bootstrapSocket); await waitForConnect(bootstrapSocket);
    await bootstrapSocket.emitWithAck("table:subscribe", { roomId: room.id });
    bootstrapSocket.disconnect(); await bootstrapRealtime.shutdown(); await bootstrapApp.close();
    await database.tableSnapshot.update({ data: { schemaVersion: 999 }, where: { roomId: room.id } });
    const walletBefore = await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } });

    const runtimes = new TableRuntimeManager();
    const app = await buildApp({ database, environment, rateLimit: false, runtimes });
    const realtime = attachRealtimeTransport(app.server, { database, environment, runtimes });
    await realtime.recoverTables();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing recovery-error address");
    const socket = connect(`http://127.0.0.1:${address.port}`, alice.cookie); sockets.push(socket); await waitForConnect(socket);
    try {
      const subscribed = await socket.emitWithAck("table:subscribe", { roomId: room.id });
      expect(subscribed).toMatchObject({ data: { hand: null, runtimeStatus: "RECOVERY_ERROR" }, ok: true });
      expect(JSON.stringify(subscribed)).not.toMatch(/deck|holeCards|payload|sql|stack trace/i);
      const seated = await socket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: subscribed.data.stateVersion, operationId: "86868686-0000-4000-8000-000000000001", roomId: room.id, seatIndex: 0 });
      expect(seated).toMatchObject({ error: { code: "RECOVERY_ERROR" }, ok: false });
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(0);
      expect(await database.wallet.findUniqueOrThrow({ where: { userId: alice.userId } })).toEqual(walletBefore);
    } finally { socket.disconnect(); await realtime.shutdown(); await app.close(); }
  });
});
