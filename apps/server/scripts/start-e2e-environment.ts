import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const testEnvironmentFile = process.env.WEPOKER_E2E_ENV_FILE
  ?? fileURLToPath(new URL("../../../.env.test", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const viteCli = fileURLToPath(new URL("../../web/node_modules/vite/bin/vite.js", import.meta.url));
const corepackCli = join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");

if (!existsSync(testEnvironmentFile)) {
  throw new Error("E2E requires the existing repository-local .env.test file");
}

function runPreparation(label: string, command: string, args: readonly string[], cwd = repoRoot): void {
  process.stdout.write(`[e2e] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, WEPOKER_ENV_FILE: testEnvironmentFile },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${String(result.status)}`);
}

runPreparation("building workspace packages", process.execPath, [corepackCli, "pnpm", "build:workspace-packages"]);
runPreparation(
  "generating the database client",
  process.execPath,
  [corepackCli, "pnpm", "--filter", "@paiyouju/server", "db:generate"],
);
runPreparation("resetting isolated test database", process.execPath, [tsxCli, "apps/server/scripts/reset-test-database.ts"]);
runPreparation(
  "applying migrations to isolated test database",
  process.execPath,
  [corepackCli, "pnpm", "--filter", "@paiyouju/server", "exec", "prisma", "migrate", "deploy"],
);
runPreparation(
  "seeding isolated test database",
  process.execPath,
  [corepackCli, "pnpm", "--filter", "@paiyouju/server", "exec", "prisma", "db", "seed"],
);

const childEnvironment = {
  ...process.env,
  CLIENT_ORIGIN: "http://127.0.0.1:5173",
  HOST: "127.0.0.1",
  LOG_LEVEL: "warn",
  NODE_ENV: "test",
  PORT: "3104",
  TEST_FIXED_DECK: "step6_5_acceptance",
  WEPOKER_SERVER_PORT: "3104",
  WEPOKER_ENV_FILE: testEnvironmentFile,
};
const children: ChildProcess[] = [];
let stopping = false;

function launch(label: string, args: readonly string[], cwd: string): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnvironment,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (stopping) return;
    process.stderr.write(`[e2e] ${label} exited unexpectedly (${String(code ?? signal)})\n`);
    stop(1);
  });
  return child;
}

function stop(exitCode = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  process.exitCode = exitCode;
  const guard = setTimeout(() => process.exit(exitCode), 2_000);
  guard.unref();
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
process.once("SIGHUP", () => stop());

launch("server", [tsxCli, "apps/server/src/index.ts"], repoRoot);
launch("web", [viteCli, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], fileURLToPath(new URL("../../web", import.meta.url)));
process.stdout.write("[e2e] fixed-deck server and web started\n");
