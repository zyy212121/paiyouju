import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const environmentFile = fileURLToPath(new URL("../../../.env.docker", import.meta.url));

if (!existsSync(environmentFile)) {
  throw new Error("Missing ignored .env.docker; copy .env.docker.example and set local-only passwords");
}

const commands = {
  down: ["compose", "--env-file", environmentFile, "down"],
  logs: ["compose", "--env-file", environmentFile, "logs", "--tail=200", "postgres-dev", "postgres-test"],
  status: ["compose", "--env-file", environmentFile, "ps"],
  up: ["compose", "--env-file", environmentFile, "up", "-d", "--wait", "postgres-dev", "postgres-test"],
} as const;

const command = process.argv[2] as keyof typeof commands | undefined;
if (!command || !(command in commands)) {
  throw new Error("expected one of up, down, status, logs");
}

const result = spawnSync("docker", commands[command], {
  cwd: repositoryRoot,
  env: process.env,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
