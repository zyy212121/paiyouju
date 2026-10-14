import dotenv from "dotenv";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { buildApp } from "./app.js";
import { loadEnvironment, resolveRootEnvironmentPath } from "./config.js";
import { createDatabaseClient } from "./db/client.js";
import { attachRealtimeTransport } from "./realtime.js";
import { TableRuntimeManager } from "./modules/tables/runtime/table-runtime-manager.js";
import { createStep65AcceptanceDeck, FixedDeckProvider } from "./modules/tables/runtime/testing.js";
import { createRoomLifecyclePersistence } from "./modules/tables/persistence/room-lifecycle-persistence.js";
import { createReadiness } from "./modules/health/readiness.js";
import { createStandardDeck } from "@paiyouju/poker-core";
import type { TableFaultInjector } from "./testing/fault-injection.js";
import { createDataRetentionService } from "./operations/data-retention.js";

dotenv.config({
  path: process.env.WEPOKER_ENV_FILE ?? resolveRootEnvironmentPath(import.meta.url),
  quiet: true,
});

const environment = loadEnvironment();
const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();
const eventLoopDelay = () => {
  const milliseconds = (nanoseconds: number) => {
    const value = nanoseconds / 1_000_000;
    return Number.isFinite(value) ? Math.round(value * 1_000) / 1_000 : 0;
  };
  const result = {
    maximumMs: milliseconds(eventLoopHistogram.max),
    meanMs: milliseconds(eventLoopHistogram.mean),
    p50Ms: milliseconds(eventLoopHistogram.percentile(50)),
    p95Ms: milliseconds(eventLoopHistogram.percentile(95)),
    p99Ms: milliseconds(eventLoopHistogram.percentile(99)),
  };
  eventLoopHistogram.reset();
  return result;
};
const database = createDatabaseClient(
  environment.DATABASE_URL,
  environment.DATABASE_POOL_MAX,
);
const runtimes = new TableRuntimeManager();
const roomLifecycle = createRoomLifecyclePersistence(database, runtimes);
const readiness = createReadiness(database, runtimes);
const dataRetention = createDataRetentionService(database);
const testDeckProvider = environment.TEST_FIXED_DECK === "standard"
  ? new FixedDeckProvider(createStandardDeck())
  : environment.TEST_FIXED_DECK === "step6_5_acceptance"
    ? new FixedDeckProvider(createStep65AcceptanceDeck())
    : undefined;
const testFaultInjector: TableFaultInjector | undefined = environment.TEST_TABLE_FAULT
  ? {
      hit(point, context) {
        const shouldExit = environment.TEST_TABLE_FAULT === "after-action-snapshot-commit"
          ? point === "afterSnapshotCommitBeforeRuntimeUpdate" && context.transition === "action"
          : environment.TEST_TABLE_FAULT === "after-action-commit-before-broadcast"
            ? point === "afterActionCommitBeforeBroadcast" && context.transition === "action"
          : environment.TEST_TABLE_FAULT === "after-settlement-commit"
            ? point === "afterSettlementCommitBeforeRuntimeUpdate"
            : environment.TEST_TABLE_FAULT === "after-settlement-commit-before-broadcast"
              ? point === "afterSettlementCommitBeforeBroadcast"
            : environment.TEST_TABLE_FAULT === "before-action-receipt-commit"
              ? point === "beforeActionReceiptCommit"
              : point === "beforeSettlementCommit";
        if (shouldExit) process.exit(86);
      },
    }
  : undefined;
const app = await buildApp({
  activeSockets: () => realtime.engine.clientsCount,
  database,
  environment,
  eventLoopDelay,
  logger: { level: environment.LOG_LEVEL },
  onRecoveryRetry: async (roomId) => realtime.recoverRoom(roomId),
  onSessionRevoked: async (sessionId) => realtime.sessionControl.disconnectSession(sessionId),
  onRoomUpdating: roomLifecycle.onRoomUpdating,
  rateLimit: environment.NODE_ENV !== "test",
  readiness,
  runtimes,
  runRoomMutation: roomLifecycle.runRoomMutation,
  serveStatic: environment.NODE_ENV === "production",
});

const realtime = attachRealtimeTransport(app.server, {
  database,
  ...(testDeckProvider === undefined ? {} : { deckProvider: testDeckProvider }),
  environment,
  logger: app.log,
  ...(testFaultInjector === undefined ? {} : { faultInjector: testFaultInjector }),
  runtimes,
});

let stopping = false;
async function stop(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  eventLoopHistogram.disable();
  readiness.markUnready();
  dataRetention.stop();
  app.log.info({ readiness: "unready", signal }, "readiness changed");
  app.log.info({ signal }, "graceful shutdown");
  const deadline = new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("graceful shutdown timeout")), 10_000);
    timer.unref?.();
  });
  try {
    await Promise.race([(async () => {
      await realtime.shutdown();
      await app.close();
      await database.$disconnect();
    })(), deadline]);
  } catch (error: unknown) {
    app.log.error(error);
    process.exitCode = 1;
  }
}
process.once("SIGINT", () => { void stop("SIGINT"); });
process.once("SIGTERM", () => { void stop("SIGTERM"); });

try {
  const [postgres] = await database.$queryRaw<Array<{
    readonly databaseName: string;
    readonly databaseUser: string;
    readonly postgresVersion: string;
  }>>`
    SELECT
      current_database() AS "databaseName",
      current_user AS "databaseUser",
      current_setting('server_version') AS "postgresVersion"
  `;
  app.log.info({
    databaseName: postgres?.databaseName,
    databaseUser: postgres?.databaseUser,
    poolMax: environment.DATABASE_POOL_MAX,
  }, "postgres database connected");
  app.log.info({ postgresVersion: postgres?.postgresVersion }, "postgres version");
  try {
    const retention = await dataRetention.runOnce();
    app.log.info(retention, "application data retention complete");
  } catch (retentionError: unknown) {
    app.log.error({ err: retentionError }, "application data retention failed");
  }
  dataRetention.start({
    onCompleted: (result) => app.log.info(result, "application data retention complete"),
    onError: (retentionError) => app.log.error({ err: retentionError }, "application data retention failed"),
  });
  app.log.info("runtime recovery started");
  const recovery = await realtime.recoverTables();
  readiness.completeRecovery(recovery);
  app.log.info({ ...recovery }, "runtime recovery complete");
  app.log.info({ degradedRooms: recovery.degradedRooms, readiness: "ready" }, "readiness changed");
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error: unknown) {
  app.log.error(error);
  process.exitCode = 1;
  await realtime.shutdown();
  await app.close();
  await database.$disconnect();
}
