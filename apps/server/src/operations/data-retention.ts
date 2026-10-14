import type { DatabaseClient } from "../db/client.js";
import { deleteRoomDataInTransaction } from "./room-data-deletion.js";

const DAY_MS = 86_400_000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export const DATA_RETENTION_DAYS = 30 as const;

export interface DataRetentionResult {
  readonly auditLogs: number;
  readonly closedRooms: number;
  readonly cutoff: Date;
  readonly idempotencyRecords: number;
  readonly retentionDays: number;
  readonly sessions: number;
  readonly walletLedgerEntries: number;
}

interface DataRetentionOptions {
  readonly clock?: () => Date;
  readonly retentionDays?: number;
}

interface RetentionCallbacks {
  readonly onCompleted?: (result: DataRetentionResult) => void;
  readonly onError?: (error: unknown) => void;
}

export function createDataRetentionService(
  database: DatabaseClient,
  options: DataRetentionOptions = {},
) {
  const clock = options.clock ?? (() => new Date());
  const retentionDays = options.retentionDays ?? DATA_RETENTION_DAYS;
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > DATA_RETENTION_DAYS) {
    throw new Error(`retentionDays must be an integer between 1 and ${DATA_RETENTION_DAYS}`);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<DataRetentionResult> | null = null;

  async function purge(): Promise<DataRetentionResult> {
    const now = clock();
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    return database.$transaction(async (transaction) => {
      const expiredRooms = await transaction.room.findMany({
        select: { id: true },
        where: { closedAt: { lt: cutoff }, status: "CLOSED" },
      });
      const roomIds = expiredRooms.map((room) => room.id);

      if (roomIds.length > 0) {
        await deleteRoomDataInTransaction(transaction, roomIds);
      }

      const auditLogs = await transaction.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      const idempotencyRecords = await transaction.requestIdempotency.deleteMany({ where: { createdAt: { lt: cutoff } } });
      const sessions = await transaction.userSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { not: null } },
          ],
        },
      });
      const walletLedgerEntries = await transaction.$executeRaw`
        DELETE FROM "WalletLedgerEntry" AS wallet_entry
        WHERE wallet_entry."createdAt" < ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "TableStackLedgerEntry" AS table_entry
            WHERE table_entry."walletLedgerEntryId" = wallet_entry."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "PaidCardReveal" AS purchase
            WHERE purchase."walletLedgerEntryId" = wallet_entry."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "PaidHandRevealPurchase" AS purchase
            WHERE purchase."walletLedgerEntryId" = wallet_entry."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "HypotheticalRunoutPurchase" AS purchase
            WHERE purchase."walletLedgerEntryId" = wallet_entry."id"
          )
      `;

      return {
        auditLogs: auditLogs.count,
        closedRooms: roomIds.length,
        cutoff,
        idempotencyRecords: idempotencyRecords.count,
        retentionDays,
        sessions: sessions.count,
        walletLedgerEntries,
      };
    }, { maxWait: 5_000, timeout: 120_000 });
  }

  function runOnce(): Promise<DataRetentionResult> {
    running ??= purge().finally(() => { running = null; });
    return running;
  }

  return {
    runOnce,
    start(callbacks: RetentionCallbacks = {}): void {
      if (timer) return;
      timer = setInterval(() => {
        void runOnce().then(callbacks.onCompleted, callbacks.onError);
      }, SWEEP_INTERVAL_MS);
      timer.unref?.();
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
