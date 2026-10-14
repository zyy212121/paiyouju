import dotenv from "dotenv";

import { loadEnvironment, resolveRootEnvironmentPath } from "../src/config/environment.js";
import { createDatabaseClient } from "../src/db/client.js";
import { runDataAudit } from "../src/operations/data-audit.js";

dotenv.config({
  path: process.env.WEPOKER_ENV_FILE ?? resolveRootEnvironmentPath(import.meta.url),
  quiet: true,
});

let database: ReturnType<typeof createDatabaseClient> | undefined;
function safeDatabaseErrorDetails(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as { readonly code?: unknown; readonly meta?: unknown };
  const details: Record<string, unknown> = {};
  if (typeof candidate.code === "string") details.databaseClientCode = candidate.code;
  if (typeof candidate.meta === "object" && candidate.meta !== null) {
    const meta = candidate.meta as { readonly code?: unknown; readonly message?: unknown };
    if (typeof meta.code === "string") details.databaseCode = meta.code;
    if (typeof meta.message === "string") {
      details.databaseMessage = meta.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]");
    }
  }
  return details;
}

try {
  const environment = loadEnvironment();
  database = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
  const report = await runDataAudit(database);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
} catch (error: unknown) {
  process.stderr.write(`${JSON.stringify({
    ...safeDatabaseErrorDetails(error),
    errorCode: "DATA_AUDIT_FAILED",
    message: error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]") : "Data audit failed",
  })}\n`);
  process.exitCode = 1;
} finally {
  await database?.$disconnect();
}
