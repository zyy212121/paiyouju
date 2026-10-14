import { appendFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { DatabaseClient } from "../../db/client.js";
import type { RuntimeAuthorityState } from "./runtime/runtime-authority-state.js";
import { serializeRuntimeAuthority } from "./snapshot/snapshot-codec.js";

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
export const ADMINISTRATOR_ROOM_LOG_DIRECTORY = join(repositoryRoot, "room-logs");
export const ADMINISTRATOR_ROOM_CONNECTION_PROBE_CHANGE_ID = "WP-PROBE-20260829-01";

interface AdministratorRoomOwnerProjection {
  readonly owner: { readonly role: "ADMIN" | "USER" };
}

interface RoomLogMetadata {
  readonly roomCode: string;
  readonly roomId: string;
}

interface CommandLogInput {
  readonly acknowledgement: unknown;
  readonly actorUserId: string;
  readonly eventName: string;
  readonly handId?: string | null;
  readonly payload: unknown;
  readonly receivedAt: Date;
  readonly roomId: string;
}

export type AdministratorRoomProbeEventName =
  | "HAND_START_COUNTDOWN"
  | "HAND_START_GATE"
  | "SESSION_REJECTED"
  | "SOCKET_DISCONNECTED"
  | "SOCKET_SUBSCRIBED"
  | "STATE_REQUESTED";

type ProbePayloadValue = boolean | number | string | null | readonly number[] | readonly string[];

interface ConnectionProbeLogInput {
  readonly createdAt: Date;
  readonly eventName: AdministratorRoomProbeEventName;
  readonly handId?: string | null;
  readonly payload: Readonly<Record<string, ProbePayloadValue>>;
  readonly roomId: string;
  readonly stateVersion: number;
}

interface RoomFileDiagnosticLogOptions {
  readonly connectionProbesEnabled?: boolean;
  readonly directory?: string;
  readonly enabled?: boolean;
}

export function isAdministratorOwnedRoom(room: AdministratorRoomOwnerProjection): boolean {
  return room.owner.role === "ADMIN";
}

export function administratorRoomLogFileName(roomCode: string, roomId: string): string {
  if (!/^\d{6}$/u.test(roomCode) || !/^[A-Za-z0-9_-]{1,80}$/u.test(roomId)) {
    throw new Error("administrator room log identifier is invalid");
  }
  return `admin-room-${roomCode}-${roomId}.ndjson`;
}

export async function deleteAdministratorRoomLog(roomCode: string, roomId: string): Promise<void> {
  await rm(join(ADMINISTRATOR_ROOM_LOG_DIRECTORY, administratorRoomLogFileName(roomCode, roomId)), { force: true });
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value, (_key, candidate: unknown) => typeof candidate === "bigint" ? candidate.toString() : candidate)}\n`;
}

export function createRoomFileDiagnosticLog(
  database: DatabaseClient,
  options: RoomFileDiagnosticLogOptions = {},
) {
  const directory = options.directory ?? ADMINISTRATOR_ROOM_LOG_DIRECTORY;
  const metadataByRoom = new Map<string, RoomLogMetadata | null>();
  const probeSequenceByRoom = new Map<string, number>();
  const probeRunId = randomUUID();
  const writesByRoom = new Map<string, Promise<void>>();

  async function metadata(roomId: string): Promise<RoomLogMetadata | null> {
    if (metadataByRoom.has(roomId)) return metadataByRoom.get(roomId) ?? null;
    const room = await database.room.findUnique({
      select: { id: true, owner: { select: { role: true } }, roomCode: true },
      where: { id: roomId },
    });
    const result = room && isAdministratorOwnedRoom(room)
      ? { roomCode: room.roomCode, roomId: room.id }
      : null;
    metadataByRoom.set(roomId, result);
    return result;
  }

  async function enqueue(room: RoomLogMetadata, entry: unknown): Promise<void> {
    const path = join(directory, administratorRoomLogFileName(room.roomCode, room.roomId));
    const previous = writesByRoom.get(room.roomId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, jsonLine(entry), { encoding: "utf8", flag: "a" });
    });
    writesByRoom.set(room.roomId, next);
    await next;
  }

  return {
    async deleteRoomLog(roomId: string): Promise<void> {
      const room = await metadata(roomId);
      await writesByRoom.get(roomId)?.catch(() => undefined);
      writesByRoom.delete(roomId);
      metadataByRoom.delete(roomId);
      probeSequenceByRoom.delete(roomId);
      if (!room) return;
      await rm(join(directory, administratorRoomLogFileName(room.roomCode, room.roomId)), { force: true });
    },

    async flush(): Promise<void> {
      await Promise.allSettled([...writesByRoom.values()]);
    },

    async recordCommand(input: CommandLogInput): Promise<boolean> {
      if (options.enabled === false) return false;
      const room = await metadata(input.roomId);
      if (!room) return false;
      await enqueue(room, {
        actorUserId: input.actorUserId,
        createdAt: input.receivedAt.toISOString(),
        eventName: input.eventName,
        handId: input.handId ?? null,
        kind: "COMMAND",
        payload: { acknowledgement: input.acknowledgement, command: input.payload },
        roomCode: room.roomCode,
        roomId: room.roomId,
      });
      return true;
    },

    async recordProbe(input: ConnectionProbeLogInput): Promise<boolean> {
      if (options.enabled === false || !options.connectionProbesEnabled) return false;
      const room = await metadata(input.roomId);
      if (!room) return false;
      const probeSequence = (probeSequenceByRoom.get(room.roomId) ?? 0) + 1;
      probeSequenceByRoom.set(room.roomId, probeSequence);
      await enqueue(room, {
        changeId: ADMINISTRATOR_ROOM_CONNECTION_PROBE_CHANGE_ID,
        createdAt: input.createdAt.toISOString(),
        eventName: input.eventName,
        handId: input.handId ?? null,
        kind: "CONNECTION_PROBE",
        payload: input.payload,
        probeSchemaVersion: 1,
        probeRunId,
        probeSequence,
        roomCode: room.roomCode,
        roomId: room.roomId,
        stateVersion: input.stateVersion,
      });
      return true;
    },

    async recordSnapshot(state: RuntimeAuthorityState, createdAt: Date): Promise<boolean> {
      if (options.enabled === false) return false;
      const room = await metadata(state.room.roomId);
      if (!room) return false;
      await enqueue(room, {
        createdAt: createdAt.toISOString(),
        handId: state.currentHand?.state.handId ?? null,
        kind: "SNAPSHOT",
        payload: serializeRuntimeAuthority(state),
        roomCode: room.roomCode,
        roomId: room.roomId,
        snapshotRevision: state.snapshotRevision,
        stateVersion: state.stateVersion,
      });
      return true;
    },
  };
}

export type RoomFileDiagnosticLog = ReturnType<typeof createRoomFileDiagnosticLog>;
