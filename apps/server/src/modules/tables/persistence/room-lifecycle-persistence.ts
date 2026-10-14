import type { RoomLifecycleMutation } from "../../../app.js";
import type { DatabaseClient } from "../../../db/client.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { applyRuntimeAuthority, captureRuntimeAuthority, type RuntimeAuthorityState } from "../runtime/runtime-authority-state.js";
import type { TableRuntimeManager } from "../runtime/table-runtime-manager.js";
import type { RuntimeRoomConfig } from "../runtime/types.js";
import { createSnapshotRepository } from "../snapshot/snapshot-repository.js";
import { ApiError } from "../../../http/api-error.js";
import { finalizeRoomGameSessions } from "../table-session-lifecycle.js";

function roomConfig(room: RoomLifecycleMutation): RuntimeRoomConfig {
  return {
    actionTimeSeconds: room.actionTimeSeconds,
    bigBlind: room.bigBlind,
    bombPotBlindMultiplier: room.bombPotBlindMultiplier,
    bombPotIntervalMinutes: room.bombPotIntervalMinutes,
    bombPotNextAt: room.bombPotNextAt,
    durationMinutes: room.durationMinutes,
    expiresAt: room.expiresAt,
    initialBuyIn: room.initialBuyIn,
    maximumBuyIn: room.maximumBuyIn,
    maxSeats: room.maxSeats,
    minimumBuyIn: room.minimumBuyIn,
    name: room.name,
    nextHandPaused: room.nextHandPaused,
    ownerId: room.ownerId,
    paidCardRevealCost: room.paidCardRevealCost,
    paidCardRevealEnabled: room.paidCardRevealEnabled,
    roomCode: room.roomCode,
    roomId: room.id,
    requiresManualStart: room.requiresManualStart,
    runItTwiceEnabled: room.runItTwiceEnabled,
    smallBlind: room.smallBlind,
    specialMode: room.specialMode,
    status: room.status,
    squidRoundGraceEndsAt: room.squidRoundGraceEndsAt,
    squidRoundNumber: room.squidRoundNumber,
    squidSettlementPending: room.squidSettlementPending,
    squidStake: room.squidStake,
    tableStartedAt: room.tableStartedAt,
  };
}

export function createRoomLifecyclePersistence(
  database: DatabaseClient,
  runtimes: TableRuntimeManager,
) {
  const snapshots = createSnapshotRepository(database);
  const pending = new Map<string, RuntimeAuthorityState>();

  return {
    async onRoomUpdating(
      roomId: string,
      _action: "CLOSE" | "PAUSE" | "RESUME",
      room: RoomLifecycleMutation,
      transaction: Prisma.TransactionClient,
      administrator: boolean,
    ): Promise<void> {
      const runtime = runtimes.get(roomId);
      if (!runtime?.hydrated) return;
      if (runtime.status === "RECOVERY_ERROR") {
        if (_action !== "CLOSE" || !administrator) {
          throw new ApiError(409, "RECOVERY_ERROR", "牌桌恢复失败，已暂停操作");
        }
        const snapshot = await snapshots.lock(roomId, transaction);
        if (!snapshot || snapshot.recoveryStatus !== "ERROR" || snapshot.runtimeStatus !== "RECOVERY_ERROR") {
          throw new ApiError(409, "RECOVERY_STATE_CHANGED", "牌桌恢复状态已经变化，请刷新后重试");
        }
        const closedAt = new Date();
        await finalizeRoomGameSessions(transaction, {
          closedAt,
          reason: `recovery-error-close:${roomId}:${snapshot.snapshotRevision}`,
          roomId,
        });
        const closedRoom = await transaction.room.update({
          data: {
            closedAt,
            requiresManualStart: true,
            status: "CLOSED",
            tableStartedAt: null,
          },
          where: { id: roomId },
        });
        const committed = await snapshots.persist({
          currentHand: null,
          handNumber: snapshot.activeHandNumber ?? runtime.handNumber,
          lastButtonSeat: null,
          lastCompletedHand: null,
          postHandReview: null,
          room: roomConfig(closedRoom),
          seats: [],
          snapshotRevision: snapshot.snapshotRevision,
          startCountdownAt: null,
          stateVersion: snapshot.stateVersion + 1,
          status: "CLOSED",
        }, snapshot.snapshotRevision, transaction);
        pending.set(roomId, committed);
        return;
      }
      const persistenceFailed = runtime.status === "PERSISTENCE_ERROR";
      const committed = await snapshots.persistRoomLifecycle(
        captureRuntimeAuthority(runtime),
        roomConfig(room),
        transaction,
        { preserveRuntimeStatus: persistenceFailed },
      );
      pending.set(roomId, committed);
    },

    async runRoomMutation<T>(roomId: string, mutation: () => Promise<T>): Promise<T> {
      const runtime = runtimes.get(roomId);
      if (!runtime?.hydrated) return mutation();
      return runtime.queue.run(async () => {
        pending.delete(roomId);
        try {
          const result = await mutation();
          const committed = pending.get(roomId);
          if (committed) applyRuntimeAuthority(runtime, committed);
          return result;
        } finally {
          pending.delete(roomId);
        }
      });
    },
  };
}
