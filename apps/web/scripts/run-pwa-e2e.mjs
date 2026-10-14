import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const corepackCli = join(dirname(process.execPath), "node_modules", "corepack", "dist", "corepack.js");

function run(label, args) {
  process.stdout.write(`[pwa-e2e] ${label}\n`);
  const result = spawnSync(process.execPath, [corepackCli, "pnpm", ...args], {
    cwd: webRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("fresh production build", ["build"]);
run("production service-worker browser checks", ["exec", "playwright", "test", "--config", "playwright.pwa.config.ts"]);
