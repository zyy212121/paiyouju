import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../../integration/database.js";
import { createActionReceiptRepository } from "./action-receipt-repository.js";

describe("durable action receipt repository", () => {
  let database: DatabaseClient;
  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  async function fixture() {
    const alice = await createTestIdentity(database, "receipt-alice", 1_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "回执", ownerId: alice.userId, paidCardRevealCost: 0, roomCode: "979797", smallBlind: 10 } });
    return { alice, room };
  }

  it("returns an exact replay and rejects a reused ID with a different fingerprint", async () => {
    const { alice, room } = await fixture();
    const receipts = createActionReceiptRepository(database);
    const clientActionId = "97979797-0000-4000-8000-000000000001";
    const fingerprint = createHash("sha256").update("same-action").digest("hex");
    await receipts.create({ actionType: "FOLD", clientActionId, fingerprint, handId: "97979797-0000-4000-8000-000000000099", result: { alreadyProcessed: false, events: [], stateVersion: 4 }, roomId: room.id, userId: alice.userId });

    await expect(receipts.replayOrConflict({ clientActionId, fingerprint, roomId: room.id, userId: alice.userId })).resolves.toEqual({ alreadyProcessed: true, events: [], stateVersion: 4 });
    await expect(receipts.replayOrConflict({ clientActionId, fingerprint: createHash("sha256").update("different-action").digest("hex"), roomId: room.id, userId: alice.userId })).rejects.toMatchObject({ code: "ACTION_IDEMPOTENCY_CONFLICT" });
  });

  it("rolls back the receipt with its caller transaction", async () => {
    const { alice, room } = await fixture();
    const receipts = createActionReceiptRepository(database);
    const clientActionId = "97979797-0000-4000-8000-000000000002";
    await expect(database.$transaction(async (transaction) => {
      await receipts.create({ actionType: "CHECK", clientActionId, fingerprint: createHash("sha256").update("rollback").digest("hex"), handId: "97979797-0000-4000-8000-000000000098", result: { alreadyProcessed: false, events: [], stateVersion: 5 }, roomId: room.id, userId: alice.userId }, transaction);
      throw new Error("rollback receipt");
    })).rejects.toThrow("rollback receipt");

    expect(await database.tableActionReceipt.count({ where: { clientActionId } })).toBe(0);
  });
});
