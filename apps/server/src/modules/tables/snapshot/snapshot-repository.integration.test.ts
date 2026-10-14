import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseClient } from "../../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../../integration/database.js";
import { TableRuntime } from "../runtime/table-runtime.js";
import { captureRuntimeAuthority } from "../runtime/runtime-authority-state.js";
import { createSnapshotRepository } from "./snapshot-repository.js";

describe("table snapshot repository", () => {
  let database: DatabaseClient;

  beforeAll(() => { database = createIntegrationDatabase(); });
  beforeEach(async () => clearIntegrationDatabase(database));
  afterAll(async () => database.$disconnect());

  async function fixture() {
    const owner = await createTestIdentity(database, "snapshot-owner", 1_000);
    const room = await database.room.create({ data: { actionTimeSeconds: 30, bigBlind: 20, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "快照", ownerId: owner.userId, paidCardRevealCost: 0, roomCode: "919191", smallBlind: 10 } });
    const runtime = new TableRuntime({ actionTimeSeconds: room.actionTimeSeconds, bigBlind: room.bigBlind, durationMinutes: room.durationMinutes, expiresAt: room.expiresAt, maximumBuyIn: room.maximumBuyIn, maxSeats: room.maxSeats, minimumBuyIn: room.minimumBuyIn, name: room.name, nextHandPaused: room.nextHandPaused, roomCode: room.roomCode, roomId: room.id, smallBlind: room.smallBlind, status: room.status });
    runtime.hydrated = true;
    return { room, runtime };
  }

  it("creates once and advances revisions with compare-and-set", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    const initial = captureRuntimeAuthority(runtime);
    await snapshots.createInitial(initial);

    const next = { ...initial, stateVersion: 1 };
    const committed = await snapshots.persist(next, 0);

    expect(committed.snapshotRevision).toBe(1);
    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({ snapshotRevision: 1, stateVersion: 1 });
    await expect(snapshots.persist({ ...next, stateVersion: 2 }, 0)).rejects.toMatchObject({ code: "SNAPSHOT_CONFLICT" });
    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({ snapshotRevision: 1, stateVersion: 1 });
  });

  it("locks, writes, and rolls back together with the caller transaction", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    const initial = captureRuntimeAuthority(runtime);
    await snapshots.createInitial(initial);

    await expect(database.$transaction(async (transaction) => {
      const locked = await snapshots.lock(room.id, transaction);
      expect(locked?.snapshotRevision).toBe(0);
      await snapshots.persist({ ...initial, stateVersion: 1 }, 0, transaction);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");

    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({ snapshotRevision: 0, stateVersion: 0 });
  });

  it("stores only a safe recovery summary", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    await snapshots.createInitial(captureRuntimeAuthority(runtime));
    await snapshots.markRecoveryError(room.id, "unsupported-schema-version");
    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({ lastRecoveryError: "unsupported-schema-version", recoveryStatus: "ERROR", runtimeStatus: "RECOVERY_ERROR" });
  });

  it("clears an obsolete recovery error when the next authoritative snapshot commits", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    const initial = captureRuntimeAuthority(runtime);
    await snapshots.createInitial(initial);
    await snapshots.markRecoveryError(room.id, "payload-schema:room.durationMinutes");

    await snapshots.persist({ ...initial, stateVersion: 1 }, 0);

    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({
      lastRecoveryError: null,
      recoveryStatus: "READY",
      runtimeStatus: "IDLE",
      stateVersion: 1,
    });
  });

  it("clears an obsolete recovery marker even when recovery needs no state transition", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    await snapshots.createInitial(captureRuntimeAuthority(runtime));
    await snapshots.markRecoveryError(room.id, "payload-schema:room.durationMinutes");

    await snapshots.markRecoveryReady(room.id, "IDLE", 0, 0);

    expect(await database.tableSnapshot.findUnique({ where: { roomId: room.id } })).toMatchObject({
      lastRecoveryError: null,
      recoveryStatus: "READY",
      runtimeStatus: "IDLE",
      snapshotRevision: 0,
    });
  });

  it("re-reads the newer row after a stale compare-and-set conflict", async () => {
    const { room, runtime } = await fixture();
    const snapshots = createSnapshotRepository(database);
    const initial = captureRuntimeAuthority(runtime);
    await snapshots.createInitial(initial);
    await snapshots.persist({ ...initial, stateVersion: 1 }, 0);

    await expect(snapshots.persist({ ...initial, stateVersion: 2 }, 0)).rejects.toMatchObject({ code: "SNAPSHOT_CONFLICT" });
    expect(await snapshots.find(room.id)).toMatchObject({ snapshotRevision: 1, stateVersion: 1 });
  });
});
