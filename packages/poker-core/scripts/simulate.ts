import { spawnSync } from "node:child_process";

import { planSimulationShards, SimulationError, type SimulationSummary } from "../src/simulation/index.js";

function readInteger(name: string, defaultValue?: number): number {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (argument === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing ${prefix}<integer>`);
  }
  const value = Number(argument.slice(prefix.length));
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
  return value;
}

try {
  const hands = readInteger("hands", 1000);
  const seed = readInteger("seed", Date.now());
  const started = process.hrtime.bigint();
  const shards = planSimulationShards({ hands, seed });
  let nativeProcessRetries = 0;
  const summaries = shards.map((shard) => {
    const nativeCrashStatuses = new Set([2_147_483_651, 3_221_225_477]);
    const runShard = () => spawnSync(
      process.execPath,
      ["--import", "tsx", new URL("./simulate-shard.ts", import.meta.url).pathname.slice(1), String(shard.hands), String(shard.seed)],
      { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
    );
    let attemptsUsed = 1;
    let result = runShard();
    for (let retry = 1; retry < 3 && result.status !== null && nativeCrashStatuses.has(result.status); retry += 1) {
      nativeProcessRetries += 1;
      attemptsUsed += 1;
      result = runShard();
    }
    if (result.error !== undefined || result.status !== 0) {
      let shardFailure: unknown = result.stderr.trim();
      try { shardFailure = JSON.parse(result.stderr.trim()); } catch { /* preserve raw child diagnostics */ }
      throw new SimulationError("Simulation shard failed", {
        seed, hands, shardIndex: shard.shardIndex, shardSeed: shard.seed,
        shardHands: shard.hands, attempts: attemptsUsed, status: result.status, signal: result.signal, shardFailure,
      }, result.error === undefined ? undefined : { cause: result.error });
    }
    return JSON.parse(result.stdout) as SimulationSummary;
  });
  const deterministicSummary: SimulationSummary = {
    hands,
    seed,
    completed: summaries.reduce((sum, summary) => sum + summary.completed, 0),
    failed: summaries.reduce((sum, summary) => sum + summary.failed, 0),
    invariantFailures: summaries.reduce((sum, summary) => sum + summary.invariantFailures, 0),
    elapsedTimeMs: 0,
    sidePotHands: summaries.reduce((sum, summary) => sum + summary.sidePotHands, 0),
    shortAllInHands: summaries.reduce((sum, summary) => sum + summary.shortAllInHands, 0),
  };
  const elapsedTimeMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const summary = { ...deterministicSummary, elapsedTimeMs, nativeProcessRetries };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const details = error instanceof SimulationError
    ? { name: error.name, message: error.message, cause: String(error.cause), diagnostics: error.diagnostics }
    : error instanceof Error ? { name: error.name, message: error.message, cause: String(error.cause) } : { error: String(error) };
  process.stderr.write(`${JSON.stringify(details)}\n`);
  process.exitCode = 1;
}
