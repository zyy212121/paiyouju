import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const dockerTestEnvironment = fileURLToPath(new URL("../../../.env.docker.test", import.meta.url));

export interface RecoveryChild {
  readonly baseUrl: string;
  readonly child: ChildProcess;
  forceKill(): Promise<void>;
  waitForExit(): Promise<number | string | null>;
  stop(): Promise<void>;
}

function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

export async function startRecoveryChild(
  port: number,
  options: { readonly tableFault?: string } = {},
): Promise<RecoveryChild> {
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: serverRoot,
    env: {
      ...process.env,
      CLIENT_ORIGIN: "http://localhost:5173",
      HOST: "127.0.0.1",
      LOG_LEVEL: "error",
      NODE_ENV: "test",
      PORT: String(port),
      TEST_FIXED_DECK: "standard",
      ...(options.tableFault === undefined ? {} : { TEST_TABLE_FAULT: options.tableFault }),
      WEPOKER_ENV_FILE: dockerTestEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let safeOutput = "";
  const startup = { error: null as Error | null };
  child.once("error", (error) => { startup.error = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => { safeOutput = `${safeOutput}${chunk.toString()}`.slice(-4_000); });
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const readinessDeadline = Date.now() + 20_000;
  let lastReadiness = "not reachable";
  while (Date.now() < readinessDeadline) {
    if (startup.error) throw new Error(`recovery child spawn failed: ${startup.error.message}`);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`recovery child exited with ${child.exitCode ?? child.signalCode}: ${safeOutput}`);
    try {
      const response = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      lastReadiness = `HTTP ${response.status}: ${body.slice(0, 1_000)}`;
      if (response.ok) return {
        baseUrl,
        child,
        async forceKill() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGKILL");
          await exitOf(child);
        },
        async waitForExit() {
          await exitOf(child);
          return child.exitCode ?? child.signalCode;
        },
        async stop() {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          const exited = await Promise.race([
            exitOf(child).then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
          ]);
          if (!exited && child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await exitOf(child);
          }
        },
      };
    } catch { /* child is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGKILL");
  await exitOf(child);
  throw new Error(`recovery child readiness timeout (${lastReadiness}): ${safeOutput}`);
}
