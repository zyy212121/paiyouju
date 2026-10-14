import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import { loadEnvironment } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import { clearIntegrationDatabase, createIntegrationDatabase, createTestIdentity } from "../../integration/database.js";

const origin = "http://localhost:5173";

describe("administrator recovery controls", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: DatabaseClient;
  let cookie: string;
  let roomId: string;

  beforeAll(async () => {
    database = createIntegrationDatabase();
    app = await buildApp({ database, environment: loadEnvironment(), logger: false, rateLimit: false });
    await app.ready();
  });

  beforeEach(async () => {
    await clearIntegrationDatabase(database);
    const admin = await createTestIdentity(database, "recovery-admin", 1_000);
    await database.user.update({ data: { role: "ADMIN" }, where: { id: admin.userId } });
    cookie = admin.cookie;
    const room = await database.room.create({
      data: {
        actionTimeSeconds: 30,
        bigBlind: 20,
        maximumBuyIn: 2_000,
        maxSeats: 2,
        minimumBuyIn: 400,
        name: "recovery admin room",
        ownerId: admin.userId,
        roomCode: "771155",
        smallBlind: 10,
      },
    });
    roomId = room.id;
    await database.tableSnapshot.create({
      data: {
        activeHandId: "must-not-be-reset",
        activeHandNumber: 9,
        lastRecoveryError: "payload-schema:root",
        payload: {},
        recoveryStatus: "ERROR",
        roomId,
        runtimeStatus: "RECOVERY_ERROR",
        schemaVersion: 2,
        snapshotRevision: 17,
        stateVersion: 23,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await database.$disconnect();
  });

  it("revalidates from database authority without resetting corrupted state", async () => {
    const operationId = randomUUID();
    const response = await app.inject({
      headers: { cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId, reason: "verify corrupted recovery snapshot" },
      url: `/api/admin/recovery/${roomId}/revalidate`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ valid: false });
    expect(response.json().data.safeErrorCode).toMatch(/^payload-schema:/u);
    const snapshot = await database.tableSnapshot.findUniqueOrThrow({ where: { roomId } });
    expect(snapshot).toMatchObject({
      activeHandId: "must-not-be-reset",
      activeHandNumber: 9,
      recoveryStatus: "ERROR",
      runtimeStatus: "RECOVERY_ERROR",
      snapshotRevision: 17,
      stateVersion: 23,
    });
    expect(await database.auditLog.count({ where: { action: "ADMIN_RECOVERY_REVALIDATE", operationId } })).toBe(1);
  });

  it("refuses hydration retry for an invalid snapshot and records the attempt", async () => {
    const operationId = randomUUID();
    const response = await app.inject({
      headers: { cookie, origin, "x-wepoker-request": "1" },
      method: "POST",
      payload: { operationId, reason: "retry corrupted recovery snapshot" },
      url: `/api/admin/recovery/${roomId}/retry`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("RECOVERY_SNAPSHOT_INVALID");
    expect(await database.auditLog.count({ where: { action: "ADMIN_RECOVERY_RETRY", operationId } })).toBe(1);
    const snapshot = await database.tableSnapshot.findUniqueOrThrow({ where: { roomId } });
    expect(snapshot.activeHandId).toBe("must-not-be-reset");
  });
});
