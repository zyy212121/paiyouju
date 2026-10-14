import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { PROTOCOL_VERSION } from "@paiyouju/shared";

export const BACKUP_MANIFEST_SUFFIX = ".dump.manifest.json";
export const BACKUP_PROTOCOL_VERSION = PROTOCOL_VERSION;

export function resolveBackupDirectory(repositoryRoot: string, configured?: string): string {
  const directory = resolve(repositoryRoot, configured ?? "../paiyouju-backups");
  const fromRepository = relative(repositoryRoot, directory);
  if (fromRepository === "" || (fromRepository !== ".." && !fromRepository.startsWith(`..${sep}`) && !isAbsolute(fromRepository))) {
    throw new Error("Backup directory must be outside the repository");
  }
  return directory;
}

export const BackupManifestSchema = z.object({
  applicationVersion: z.string().min(1).max(64),
  createdAt: z.string().datetime({ offset: true }),
  databaseName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u),
  fileName: z.string().regex(/^[A-Za-z0-9_.-]+\.dump$/u),
  manifestVersion: z.literal(1),
  migrationCount: z.number().int().nonnegative(),
  postgresVersion: z.string().min(1).max(64),
  protocolVersion: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8), z.literal(BACKUP_PROTOCOL_VERSION)]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().readonly();

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

interface CreateBackupManifestInput {
  readonly applicationVersion: string;
  readonly createdAt: Date;
  readonly databaseName: string;
  readonly fileName: string;
  readonly migrationCount: number;
  readonly postgresVersion: string;
  readonly sha256: string;
}

export function createBackupManifest(input: CreateBackupManifestInput): BackupManifest {
  return BackupManifestSchema.parse({
    ...input,
    createdAt: input.createdAt.toISOString(),
    manifestVersion: 1,
    protocolVersion: BACKUP_PROTOCOL_VERSION,
  });
}

function safeDumpPath(manifestPath: string, manifest: BackupManifest): string {
  if (basename(manifest.fileName) !== manifest.fileName) {
    throw new Error("Backup manifest contains an unsafe dump path");
  }
  const directory = resolve(dirname(manifestPath));
  const dumpPath = resolve(directory, manifest.fileName);
  if (dirname(dumpPath) !== directory) {
    throw new Error("Backup dump must remain beside its manifest");
  }
  return dumpPath;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function readBackupManifest(manifestPath: string): Promise<BackupManifest> {
  const information = await stat(manifestPath);
  if (!information.isFile() || information.size > 64 * 1_024) {
    throw new Error("Backup manifest is not a bounded regular file");
  }
  const raw = await readFile(manifestPath, "utf8");
  return BackupManifestSchema.parse(JSON.parse(raw) as unknown);
}

export async function verifyBackupManifest(manifestPath: string): Promise<BackupManifest> {
  const manifest = await readBackupManifest(manifestPath);
  const dumpPath = safeDumpPath(manifestPath, manifest);
  const actual = await sha256File(dumpPath);
  if (actual !== manifest.sha256) {
    throw new Error(`Backup SHA-256 mismatch for ${manifest.fileName}`);
  }
  return manifest;
}

function isoWeekKey(date: Date): string {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - weekday);
  const first = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((normalized.getTime() - first.getTime()) / 86_400_000) + 1) / 7);
  return `${normalized.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

interface BackupRecord {
  readonly dumpPath: string;
  readonly manifest: BackupManifest;
  readonly manifestPath: string;
}

async function validBackupRecords(directory: string): Promise<BackupRecord[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const records: BackupRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_MANIFEST_SUFFIX)) continue;
    const manifestPath = join(directory, entry.name);
    try {
      const manifest = await verifyBackupManifest(manifestPath);
      records.push({
        dumpPath: safeDumpPath(manifestPath, manifest),
        manifest,
        manifestPath,
      });
    } catch {
      // Invalid or corrupted pairs are evidence: pruning deliberately leaves them untouched.
    }
  }
  return records.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

export async function listBackupManifests(directory: string): Promise<readonly BackupRecord[]> {
  return validBackupRecords(resolve(directory));
}

export interface PruneBackupOptions {
  readonly dailyRetention: number;
  readonly now?: Date;
  readonly weeklyRetention: number;
}

export interface PruneBackupResult {
  readonly deleted: readonly string[];
  readonly kept: readonly string[];
  readonly skippedLocked: readonly string[];
}

export async function pruneBackupDirectory(
  rawDirectory: string,
  options: PruneBackupOptions,
): Promise<PruneBackupResult> {
  if (!Number.isSafeInteger(options.dailyRetention) || options.dailyRetention < 1) {
    throw new Error("dailyRetention must be a positive integer");
  }
  if (!Number.isSafeInteger(options.weeklyRetention) || options.weeklyRetention < 0) {
    throw new Error("weeklyRetention must be a non-negative integer");
  }
  const directory = resolve(rawDirectory);
  const now = options.now ?? new Date();
  const records = await validBackupRecords(directory);
  const keep = new Set<string>();
  const dailyKeys = new Set<string>();
  const weeklyKeys = new Set<string>();

  for (const record of records) {
    const createdAt = new Date(record.manifest.createdAt);
    if (createdAt.getTime() > now.getTime() + 5 * 60_000) continue;
    const day = record.manifest.createdAt.slice(0, 10);
    if (dailyKeys.size < options.dailyRetention && !dailyKeys.has(day)) {
      dailyKeys.add(day);
      keep.add(record.manifestPath);
    }
    const week = isoWeekKey(createdAt);
    if (weeklyKeys.size < options.weeklyRetention && !weeklyKeys.has(week)) {
      weeklyKeys.add(week);
      keep.add(record.manifestPath);
    }
  }

  const deleted: string[] = [];
  const skippedLocked: string[] = [];
  for (const record of records) {
    if (keep.has(record.manifestPath)) continue;
    try {
      await access(`${record.manifestPath}.restore-lock`);
      skippedLocked.push(record.manifestPath);
      keep.add(record.manifestPath);
      continue;
    } catch {
      // Absence means the pair is eligible for pruning.
    }
    await unlink(record.dumpPath);
    await unlink(record.manifestPath);
    deleted.push(record.manifestPath);
  }

  return {
    deleted,
    kept: records.filter((record) => keep.has(record.manifestPath)).map((record) => record.manifestPath),
    skippedLocked,
  };
}
