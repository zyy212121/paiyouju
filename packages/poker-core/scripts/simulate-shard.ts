import { runSimulation, SimulationError } from "../src/simulation/index.js";

const [handsText, seedText] = process.argv.slice(2);
const hands = Number(handsText);
const seed = Number(seedText);
try {
  if (!Number.isSafeInteger(hands) || hands <= 0 || !Number.isSafeInteger(seed)) throw new Error("Shard requires positive hands and safe integer seed");
  process.stdout.write(`${JSON.stringify(runSimulation({ hands, seed }))}\n`);
} catch (error) {
  const details = error instanceof SimulationError
    ? { name: error.name, message: error.message, cause: String(error.cause), diagnostics: error.diagnostics }
    : error instanceof Error ? { name: error.name, message: error.message } : { error: String(error) };
  process.stderr.write(`${JSON.stringify(details)}\n`);
  process.exitCode = 1;
}
