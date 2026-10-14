import { describe, expect, it } from "vitest";

import { createReadiness } from "./readiness.js";
import { TableRuntimeManager } from "../tables/runtime/table-runtime-manager.js";

describe("readiness", () => {
  it("stays unavailable before recovery, reports degraded rooms after recovery, and becomes unready for shutdown", async () => {
    const database = { $queryRaw: async () => [{ count: 18n }] };
    const readiness = createReadiness(database as never, new TableRuntimeManager());

    expect(await readiness.snapshot()).toMatchObject({ database: "ready", degradedRooms: 0, recoveryComplete: false, status: "starting" });
    readiness.completeRecovery({ degradedRooms: 2 });
    expect(await readiness.snapshot()).toMatchObject({ database: "ready", degradedRooms: 2, recoveryComplete: true, status: "ready" });
    readiness.markUnready();
    expect(await readiness.snapshot()).toMatchObject({ recoveryComplete: true, status: "starting" });
  });

  it("reports database outage without leaking connection details", async () => {
    const database = { $queryRaw: async () => { throw new Error("password=secret database-url"); } };
    const readiness = createReadiness(database as never, new TableRuntimeManager());
    readiness.completeRecovery({ degradedRooms: 0 });

    const snapshot = await readiness.snapshot();
    expect(snapshot).toMatchObject({ database: "unavailable", status: "unavailable" });
    expect(JSON.stringify(snapshot)).not.toMatch(/password|secret|url/i);
  });

  it("stays unavailable when the database is reachable but migrations are incomplete", async () => {
    const database = { $queryRaw: async () => [{ count: 17n }] };
    const readiness = createReadiness(database as never, new TableRuntimeManager());
    readiness.completeRecovery({ degradedRooms: 0 });

    expect(await readiness.snapshot()).toMatchObject({ database: "unavailable", status: "unavailable" });
  });
});
