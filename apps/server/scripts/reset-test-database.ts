import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { createDatabaseClient } from "../src/db/client.js";
import { loadEnvironment } from "../src/config/environment.js";

dotenv.config({
  override: true,
  path: process.env.WEPOKER_ENV_FILE ?? fileURLToPath(new URL("../../../.env.test", import.meta.url)),
  quiet: true,
});

const environment = loadEnvironment();
const database = createDatabaseClient(
  environment.DATABASE_URL,
  environment.DATABASE_POOL_MAX,
);
try {
  if (process.env.WEPOKER_E2E_ENV_FILE) {
    const databases = await database.$queryRaw<Array<{ readonly name: string }>>`
      SELECT current_database() AS name
    `;
    if (databases[0]?.name !== "wepoker_test") {
      throw new Error("Refusing Docker E2E reset: connected database is not wepoker_test");
    }
  }
  await database.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
  await database.$executeRawUnsafe('CREATE SCHEMA "public"');
  process.stdout.write("Test database public schema reset\n");
} finally {
  await database.$disconnect();
}
