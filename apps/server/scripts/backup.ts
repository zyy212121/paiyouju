import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBackupManifest,
  listBackupManifests,
  pruneBackupDirectory,
  resolveBackupDirectory,
  sha256File,
  verifyBackupManifest,
} from "../src/operations/backup.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const productionEnvironmentPath = resolve(
  process.env.WEPOKER_PRODUCTION_ENV_FILE ?? join(repositoryRoot, ".env.production"),
);
dotenv.config({ path: productionEnvironmentPath, quiet: true });

interface CommandSpec {
  readonly args: readonly string[];
  readonly executable: string;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function safeIdentifier(value: string | undefined, label: string): string {
  if (!value || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(value)) {
    throw new Error(`${label} must be a PostgreSQL identifier`);
  }
  return value;
}

function backupDirectory(): string {
  return resolveBackupDirectory(repositoryRoot, process.env.WEPOKER_BACKUP_DIR);
}

function postgresCommand(arguments_: readonly string[], interactive = false): CommandSpec {
  const container = process.env.WEPOKER_POSTGRES_CONTAINER;
  if (container) {
    if (!/^[A-Za-z0-9_.-]+$/u.test(container)) throw new Error("Invalid PostgreSQL container name");
    return {
      args: ["exec", ...(interactive ? ["-i"] : []), container, ...arguments_],
      executable: "docker",
    };
  }
  return {
    args: [
      "compose",
      "--env-file",
      productionEnvironmentPath,
      "-f",
      join(repositoryRoot, "compose.prod.yaml"),
      "exec",
      "-T",
      "postgres",
      ...arguments_,
    ],
    executable: "docker",
  };
}

function safeErrorOutput(chunks: readonly Buffer[]): string {
  return Buffer.concat(chunks).toString("utf8").slice(0, 4_000).replace(
    /postgres(?:ql)?:\/\/[^\s]+/giu,
    "[REDACTED_DATABASE_URL]",
  );
}

async function capture(specification: CommandSpec): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(specification.executable, [...specification.args], {
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
      else reject(new Error(`PostgreSQL command failed (${String(code)}): ${safeErrorOutput(stderr)}`));
    });
  });
}

async function outputToFile(specification: CommandSpec, destination: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(specification.executable, [...specification.args], {
      shell: false,
      windowsHide: true,
    });
    const output = createWriteStream(destination, { flags: "wx" });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.pipe(output);
    child.once("error", reject);
    output.once("error", reject);
    child.once("close", (code) => {
      output.end(() => {
        if (code === 0) resolvePromise();
        else reject(new Error(`pg_dump failed (${String(code)}): ${safeErrorOutput(stderr)}`));
      });
    });
  });
}

async function inputFromFile(specification: CommandSpec, source: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(specification.executable, [...specification.args], {
      shell: false,
      windowsHide: true,
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    const input = createReadStream(source);
    input.once("error", reject);
    input.pipe(child.stdin);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`pg_restore failed (${String(code)}): ${safeErrorOutput(stderr)}`));
    });
  });
}

function log(event: string, details: Readonly<Record<string, unknown>> = {}): void {
  process.stdout.write(`${JSON.stringify({ event, timestamp: new Date().toISOString(), ...details })}\n`);
}

async function latestManifest(directory: string): Promise<string> {
  const records = await listBackupManifests(directory);
  const latest = records[0];
  if (!latest) throw new Error("No valid backup manifests were found");
  return latest.manifestPath;
}

async function selectedManifest(directory: string): Promise<string> {
  const selected = option("--manifest");
  return selected ? resolve(selected) : latestManifest(directory);
}

async function createBackup(): Promise<void> {
  const directory = backupDirectory();
  await mkdir(directory, { recursive: true });
  const databaseName = safeIdentifier(process.env.POSTGRES_DB, "POSTGRES_DB");
  const databaseUser = safeIdentifier(process.env.POSTGRES_USER, "POSTGRES_USER");
  const applicationVersion = process.env.APP_VERSION?.trim();
  if (!applicationVersion) throw new Error("APP_VERSION is required");
  const timestamp = new Date();
  const stamp = timestamp.toISOString().replaceAll(/[-:.]/gu, "");
  const fileName = `wepoker-${stamp}.dump`;
  const dumpPath = join(directory, fileName);
  const partialPath = `${dumpPath}.partial`;
  log("backup.start", { databaseName, fileName });
  try {
    await outputToFile(postgresCommand([
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      `--username=${databaseUser}`,
      `--dbname=${databaseName}`,
    ]), partialPath);
    await rename(partialPath, dumpPath);
    const [postgresVersion, migrationCountRaw, sha256] = await Promise.all([
      capture(postgresCommand(["psql", "-At", `--username=${databaseUser}`, `--dbname=${databaseName}`, "--command=SHOW server_version"])),
      capture(postgresCommand([
        "psql",
        "-At",
        `--username=${databaseUser}`,
        `--dbname=${databaseName}`,
        "--command=SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      ])),
      sha256File(dumpPath),
    ]);
    const manifest = createBackupManifest({
      applicationVersion,
      createdAt: timestamp,
      databaseName,
      fileName,
      migrationCount: Number(migrationCountRaw),
      postgresVersion,
      sha256,
    });
    const manifestPath = `${dumpPath}.manifest.json`;
    const partialManifest = `${manifestPath}.partial`;
    await writeFile(partialManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(partialManifest, manifestPath);
    await verifyBackupManifest(manifestPath);
    log("backup.complete", { fileName, manifestPath, migrationCount: manifest.migrationCount, sha256 });
  } catch (error: unknown) {
    await unlink(partialPath).catch(() => undefined);
    log("backup.failed", { errorCode: "BACKUP_FAILED" });
    throw error;
  }
}

async function listBackups(): Promise<void> {
  const records = await listBackupManifests(backupDirectory());
  process.stdout.write(`${JSON.stringify(records.map(({ manifest, manifestPath }) => ({ manifest, manifestPath })), null, 2)}\n`);
}

async function verifyBackup(): Promise<void> {
  const manifestPath = await selectedManifest(backupDirectory());
  const manifest = await verifyBackupManifest(manifestPath);
  log("backup.verified", { fileName: manifest.fileName, manifestPath, sha256: manifest.sha256 });
}

async function restoreBackup(): Promise<void> {
  const manifestPath = await selectedManifest(backupDirectory());
  const manifest = await verifyBackupManifest(manifestPath);
  const targetDatabase = safeIdentifier(option("--database"), "--database");
  if (!process.argv.includes("--confirm-new-database")) {
    throw new Error("Restore requires --confirm-new-database and never overwrites an existing database");
  }
  if (targetDatabase === manifest.databaseName) {
    throw new Error("Restore target must be a new database, not the source database");
  }
  const databaseUser = safeIdentifier(process.env.POSTGRES_USER, "POSTGRES_USER");
  const existing = await capture(postgresCommand([
    "psql",
    "-At",
    `--username=${databaseUser}`,
    "--dbname=postgres",
    `--command=SELECT COUNT(*) FROM pg_database WHERE datname = '${targetDatabase}'`,
  ]));
  if (existing !== "0") throw new Error("Restore target database already exists");
  const lockPath = `${manifestPath}.restore-lock`;
  await writeFile(lockPath, `${new Date().toISOString()}\n`, { encoding: "utf8", flag: "wx" });
  log("restore.start", { fileName: manifest.fileName, targetDatabase });
  try {
    await capture(postgresCommand(["createdb", `--username=${databaseUser}`, targetDatabase]));
    await inputFromFile(postgresCommand([
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      `--username=${databaseUser}`,
      `--dbname=${targetDatabase}`,
    ], true), join(dirname(manifestPath), manifest.fileName));
    const restoredMigrations = Number(await capture(postgresCommand([
      "psql",
      "-At",
      `--username=${databaseUser}`,
      `--dbname=${targetDatabase}`,
      "--command=SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    ])));
    if (restoredMigrations !== manifest.migrationCount) {
      throw new Error("Restored migration count does not match the backup manifest");
    }
    log("restore.verified", { migrationCount: restoredMigrations, targetDatabase });
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

async function pruneBackups(): Promise<void> {
  const retention = Number(process.env.BACKUP_RETENTION_DAYS ?? "7");
  const result = await pruneBackupDirectory(backupDirectory(), {
    dailyRetention: retention,
    weeklyRetention: 4,
  });
  log("backup.pruned", {
    deletedCount: result.deleted.length,
    keptCount: result.kept.length,
    skippedLockedCount: result.skippedLocked.length,
  });
}

const command = process.argv[2];
try {
  if (command === "create") await createBackup();
  else if (command === "list") await listBackups();
  else if (command === "verify") await verifyBackup();
  else if (command === "restore") await restoreBackup();
  else if (command === "prune") await pruneBackups();
  else throw new Error("Usage: backup.ts <create|list|verify|restore|prune>");
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : "Backup operation failed"}\n`);
  process.exitCode = 1;
}
