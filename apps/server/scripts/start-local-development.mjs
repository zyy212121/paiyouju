import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { createDevelopmentLaunch } from "./development-launch.mjs";

const launch = createDevelopmentLaunch(import.meta.url, process.env);
const environmentFile = launch.environment.WEPOKER_ENV_FILE;
const serverRoot = launch.serverRoot;

if (!existsSync(environmentFile)) {
  throw new Error("Missing .env.docker.dev. Copy .env.example and configure the Docker development database first.");
}

process.env.WEPOKER_ENV_FILE = environmentFile;

const child = spawn(process.execPath, ["--watch", "--import", "tsx", "src/index.ts"], {
  cwd: serverRoot,
  env: process.env,
  shell: false,
  stdio: "inherit",
  windowsHide: true,
});

let interruptedSignal = null;
function forward(signal) {
  interruptedSignal = signal;
  child.kill(signal);
}

process.once("SIGINT", () => forward("SIGINT"));
process.once("SIGTERM", () => forward("SIGTERM"));

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});

process.exitCode = interruptedSignal === "SIGINT"
  ? 130
  : interruptedSignal === "SIGTERM"
    ? 143
    : exitCode;
