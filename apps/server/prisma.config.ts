import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({
  path: process.env.WEPOKER_ENV_FILE ?? "../../.env",
  quiet: true,
});

const localDevelopmentUrl =
  "postgresql://wepoker:wepoker_local_only@localhost:5432/wepoker?schema=public";

const shadowDatabase = process.env.SHADOW_DATABASE_URL
  ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
  : {};

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? localDevelopmentUrl,
    ...shadowDatabase,
  },
});
