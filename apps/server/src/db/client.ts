import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export function createDatabaseClient(
  databaseUrl: string,
  poolMaximum = 10,
): DatabaseClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: poolMaximum,
    }),
  });
}
