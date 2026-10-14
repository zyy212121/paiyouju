import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const composeEnvironmentFile = fileURLToPath(new URL("../../../.env.docker", import.meta.url));
const applicationEnvironmentFile = fileURLToPath(new URL("../../../.env.docker.test", import.meta.url));
const corepackCli = join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");
const composePrefix = ["compose", "--env-file", composeEnvironmentFile] as const;
const e2eMode = process.env.WEPOKER_E2E_MODE ?? "chromium";
if (e2eMode !== "chromium" && e2eMode !== "browsers") {
  throw new Error("WEPOKER_E2E_MODE must be chromium or browsers");
}

function captureDocker(arguments_: readonly string[]): string {
  const result = spawnSync("docker", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `docker ${arguments_.join(" ")} failed`);
  return result.stdout.trim();
}

function run(command: string, arguments_: readonly string[], environment = process.env): Promise<number> {
  return new Promise((resolve, reject) => {
    activeChild = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    activeChild.once("error", reject);
    activeChild.once("exit", (code) => { activeChild = null; resolve(code ?? 1); });
  });
}

let activeChild: ChildProcess | null = null;
let interruptedSignal: "SIGINT" | "SIGTERM" | null = null;
const interrupt = (signal: "SIGINT" | "SIGTERM") => {
  interruptedSignal = signal;
  activeChild?.kill(signal);
};
process.once("SIGINT", () => interrupt("SIGINT"));
process.once("SIGTERM", () => interrupt("SIGTERM"));

const existedBefore = captureDocker([...composePrefix, "ps", "-a", "-q", "postgres-test"]).length > 0;
const ranBefore = captureDocker([...composePrefix, "ps", "-q", "postgres-test"]).length > 0;
let started = false;
let exitCode = 1;

try {
  started = true;
  exitCode = await run("docker", [...composePrefix, "up", "-d", "--wait", "postgres-test"]);
  if (exitCode !== 0) throw new Error("failed to start the isolated PostgreSQL E2E service");
  const testArguments = e2eMode === "browsers"
    ? [corepackCli, "pnpm", "--filter", "@paiyouju/web", "test:e2e:browsers:local"]
    : [corepackCli, "pnpm", "test:e2e:local"];
  exitCode = await run(process.execPath, testArguments, {
    ...process.env,
    WEPOKER_E2E_ENV_FILE: applicationEnvironmentFile,
  });
} finally {
  if (started && !ranBefore) {
    const stopCode = await run("docker", [...composePrefix, "stop", "postgres-test"]);
    if (stopCode !== 0 && exitCode === 0) exitCode = stopCode;
    if (!existedBefore) {
      const removeCode = await run("docker", [...composePrefix, "rm", "-f", "postgres-test"]);
      if (removeCode !== 0 && exitCode === 0) exitCode = removeCode;
    }
  }
}

if (interruptedSignal) {
  process.exitCode = interruptedSignal === "SIGINT" ? 130 : 143;
} else {
  process.exitCode = exitCode;
}
