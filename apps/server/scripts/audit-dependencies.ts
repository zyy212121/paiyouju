import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assessDependencyAudit } from "../src/operations/dependency-audit.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error("Unable to locate the pinned pnpm executable");

const result = spawnSync(process.execPath, [packageManager, "audit", "--json"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
});
let payload: unknown;
try {
  payload = JSON.parse(result.stdout) as unknown;
} catch {
  process.stderr.write("Dependency audit did not return valid JSON\n");
  process.exit(1);
}
const assessment = assessDependencyAudit(payload as Parameters<typeof assessDependencyAudit>[0]);
process.stdout.write(`${JSON.stringify({
  ...assessment,
  decision: assessment.allowedHigh.includes("1145093")
    ? "Prisma CLI configuration-only advisory acknowledged; no untrusted recursive objects reach @prisma/config"
    : "no acknowledged high advisory present",
}, null, 2)}\n`);
if (assessment.blocking.length > 0) process.exitCode = 1;
