import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createBackupManifest,
  pruneBackupDirectory,
  readBackupManifest,
  sha256File,
  verifyBackupManifest,
} from "./backup.js";

async function fixtureBackup(directory: string, createdAt: Date, suffix: string) {
  const fileName = `wepoker-${suffix}.dump`;
  const dumpPath = join(directory, fileName);
  await writeFile(dumpPath, `fixture-${suffix}`, "utf8");
  const manifest = createBackupManifest({
    applicationVersion: "7.0.0-test",
    createdAt,
    databaseName: "wepoker_test",
    fileName,
    migrationCount: 17,
    postgresVersion: "17.6",
    sha256: await sha256File(dumpPath),
  });
  const manifestPath = join(directory, `${fileName}.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dumpPath, manifestPath };
}

describe("backup operations", () => {
  it("creates and verifies a password-free versioned manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const fixture = await fixtureBackup(directory, new Date("2026-08-25T10:00:00.000Z"), "valid");
    const manifest = await verifyBackupManifest(fixture.manifestPath);
    expect(manifest).toMatchObject({
      applicationVersion: "7.0.0-test",
      databaseName: "wepoker_test",
      migrationCount: 17,
      postgresVersion: "17.6",
      protocolVersion: 9,
    });
    expect(JSON.stringify(manifest)).not.toMatch(/password|postgresql:\/\//iu);
  });

  it("continues to verify protocol-v5 manifests created before the squid upgrade", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const fixture = await fixtureBackup(directory, new Date("2026-08-25T10:00:00.000Z"), "protocol-v5");
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    manifest.protocolVersion = 5;
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyBackupManifest(fixture.manifestPath)).resolves.toMatchObject({ protocolVersion: 5 });
  });

  it("continues to verify protocol-v6 manifests created before run-it-twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const fixture = await fixtureBackup(directory, new Date("2026-08-30T01:00:00.000Z"), "protocol-v6");
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    manifest.protocolVersion = 6;
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyBackupManifest(fixture.manifestPath)).resolves.toMatchObject({ protocolVersion: 6 });
  });

  it("continues to verify protocol-v7 manifests created before short deck", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const fixture = await fixtureBackup(directory, new Date("2026-08-30T08:00:00.000Z"), "protocol-v7");
    const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8")) as Record<string, unknown>;
    manifest.protocolVersion = 7;
    await writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    await expect(verifyBackupManifest(fixture.manifestPath)).resolves.toMatchObject({ protocolVersion: 7 });
  });

  it("rejects a corrupted dump and manifest path traversal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const fixture = await fixtureBackup(directory, new Date(), "corrupt");
    await writeFile(fixture.dumpPath, "corrupted-after-manifest", "utf8");
    await expect(verifyBackupManifest(fixture.manifestPath)).rejects.toThrow(/SHA-256/u);

    const parsed = await readBackupManifest(fixture.manifestPath);
    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ ...parsed, fileName: "../outside.dump" }),
      "utf8",
    );
    await expect(verifyBackupManifest(fixture.manifestPath)).rejects.toThrow();
  });

  it("prunes only valid unlocked backup pairs and leaves unknown files alone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wepoker-backup-"));
    const now = new Date("2026-08-25T12:00:00.000Z");
    const fixtures = [];
    for (let index = 0; index < 10; index += 1) {
      fixtures.push(await fixtureBackup(
        directory,
        new Date(now.getTime() - index * 24 * 60 * 60 * 1_000),
        String(index).padStart(2, "0"),
      ));
    }
    await writeFile(join(directory, "operator-notes.txt"), "do not delete", "utf8");
    await writeFile(`${fixtures[9]!.manifestPath}.restore-lock`, "active restore", "utf8");

    const result = await pruneBackupDirectory(directory, {
      dailyRetention: 3,
      now,
      weeklyRetention: 1,
    });
    expect(result.deleted.length).toBeGreaterThan(0);
    expect(await readFile(join(directory, "operator-notes.txt"), "utf8")).toBe("do not delete");
    expect(await readFile(fixtures[9]!.dumpPath, "utf8")).toContain("fixture");
    expect(result.skippedLocked).toContain(fixtures[9]!.manifestPath);
  });
});
