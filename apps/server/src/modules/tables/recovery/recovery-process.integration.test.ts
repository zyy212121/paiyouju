import type { PlayerIntent, TableStateProjection } from "@paiyouju/shared";
import { randomInt } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startRecoveryChild, type RecoveryChild } from "../../../../scripts/recovery-test-child.js";
import type { DatabaseClient } from "../../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../../integration/database.js";

interface Identity {
  readonly cookie: string;
  readonly userId: string;
}

interface ProcessTable {
  readonly alice: Identity;
  readonly aliceSocket: Socket;
  readonly bob: Identity;
  readonly bobSocket: Socket;
  readonly child: RecoveryChild;
  readonly port: number;
  readonly roomId: string;
}

const sockets: Socket[] = [];
const children: RecoveryChild[] = [];
let operationSequence = 0;

function commandId(): string {
  operationSequence += 1;
  return `96969696-0000-4000-8000-${String(operationSequence).padStart(12, "0")}`;
}

function connect(url: string, cookie: string): Socket {
  const socket = io(url, { autoConnect: false, extraHeaders: { Cookie: cookie, Origin: "http://localhost:5173" }, forceNew: true, transports: ["websocket"] });
  sockets.push(socket);
  return socket;
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
}

async function waitForState(socket: Socket, roomId: string, predicate: (state: TableStateProjection) => boolean): Promise<TableStateProjection> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await socket.emitWithAck("table:request-state", { roomId });
    if (response.ok && predicate(response.data)) return response.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for table state");
}

function actorFor(table: Pick<ProcessTable, "alice" | "aliceSocket" | "bob" | "bobSocket">, state: TableStateProjection) {
  const actorUserId = state.seats.find((seat) => seat.isCurrentActor)?.userId;
  if (!actorUserId || !state.hand) throw new Error("active actor missing");
  const socket = actorUserId === table.alice.userId ? table.aliceSocket : table.bobSocket;
  return { actorUserId, socket };
}

async function currentState(table: ProcessTable): Promise<TableStateProjection> {
  const response = await table.aliceSocket.emitWithAck("table:request-state", { roomId: table.roomId });
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

async function act(table: ProcessTable, intent: PlayerIntent, clientActionId = commandId()): Promise<{ readonly clientActionId: string; readonly state: TableStateProjection }> {
  const before = await currentState(table);
  const actor = actorFor(table, before);
  const response = await actor.socket.emitWithAck("action:submit", {
    action: intent,
    clientActionId,
    expectedStateVersion: before.stateVersion,
    handId: before.hand!.handId,
    roomId: table.roomId,
  });
  if (!response.ok) throw new Error(`${response.error.code}:${response.error.message}`);
  return { clientActionId, state: await currentState(table) };
}

async function startTable(
  database: DatabaseClient,
  options: { readonly actionTimeSeconds?: 10 | 15 | 20 | 25 | 30 | 35 | 40 | 45; readonly tableFault?: string } = {},
): Promise<ProcessTable> {
  const alice = await createTestIdentity(database, `alice-${commandId().slice(-6)}`, 10_000);
  const bob = await createTestIdentity(database, `bob-${commandId().slice(-6)}`, 10_000);
  const room = await database.room.create({
    data: {
      actionTimeSeconds: options.actionTimeSeconds ?? 45,
      bigBlind: 20,
      maximumBuyIn: 2_000,
      maxSeats: 2,
      minimumBuyIn: 400,
      name: "进程恢复",
      ownerId: alice.userId,
      paidCardRevealCost: 0,
      roomCode: String(100_000 + operationSequence).slice(-6),
      smallBlind: 10,
    },
  });
  await database.roomMember.createMany({ data: [{ role: "OWNER", roomId: room.id, userId: alice.userId }, { role: "MEMBER", roomId: room.id, userId: bob.userId }] });
  const port = randomInt(32_000, 33_000);
  const child = await startRecoveryChild(port, options.tableFault ? { tableFault: options.tableFault } : {});
  children.push(child);
  const aliceSocket = connect(child.baseUrl, alice.cookie);
  const bobSocket = connect(child.baseUrl, bob.cookie);
  await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
  const initial = await aliceSocket.emitWithAck("table:subscribe", { roomId: room.id });
  await bobSocket.emitWithAck("table:subscribe", { roomId: room.id });
  if (!initial.ok) throw new Error(initial.error.message);
  const aliceSeat = await aliceSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: initial.data.stateVersion, operationId: commandId(), roomId: room.id, seatIndex: 0 });
  if (!aliceSeat.ok) throw new Error(aliceSeat.error.message);
  const bobSeat = await bobSocket.emitWithAck("seat:take", { buyInAmount: 400, expectedStateVersion: aliceSeat.stateVersion, operationId: commandId(), roomId: room.id, seatIndex: 1 });
  if (!bobSeat.ok) throw new Error(bobSeat.error.message);
  const started = await aliceSocket.emitWithAck("table:start", { expectedStateVersion: bobSeat.stateVersion, operationId: commandId(), roomId: room.id });
  if (!started.ok) throw new Error(started.error.message);
  await waitForState(aliceSocket, room.id, (state) => state.hand !== null);
  return { alice, aliceSocket, bob, bobSocket, child, port, roomId: room.id };
}

async function crashAndRecover(table: ProcessTable): Promise<ProcessTable> {
  table.aliceSocket.disconnect();
  table.bobSocket.disconnect();
  await table.child.forceKill();
  const child = await startRecoveryChild(table.port);
  children.push(child);
  const aliceSocket = connect(child.baseUrl, table.alice.cookie);
  const bobSocket = connect(child.baseUrl, table.bob.cookie);
  await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
  const aliceState = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
  const bobState = await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
  if (!aliceState.ok || !bobState.ok) throw new Error("recovery subscribe failed");
  return { ...table, aliceSocket, bobSocket, child };
}

describe("real child-process table recovery", () => {
  let database: DatabaseClient;

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    for (const child of children.splice(0)) await child.stop();
  }, 30_000);
  afterAll(async () => database.$disconnect());

  it("R1 force-kills one server and completes the same preflop hand after a fresh process recovers it", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    const before = await currentState(table);
    table = await crashAndRecover(table);
    const recovered = await currentState(table);

    expect(recovered.hand).toMatchObject({ board: before.hand!.board, handId: before.hand!.handId, ownHoleCards: before.hand!.ownHoleCards, street: "preflop", turnDeadlineAt: before.hand!.turnDeadlineAt });
    expect(recovered.stateVersion).toBe(before.stateVersion);
    await act(table, { type: "fold" });
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(1);
    expect(await database.tableStackLedgerEntry.count({ where: { handId: before.hand!.handId, type: "HAND_RESULT" } })).toBe(2);
  });

  it("R2 force-kills on the flop and preserves board, pot, stacks, actor, history, and version through showdown", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    let state = await currentState(table);
    let actionCount = 0;
    while (state.hand?.street === "preflop") {
      actionCount += 1;
      const legal = actorFor(table, state).actorUserId === state.recipient.userId ? state.hand.legalActions : (await table.bobSocket.emitWithAck("table:request-state", { roomId: table.roomId })).data.hand?.legalActions;
      await act(table, legal?.canCheck ? { type: "check" } : { type: "call" });
      state = await currentState(table);
      if (actionCount > 4) throw new Error("preflop did not advance");
    }
    expect(state.hand?.street).toBe("flop");
    const before = state;
    table = await crashAndRecover(table);
    const recovered = await currentState(table);
    expect(recovered).toMatchObject({ stateVersion: before.stateVersion });
    expect(recovered.hand).toMatchObject({ actionHistory: before.hand!.actionHistory, board: before.hand!.board, currentActorSeat: before.hand!.currentActorSeat, handId: before.hand!.handId, mainPot: before.hand!.mainPot, sidePots: before.hand!.sidePots, street: "flop", turnDeadlineAt: before.hand!.turnDeadlineAt });
    expect(recovered.seats.map((seat) => seat.stack)).toEqual(before.seats.map((seat) => seat.stack));
    while (true) {
      state = await currentState(table);
      if (!state.hand || state.hand.currentActorSeat === null || !["PLAYING", "CLOSING"].includes(state.runtimeStatus)) break;
      const actorState = state.hand.legalActions ? state : (await table.bobSocket.emitWithAck("table:request-state", { roomId: table.roomId })).data;
      await act(table, actorState.hand!.legalActions!.canCheck ? { type: "check" } : { type: "call" });
    }
    expect((await database.handRecord.findUniqueOrThrow({ where: { id: before.hand!.handId } })).finishReason).toBe("SHOWDOWN");
  });

  it("R3/R4 keeps a future absolute deadline and executes an expired timeout exactly once", { timeout: 45_000 }, async () => {
    let table = await startTable(database, { actionTimeSeconds: 15 });
    const future = await currentState(table);
    const futureDeadline = Date.parse(future.hand!.turnDeadlineAt!);
    table = await crashAndRecover(table);
    expect((await currentState(table)).hand?.turnDeadlineAt).toBe(future.hand!.turnDeadlineAt);
    expect(futureDeadline - Date.now()).toBeLessThan(15_000);

    table.aliceSocket.disconnect();
    table.bobSocket.disconnect();
    await table.child.forceKill();
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, futureDeadline - Date.now() + 200)));
    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    const afterTimeout = await waitForState(aliceSocket, table.roomId, (state) => state.stateVersion > future.stateVersion);
    const automaticCount = afterTimeout.hand?.actionHistory.filter((event) => event.eventType === "PLAYER_FOLDED" || event.eventType === "PLAYER_CHECKED").length ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect((await currentState(table)).stateVersion).toBe(afterTimeout.stateVersion);
    expect(automaticCount).toBeGreaterThanOrEqual(1);
  });

  it("R5 restores an action committed before broadcast and replays its persistent receipt", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "after-action-snapshot-commit" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    const clientActionId = commandId();
    actor.socket.emit("action:submit", { action: { type: "call" }, clientActionId, expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    const recovered = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    if (!recovered.ok) throw new Error(recovered.error.message);
    expect(recovered.data.stateVersion).toBe(before.stateVersion + 1);
    const replaySocket = actor.actorUserId === table.alice.userId ? table.aliceSocket : table.bobSocket;
    const replay = await replaySocket.emitWithAck("action:submit", { action: { type: "call" }, clientActionId, expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId });
    expect(replay).toMatchObject({ data: { alreadyProcessed: true }, ok: true, stateVersion: before.stateVersion + 1 });
    expect(await database.tableActionReceipt.count({ where: { clientActionId } })).toBe(1);
  });

  it("R5 broadcast fault exits only after the committed action is applied to Runtime", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "after-action-commit-before-broadcast" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    const clientActionId = commandId();
    actor.socket.emit("action:submit", { action: { type: "call" }, clientActionId, expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    expect(await database.tableActionReceipt.count({ where: { clientActionId } })).toBe(1);
    expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: table.roomId } })).toMatchObject({ stateVersion: before.stateVersion + 1 });

    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    const recovered = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    expect(recovered).toMatchObject({ data: { stateVersion: before.stateVersion + 1 }, ok: true });
  });

  it("rolls back both action receipt and snapshot when the process exits before receipt commit", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "before-action-receipt-commit" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    const clientActionId = commandId();
    actor.socket.emit("action:submit", { action: { type: "call" }, clientActionId, expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    expect(await database.tableActionReceipt.count({ where: { clientActionId } })).toBe(0);
    expect(await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: table.roomId } })).toMatchObject({ stateVersion: before.stateVersion });

    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    const retried = await (actor.actorUserId === table.alice.userId ? aliceSocket : bobSocket).emitWithAck("action:submit", { action: { type: "call" }, clientActionId, expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId });
    expect(retried).toMatchObject({ data: { alreadyProcessed: false }, ok: true, stateVersion: before.stateVersion + 1 });
    expect(await database.tableActionReceipt.count({ where: { clientActionId } })).toBe(1);
  });

  it("R6 restores one settlement committed before broadcast without duplicate result rows", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "after-settlement-commit" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    actor.socket.emit("action:submit", { action: { type: "fold" }, clientActionId: commandId(), expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    const walletBefore = await database.wallet.findMany({ orderBy: { userId: "asc" }, where: { userId: { in: [table.alice.userId, table.bob.userId] } } });
    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    const recovered = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    if (!recovered.ok) throw new Error(recovered.error.message);
    expect(recovered.data).toMatchObject({ hand: { handId: before.hand!.handId }, runtimeStatus: "POST_HAND_REVIEW" });
    expect(recovered.data.postHandReviewEndsAt).not.toBeNull();
    await waitForState(aliceSocket, table.roomId, (state) => state.postHandReviewEndsAt === null);
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(1);
    expect(await database.tableStackLedgerEntry.count({ where: { handId: before.hand!.handId, type: "HAND_RESULT" } })).toBe(2);
    const walletAfter = await database.wallet.findMany({ orderBy: { userId: "asc" }, where: { userId: { in: [table.alice.userId, table.bob.userId] } } });
    expect(walletAfter.map((wallet) => wallet.balance)).toEqual(walletBefore.map((wallet) => wallet.balance - 10));
    expect(walletAfter.map((wallet) => wallet.version)).toEqual(walletBefore.map((wallet) => wallet.version + 1));
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "HAND_ENTRY_FEE" } })).toBe(4);
  });

  it("R6 broadcast fault restores the one settlement committed after Runtime update", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "after-settlement-commit-before-broadcast" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    actor.socket.emit("action:submit", { action: { type: "fold" }, clientActionId: commandId(), expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(1);

    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    const recovered = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    expect(recovered).toMatchObject({ data: { hand: { handId: before.hand!.handId }, runtimeStatus: "POST_HAND_REVIEW" }, ok: true });
    if (!recovered.ok) throw new Error(recovered.error.message);
    expect(recovered.data.postHandReviewEndsAt).not.toBeNull();
    await waitForState(aliceSocket, table.roomId, (state) => state.postHandReviewEndsAt === null);
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(1);
    expect(await database.tableStackLedgerEntry.count({ where: { handId: before.hand!.handId, type: "HAND_RESULT" } })).toBe(2);
  });

  it("R7 rolls back a pre-settlement crash and later settles the recovered hand once", { timeout: 30_000 }, async () => {
    let table = await startTable(database, { tableFault: "before-settlement-commit" });
    const before = await currentState(table);
    const actor = actorFor(table, before);
    actor.socket.emit("action:submit", { action: { type: "fold" }, clientActionId: commandId(), expectedStateVersion: before.stateVersion, handId: before.hand!.handId, roomId: table.roomId }, () => undefined);
    expect(await table.child.waitForExit()).toBe(86);
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(0);
    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    await bobSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    expect((await currentState(table)).stateVersion).toBe(before.stateVersion);
    await act(table, { type: "fold" });
    expect(await database.handRecord.count({ where: { id: before.hand!.handId } })).toBe(1);
  });

  it("R8 preserves LEAVE_AFTER_HAND and detaches that stack exactly once after recovery", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    const before = await currentState(table);
    const leavingSeat = before.seats.find((seat) => !seat.isCurrentActor);
    if (!leavingSeat) throw new Error("non-acting player missing");
    const leavingSocket = leavingSeat.userId === table.alice.userId ? table.aliceSocket : table.bobSocket;
    const session = await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: table.roomId, userId: leavingSeat.userId } } });
    const leaving = await leavingSocket.emitWithAck("seat:leave", { expectedStateVersion: before.stateVersion, operationId: commandId(), roomId: table.roomId });
    expect(leaving).toMatchObject({ data: { deferred: true, playStatus: "LEAVE_AFTER_HAND" }, ok: true });
    table = await crashAndRecover(table);
    expect((await currentState(table)).seats.find((seat) => seat.userId === leavingSeat.userId)?.playStatus).toBe("LEAVE_AFTER_HAND");

    await act(table, { type: "fold" });
    expect(await database.tableSeat.findUnique({ where: { roomId_userId: { roomId: table.roomId, userId: leavingSeat.userId } } })).toBeNull();
    const settledPlayer = await database.handPlayerRecord.findUniqueOrThrow({ where: { handId_userId: { handId: before.hand!.handId, userId: leavingSeat.userId } } });
    expect(await database.gameSession.findUniqueOrThrow({ where: { id: session.gameSessionId } })).toMatchObject({ detachedStack: settledPlayer.endingStack, status: "ACTIVE", totalCashOut: 0 });
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "CASH_OUT", userId: leavingSeat.userId } })).toBe(0);
    expect(await database.tableStackLedgerEntry.count({ where: { gameSessionId: session.gameSessionId, type: "CASH_OUT" } })).toBe(0);
  });

  it("R9 preserves SIT_OUT_AFTER_HAND and keeps the table stack out of Wallet after recovery", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    const before = await currentState(table);
    const sittingOut = await table.aliceSocket.emitWithAck("seat:sit-out", { expectedStateVersion: before.stateVersion, operationId: commandId(), roomId: table.roomId });
    expect(sittingOut).toMatchObject({ data: { playStatus: "SIT_OUT_AFTER_HAND" }, ok: true });
    table = await crashAndRecover(table);
    expect((await currentState(table)).seats.find((seat) => seat.userId === table.alice.userId)?.playStatus).toBe("SIT_OUT_AFTER_HAND");

    await act(table, { type: "fold" });
    const seat = await database.tableSeat.findUniqueOrThrow({ where: { roomId_userId: { roomId: table.roomId, userId: table.alice.userId } } });
    expect(seat.playStatus).toBe("SIT_OUT");
    expect(seat.stack).toBeGreaterThanOrEqual(0);
    expect(await database.wallet.findUniqueOrThrow({ where: { userId: table.alice.userId } })).toMatchObject({ balance: 9_990 });
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "CASH_OUT", userId: table.alice.userId } })).toBe(0);
  });

  it("R10 resumes an active CLOSING room and closes every seat once after the hand", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    const before = await currentState(table);
    const response = await fetch(`${table.child.baseUrl}/api/rooms/${table.roomId}/close`, {
      headers: { Cookie: table.alice.cookie, Origin: "http://localhost:5173", "X-Wepoker-Request": "1" },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await waitForState(table.aliceSocket, table.roomId, (state) => state.runtimeStatus === "CLOSING")).toMatchObject({ hand: { handId: before.hand!.handId } });
    table = await crashAndRecover(table);
    const recovered = await currentState(table);
    expect(recovered).toMatchObject({ room: { status: "CLOSING" }, runtimeStatus: "CLOSING" });
    expect(recovered.hand?.handId).toBe(before.hand!.handId);

    await act(table, { type: "fold" });
    await waitForState(table.aliceSocket, table.roomId, (state) => state.room.status === "CLOSED");
    expect(await database.room.findUniqueOrThrow({ where: { id: table.roomId } })).toMatchObject({ status: "CLOSED" });
    expect(await database.tableSeat.count({ where: { roomId: table.roomId } })).toBe(0);
    expect(await database.walletLedgerEntry.count({ where: { relatedRoomId: table.roomId, type: "CASH_OUT" } })).toBe(0);
    expect((await database.wallet.aggregate({ _sum: { balance: true }, where: { userId: { in: [table.alice.userId, table.bob.userId] } } }))._sum.balance).toBe(19_980);
  });

  it("gracefully stops without mutating the durable active hand and a new process resumes it", { timeout: 30_000 }, async () => {
    let table = await startTable(database);
    const before = await currentState(table);
    await table.child.stop();
    const stored = await database.tableSnapshot.findUniqueOrThrow({ where: { roomId: table.roomId } });
    expect(stored).toMatchObject({ activeHandId: before.hand!.handId, stateVersion: before.stateVersion, turnDeadlineAt: new Date(before.hand!.turnDeadlineAt!) });
    const child = await startRecoveryChild(table.port); children.push(child);
    const aliceSocket = connect(child.baseUrl, table.alice.cookie); const bobSocket = connect(child.baseUrl, table.bob.cookie);
    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    table = { ...table, aliceSocket, bobSocket, child };
    const recovered = await aliceSocket.emitWithAck("table:subscribe", { roomId: table.roomId });
    expect(recovered).toMatchObject({ data: { hand: { handId: before.hand!.handId }, stateVersion: before.stateVersion }, ok: true });
  });
});
