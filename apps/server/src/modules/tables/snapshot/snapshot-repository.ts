import type { Prisma } from "../../../generated/prisma/client.js";
import type { DatabaseClient } from "../../../db/client.js";
import { ApiError } from "../../../http/api-error.js";
import type { RuntimeAuthorityState } from "../runtime/runtime-authority-state.js";
import { serializeRuntimeAuthority, type SnapshotRecord } from "./snapshot-codec.js";

type SnapshotClient = DatabaseClient | Prisma.TransactionClient;

function jsonPayload(value: object): Prisma.InputJsonValue {
  return value as Prisma.InputJsonObject;
}

export function createSnapshotRepository(database: DatabaseClient) {
  return {
    async find(roomId: string, client: SnapshotClient = database) {
      return client.tableSnapshot.findUnique({ where: { roomId } });
    },

    async lock(roomId: string, transaction: Prisma.TransactionClient): Promise<SnapshotRecord | null> {
      const locked = await transaction.$queryRaw<Array<{ readonly id: string }>>`
        SELECT "id" FROM "TableSnapshot" WHERE "roomId" = ${roomId} FOR UPDATE
      `;
      if (locked.length === 0) return null;
      const record = await transaction.tableSnapshot.findUniqueOrThrow({ where: { roomId } });
      return record as unknown as SnapshotRecord;
    },

    async createInitial(state: RuntimeAuthorityState, client: SnapshotClient = database) {
      const record = serializeRuntimeAuthority(state);
      return client.tableSnapshot.create({
        data: {
          ...record,
          lastRecoveryError: null,
          payload: jsonPayload(record.payload),
          roomId: state.room.roomId,
          snapshotRevision: state.snapshotRevision,
        },
      });
    },

    async persist(
      state: RuntimeAuthorityState,
      expectedRevision: number,
      client: SnapshotClient = database,
    ) {
      const record = serializeRuntimeAuthority(state);
      const updated = await client.tableSnapshot.updateMany({
        data: {
          ...record,
          lastRecoveryError: null,
          payload: jsonPayload(record.payload),
          snapshotRevision: { increment: 1 },
        },
        where: { roomId: state.room.roomId, snapshotRevision: expectedRevision },
      });
      if (updated.count !== 1) throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌快照已被较新事务更新");
      return { ...state, snapshotRevision: expectedRevision + 1 };
    },

    async persistRoomLifecycle(
      state: RuntimeAuthorityState,
      room: RuntimeAuthorityState["room"],
      transaction: Prisma.TransactionClient,
      options: { readonly preserveRuntimeStatus?: boolean } = {},
    ): Promise<RuntimeAuthorityState> {
      const record = await this.lock(state.room.roomId, transaction);
      if (
        !record
        || record.snapshotRevision !== state.snapshotRevision
        || record.stateVersion !== state.stateVersion
      ) {
        throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌快照已被较新事务更新");
      }
      const status = options.preserveRuntimeStatus
        ? state.status
        : state.currentHand
        ? room.status === "CLOSING" ? "CLOSING" : state.status
        : room.status === "CLOSED"
          ? "CLOSED"
          : room.status === "CLOSING"
            ? "CLOSING"
            : room.nextHandPaused
              ? "PAUSED"
              : "IDLE";
      return this.persist({
        ...state,
        room,
        startCountdownAt: state.currentHand ? state.startCountdownAt : null,
        stateVersion: state.stateVersion + 1,
        status,
      }, state.snapshotRevision, transaction);
    },

    async upsertInitial(state: RuntimeAuthorityState, client: SnapshotClient = database) {
      const existing = await client.tableSnapshot.findUnique({ select: { id: true, snapshotRevision: true }, where: { roomId: state.room.roomId } });
      if (existing) return { ...state, snapshotRevision: existing.snapshotRevision };
      const created = await this.createInitial(state, client);
      return { ...state, snapshotRevision: created.snapshotRevision };
    },

    async markRecoveryError(roomId: string, safeReason: string, client: SnapshotClient = database): Promise<void> {
      await client.tableSnapshot.update({
        data: {
          lastRecoveryError: safeReason.slice(0, 200),
          recoveryStatus: "ERROR",
          runtimeStatus: "RECOVERY_ERROR",
        },
        where: { roomId },
      });
    },

    async markRecoveryReady(
      roomId: string,
      runtimeStatus: RuntimeAuthorityState["status"],
      snapshotRevision: number,
      stateVersion: number,
      client: SnapshotClient = database,
    ): Promise<void> {
      await client.tableSnapshot.updateMany({
        data: { lastRecoveryError: null, recoveryStatus: "READY", runtimeStatus },
        where: { recoveryStatus: "ERROR", roomId, snapshotRevision, stateVersion },
      });
    },
  };
}
