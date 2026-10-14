import { createStandardDeck } from "@paiyouju/poker-core";
import type { TableStateProjection } from "@paiyouju/shared";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { loadEnvironment } from "../config/environment.js";
import type { DatabaseClient } from "../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../integration/database.js";
import { FixedDeckProvider, FakeClockScheduler } from "../modules/tables/runtime/testing.js";
import { TableRuntimeManager } from "../modules/tables/runtime/table-runtime-manager.js";
import { attachRealtimeTransport } from "../realtime.js";

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
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    socket.connect();
  });
}

const commandId = (prefix: number, index: number) =>
  `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;

describe("authoritative multiplayer Socket tables", () => {
  let database: DatabaseClient;
  const sockets: Socket[] = [];

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await database.$disconnect();
  });

  async function start(runtimes: TableRuntimeManager, time: FakeClockScheduler) {
    const environment = loadEnvironment();
    const app = await buildApp({ database, environment, rateLimit: false, runtimes });
    let handIndex = 0;
    const realtime = attachRealtimeTransport(app.server, {
      clock: time,
      database,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      environment,
      idFactory: () => commandId(9_000_000, ++handIndex),
      runtimes,
      scheduler: time,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    return { app, realtime, url: `http://127.0.0.1:${address.port}` };
  }

  async function subscribeAndSeat(
    socket: Socket,
    runtimes: TableRuntimeManager,
    roomId: string,
    seatIndex: number,
    buyInAmount: number,
    operationIndex: number,
  ): Promise<void> {
    await socket.emitWithAck("table:subscribe", { roomId });
    const result = await socket.emitWithAck("seat:take", {
      buyInAmount,
      expectedStateVersion: runtimes.get(roomId)?.stateVersion ?? 0,
      operationId: commandId(1_000_000, operationIndex),
      roomId,
      seatIndex,
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toMatchObject({ seatIndex });
    const initialStack = Number(result.data.stack);
    expect(initialStack).toBeLessThanOrEqual(buyInAmount);
    if (initialStack < buyInAmount) {
      let remaining = buyInAmount - initialStack;
      let topUpIndex = 0;
      while (remaining > 0) {
        const amount = Math.min(initialStack, remaining);
        const topUp = await socket.emitWithAck("stack:buy-in", {
          amount,
          expectedStateVersion: runtimes.get(roomId)!.stateVersion,
          operationId: commandId(1_100_000 + topUpIndex, operationIndex),
          roomId,
        });
        expect(topUp.error).toBeUndefined();
        remaining -= amount;
        topUpIndex += 1;
        expect(topUp.data).toMatchObject({ stack: buyInAmount - remaining });
      }
    }
  }

  it("settles a real three-player 100/300/700 all-in with every committed layer persisted as a pot", async () => {
    const users = await Promise.all([
      createTestIdentity(database, "alice", 10_000),
      createTestIdentity(database, "bob", 10_000),
      createTestIdentity(database, "carol", 10_000),
    ]);
    const room = await database.room.create({
      data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 100, maximumBuyIn: 700, maxSeats: 3, minimumBuyIn: 20, name: "三人边池", ownerId: users[0]!.userId, paidCardRevealCost: 0, roomCode: "707070", smallBlind: 10 },
    });
    await database.roomMember.createMany({
      data: users.map((user, index) => ({ role: index === 0 ? "OWNER" as const : "MEMBER" as const, roomId: room.id, userId: user.userId })),
    });
    const runtimes = new TableRuntimeManager();
    const time = new FakeClockScheduler();
    const server = await start(runtimes, time);
    try {
      const playerSockets: Socket[] = [];
      for (const user of users) {
        const socket = connect(server.url, user.cookie);
        sockets.push(socket);
        playerSockets.push(socket);
        await waitForConnect(socket);
      }
      for (const [index, stack] of [100, 300, 700].entries()) {
        await subscribeAndSeat(playerSockets[index]!, runtimes, room.id, index, stack, index + 1);
      }
      const startResult = await playerSockets[0]!.emitWithAck("table:start", {
        expectedStateVersion: runtimes.get(room.id)!.stateVersion,
        operationId: commandId(1_000_000, 100),
        roomId: room.id,
      });
      expect(startResult.error).toBeUndefined();
      await time.advanceBy(5_000);
      const runtime = runtimes.get(room.id)!;
      expect(runtime.currentHand?.state.status).toBe("active");

      let actionIndex = 0;
      while (runtime.currentHand) {
        actionIndex += 1;
        if (actionIndex > 6) throw new Error("three-player all-in did not complete");
        const actorSeat = runtime.currentHand.state.currentActorSeat;
        const actor = runtime.currentHand.state.players.find((player) => player.seatIndex === actorSeat)!;
        const socket = playerSockets[actor.seatIndex]!;
        const result = await socket.emitWithAck("action:submit", {
          action: { type: "allIn" },
          clientActionId: commandId(2_000_000, actionIndex),
          expectedStateVersion: runtime.stateVersion,
          handId: runtime.currentHand.state.handId,
          roomId: room.id,
        });
        expect(result.error).toBeUndefined();
      }

      const hand = await database.handRecord.findFirstOrThrow({
        include: { players: true, pots: { orderBy: { potIndex: "asc" } }, tableStackEntries: true },
        where: { roomId: room.id },
      });
      expect(hand.finishReason).toBe("SHOWDOWN");
      expect(hand.pots.map((pot) => pot.amount)).toEqual([300, 400, 400]);
      expect(hand.pots[0]!.contributors).toHaveLength(3);
      expect(hand.pots[0]!.eligiblePlayers).toHaveLength(3);
      expect(hand.pots[1]!.contributors).toHaveLength(2);
      expect(hand.pots[1]!.eligiblePlayers).toHaveLength(2);
      expect(hand.pots[2]!.contributors).toHaveLength(1);
      expect(hand.pots[2]!.eligiblePlayers).toHaveLength(1);
      expect(hand.pots.every((pot) => pot.winners.every((winner) => pot.eligiblePlayers.includes(winner)))).toBe(true);
      expect(hand.tableStackEntries).toHaveLength(3);
      expect(hand.tableStackEntries.every((entry) => entry.stackAfter === entry.stackBefore + entry.signedAmount)).toBe(true);
      expect(hand.players.reduce((sum, player) => sum + player.startingStack, 0)).toBe(1_100);
      expect(hand.players.reduce((sum, player) => sum + player.endingStack, 0)).toBe(1_100);
      expect((await database.tableSeat.aggregate({ _sum: { stack: true }, where: { roomId: room.id } }))._sum.stack).toBe(1_100);
      expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(29_970);
    } finally {
      await server.realtime.close();
      await server.app.close();
    }
  });

  it("runs nine unique seats with correct first button/blinds/actor and per-user private cards", { timeout: 15_000 }, async () => {
    const users = await Promise.all(
      Array.from({ length: 9 }, (_, index) => createTestIdentity(database, `player${index}`, 10_000)),
    );
    const room = await database.room.create({
      data: { actionTimeSeconds: 15, bigBlind: 20, initialBuyIn: 200, maximumBuyIn: 1_000, maxSeats: 9, minimumBuyIn: 100, name: "九人桌", ownerId: users[0]!.userId, paidCardRevealCost: 0, roomCode: "909090", smallBlind: 10 },
    });
    await database.roomMember.createMany({
      data: users.map((user, index) => ({ role: index === 0 ? "OWNER" as const : "MEMBER" as const, roomId: room.id, userId: user.userId })),
    });
    const runtimes = new TableRuntimeManager();
    const time = new FakeClockScheduler();
    const server = await start(runtimes, time);
    try {
      const playerSockets: Socket[] = [];
      for (const user of users) {
        const socket = connect(server.url, user.cookie);
        sockets.push(socket);
        playerSockets.push(socket);
        await waitForConnect(socket);
      }
      for (let index = 0; index < 9; index += 1) {
        await subscribeAndSeat(playerSockets[index]!, runtimes, room.id, index, 200, index + 1);
      }
      expect(await database.tableSeat.count({ where: { roomId: room.id } })).toBe(9);
      const startResult = await playerSockets[0]!.emitWithAck("table:start", {
        expectedStateVersion: runtimes.get(room.id)!.stateVersion,
        operationId: commandId(1_000_000, 200),
        roomId: room.id,
      });
      expect(startResult.error).toBeUndefined();
      await time.advanceBy(5_000);
      const runtime = runtimes.get(room.id)!;
      const started = runtime.currentHand!.state;
      expect(started).toMatchObject({ bigBlindSeat: 2, buttonSeat: 0, currentActorSeat: 3, smallBlindSeat: 1 });

      const projections: TableStateProjection[] = [];
      for (const socket of playerSockets) {
        projections.push((await socket.emitWithAck("table:request-state", { roomId: room.id })).data as TableStateProjection);
      }
      const privateCards = projections.map((state) => state.hand!.ownHoleCards);
      expect(privateCards.every((cards) => cards.length === 2)).toBe(true);
      expect(new Set(privateCards.flat()).size).toBe(18);
      for (const [recipientIndex, state] of projections.entries()) {
        const payload = JSON.stringify(state);
        for (const [ownerIndex, cards] of privateCards.entries()) {
          if (ownerIndex === recipientIndex) continue;
          expect(payload).not.toContain(JSON.stringify(cards[0]));
          expect(payload).not.toContain(JSON.stringify(cards[1]));
        }
        expect(payload).not.toMatch(/remainingDeck|"deck"|futureBoard/i);
      }

      let folds = 0;
      while (runtime.currentHand) {
        folds += 1;
        if (folds > 8) throw new Error("nine-player fold sequence did not complete");
        const actorSeat = runtime.currentHand.state.currentActorSeat!;
        const result = await playerSockets[actorSeat]!.emitWithAck("action:submit", {
          action: { type: "fold" },
          clientActionId: commandId(3_000_000, folds),
          expectedStateVersion: runtime.stateVersion,
          handId: runtime.currentHand.state.handId,
          roomId: room.id,
        });
        expect(result.error).toBeUndefined();
      }
      expect(folds).toBe(8);
      const hand = await database.handRecord.findFirstOrThrow({ include: { actions: true, players: true }, where: { roomId: room.id } });
      expect(hand.players).toHaveLength(9);
      expect(hand.actions).toHaveLength(8);
      expect(hand.players.reduce((sum, player) => sum + player.startingStack, 0)).toBe(1_800);
      expect(hand.players.reduce((sum, player) => sum + player.endingStack, 0)).toBe(1_800);
      expect((await database.tableSeat.aggregate({ _sum: { stack: true }, where: { roomId: room.id } }))._sum.stack).toBe(1_800);
      expect((await database.wallet.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(89_910);
    } finally {
      await server.realtime.close();
      await server.app.close();
    }
  });
});
