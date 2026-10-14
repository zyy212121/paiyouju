import type { DatabaseClient } from "../../db/client.js";
import type { TableRuntimeManager } from "../tables/runtime/table-runtime-manager.js";

const EXPECTED_MIGRATION_COUNT = 18;

export interface ReadinessSnapshot {
  readonly activeRuntimes: number;
  readonly database: "ready" | "unavailable";
  readonly degradedRooms: number;
  readonly recoveryComplete: boolean;
  readonly status: "ready" | "starting" | "unavailable";
  readonly timestamp: string;
}

export function createReadiness(database: DatabaseClient, runtimes: TableRuntimeManager) {
  let recoveryComplete = false;
  let degradedRooms = 0;
  let accepting = true;

  return {
    async snapshot(): Promise<ReadinessSnapshot> {
      let databaseReady: boolean;
      try {
        const migrations = await database.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        `;
        databaseReady = Number(migrations[0]?.count ?? 0) >= EXPECTED_MIGRATION_COUNT;
      } catch {
        databaseReady = false;
      }
      const ready = accepting && recoveryComplete && databaseReady;
      return {
        activeRuntimes: runtimes.size,
        database: databaseReady ? "ready" : "unavailable",
        degradedRooms,
        recoveryComplete,
        status: ready ? "ready" : databaseReady ? "starting" : "unavailable",
        timestamp: new Date().toISOString(),
      };
    },
    completeRecovery(report: { readonly degradedRooms: number }): void {
      degradedRooms = report.degradedRooms;
      recoveryComplete = true;
    },
    markUnready(): void {
      accepting = false;
    },
  };
}

export type Readiness = ReturnType<typeof createReadiness>;
