import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const commands = {
  "dev:start": ["dev", "start", "wepoker-dev"],
  "dev:stop": ["dev", "stop", "wepoker-dev"],
  "test:start": ["dev", "start", "wepoker-test"],
  "test:stop": ["dev", "stop", "wepoker-test"],
} as const;

const command = process.argv[2] as keyof typeof commands | undefined;
if (!command || !(command in commands)) {
  throw new Error("expected one of dev:start, dev:stop, test:start, test:stop");
}

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const executable = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../node_modules/prisma/build/index.js"
      : "../node_modules/.bin/prisma",
    import.meta.url,
  ),
);
if (!existsSync(executable)) {
  throw new Error("Prisma CLI is not installed; run pnpm install first");
}

const spawnExecutable = process.platform === "win32" ? process.execPath : executable;
const spawnArguments =
  process.platform === "win32"
    ? [executable, ...commands[command]]
    : [...commands[command]];

const result = spawnSync(spawnExecutable, spawnArguments, {
  cwd: serverRoot,
  env: process.env,
  shell: false,
  stdio: "inherit",
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
