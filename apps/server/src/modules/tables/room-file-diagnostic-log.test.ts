import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "../../db/client.js";
import { administratorRoomLogFileName, createRoomFileDiagnosticLog, isAdministratorOwnedRoom } from "./room-file-diagnostic-log.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("administrator room file diagnostics", () => {
  it("logs only rooms owned by an administrator", () => {
    expect(isAdministratorOwnedRoom({ owner: { role: "ADMIN" } })).toBe(true);
    expect(isAdministratorOwnedRoom({ owner: { role: "USER" } })).toBe(false);
  });

  it("uses a bounded local NDJSON filename", () => {
    expect(administratorRoomLogFileName("123456", "room-safe_01")).toBe("admin-room-123456-room-safe_01.ndjson");
    expect(() => administratorRoomLogFileName("12345/", "room")).toThrow();
  });

  it("writes allow-listed connection probes only when enabled for an administrator room", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-probe-"));
    temporaryDirectories.push(directory);
    const findUnique = vi.fn().mockResolvedValue({ id: "room-safe_01", owner: { role: "ADMIN" }, roomCode: "123456" });
    const database = { room: { findUnique } } as unknown as DatabaseClient;
    const enabled = createRoomFileDiagnosticLog(database, { connectionProbesEnabled: true, directory });

    expect(await enabled.recordProbe({
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
      eventName: "HAND_START_GATE",
      handId: null,
      payload: { eligibleSeatCount: 1, outcome: "cancelled", reason: "PREPARED_PARTICIPANTS_BELOW_TWO" },
      roomId: "room-safe_01",
      stateVersion: 8,
    })).toBe(true);
    expect(await enabled.recordProbe({
      createdAt: new Date("2026-08-29T12:00:01.000Z"),
      eventName: "SOCKET_DISCONNECTED",
      payload: { connectionId: "socket-1", disconnectReason: "transport close", userId: "robot-1" },
      roomId: "room-safe_01",
      stateVersion: 9,
    })).toBe(true);
    await enabled.flush();

    const entries = (await readFile(join(directory, administratorRoomLogFileName("123456", "room-safe_01")), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      changeId: "WP-PROBE-20260829-01",
      eventName: "HAND_START_GATE",
      kind: "CONNECTION_PROBE",
      probeSchemaVersion: 1,
      probeSequence: 1,
      roomCode: "123456",
      roomId: "room-safe_01",
      stateVersion: 8,
    });
    expect(entries[1]).toMatchObject({
      changeId: "WP-PROBE-20260829-01",
      eventName: "SOCKET_DISCONNECTED",
      kind: "CONNECTION_PROBE",
      probeSchemaVersion: 1,
      probeSequence: 2,
      roomCode: "123456",
      roomId: "room-safe_01",
      stateVersion: 9,
    });
    expect(JSON.stringify(entries)).not.toMatch(/cookie|password|session|token/i);

    const disabledDirectory = await mkdtemp(join(tmpdir(), "wepoker-probe-disabled-"));
    temporaryDirectories.push(disabledDirectory);
    const disabled = createRoomFileDiagnosticLog(database, { connectionProbesEnabled: false, directory: disabledDirectory });
    expect(await disabled.recordProbe({
      createdAt: new Date("2026-08-29T12:00:01.000Z"),
      eventName: "SOCKET_SUBSCRIBED",
      payload: { userId: "robot-1" },
      roomId: "room-safe_01",
      stateVersion: 9,
    })).toBe(false);

    const userRoomDatabase = {
      room: { findUnique: vi.fn().mockResolvedValue({ id: "room-user_01", owner: { role: "USER" }, roomCode: "654321" }) },
    } as unknown as DatabaseClient;
    const userRoomLog = createRoomFileDiagnosticLog(userRoomDatabase, { connectionProbesEnabled: true, directory });
    expect(await userRoomLog.recordProbe({
      createdAt: new Date("2026-08-29T12:00:02.000Z"),
      eventName: "SOCKET_SUBSCRIBED",
      payload: { connectionId: "socket-user", userId: "user-1" },
      roomId: "room-user_01",
      stateVersion: 1,
    })).toBe(false);
  });

  it("writes no room records when the administrator-room file log master switch is disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-room-log-disabled-"));
    temporaryDirectories.push(directory);
    const findUnique = vi.fn().mockResolvedValue({ id: "room-safe_01", owner: { role: "ADMIN" }, roomCode: "123456" });
    const database = { room: { findUnique } } as unknown as DatabaseClient;
    const disabled = createRoomFileDiagnosticLog(database, {
      connectionProbesEnabled: true,
      directory,
      enabled: false,
    });

    expect(await disabled.recordCommand({
      acknowledgement: { ok: true },
      actorUserId: "admin-1",
      eventName: "action:submit",
      payload: { action: "fold" },
      receivedAt: new Date("2026-08-30T00:00:00.000Z"),
      roomId: "room-safe_01",
    })).toBe(false);
    expect(await disabled.recordProbe({
      createdAt: new Date("2026-08-30T00:00:01.000Z"),
      eventName: "SOCKET_SUBSCRIBED",
      payload: { connectionId: "socket-1", userId: "robot-1" },
      roomId: "room-safe_01",
      stateVersion: 1,
    })).toBe(false);
    expect(await disabled.recordSnapshot({ room: { roomId: "room-safe_01" } } as never, new Date("2026-08-30T00:00:02.000Z"))).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
