import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const testEnvironmentFile = fileURLToPath(
  new URL("../../../.env.test", import.meta.url),
);
const baseUrl = "http://127.0.0.1:3103";
const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: serverRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3103",
    WEPOKER_ENV_FILE: testEnvironmentFile,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk: Buffer) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk: Buffer) => {
  output += chunk.toString();
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) {
    throw new Error(`built server did not become ready\n${output}`);
  }
  process.env.SMOKE_BASE_URL = baseUrl;
  process.env.CLIENT_ORIGIN = "http://localhost:5173";
  await import("./smoke-http.js");
} finally {
  child.kill();
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}
