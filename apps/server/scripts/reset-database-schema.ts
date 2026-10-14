import dotenv from "dotenv";
import { existsSync } from "node:fs";

import { loadEnvironment } from "../src/config/environment.js";
import { createDatabaseClient } from "../src/db/client.js";

const environmentFile = process.env.WEPOKER_ENV_FILE;
if (!environmentFile || !existsSync(environmentFile)) {
  throw new Error("WEPOKER_ENV_FILE must point to an existing ignored environment file");
}

dotenv.config({
  override: true,
  path: environmentFile,
  quiet: true,
});

const expectedDatabase = process.env.WEPOKER_EXPECTED_DATABASE;
if (!expectedDatabase || !/^wepoker_(?:dev|test)$/.test(expectedDatabase)) {
  throw new Error("WEPOKER_EXPECTED_DATABASE must be exactly wepoker_dev or wepoker_test");
}

const environment = loadEnvironment();
const database = createDatabaseClient(environment.DATABASE_URL, environment.DATABASE_POOL_MAX);
try {
  const rows = await database.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (rows[0]?.current_database !== expectedDatabase) {
    throw new Error(`Refusing schema reset: connected database is not ${expectedDatabase}`);
  }
  await database.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
  await database.$executeRawUnsafe('CREATE SCHEMA "public"');
  process.stdout.write(`${expectedDatabase} public schema reset\n`);
} finally {
  await database.$disconnect();
}
