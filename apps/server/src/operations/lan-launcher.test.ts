import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const readLauncher = (name: string) => readFile(
  new URL(`../../../../scripts/${name}`, import.meta.url),
  "utf8",
);

describe("Windows PowerShell LAN launcher", () => {
  it("decodes child output as UTF-8 and disables ANSI color escapes", async () => {
    const [launcher, child] = await Promise.all([
      readLauncher("start-lan-test.ps1"),
      readLauncher("run-lan-child.ps1"),
    ]);

    for (const source of [launcher, child]) {
      expect(source).toContain("[Console]::OutputEncoding = $utf8NoBom");
      expect(source).toContain("$OutputEncoding = $utf8NoBom");
    }
    expect(child).toContain('$env:NO_COLOR = "1"');
    expect(child).toContain('$env:FORCE_COLOR = "0"');
  });

  it("silences taskkill output and treats an already-exited child as stopped", async () => {
    const launcher = await readLauncher("start-lan-test.ps1");

    expect(launcher).toContain("& taskkill.exe /PID $Process.Id /T /F *> $null");
    expect(launcher).toContain("if ($taskkillExitCode -ne 0 -and -not (Test-ManagedProcessExited -Process $Process))");
  });

  it("regenerates the Prisma client after migrations and before seeding", async () => {
    const launcher = await readLauncher("start-lan-test.ps1");
    const migrateIndex = launcher.indexOf('@("pnpm", "db:migrate:docker")');
    const generateIndex = launcher.indexOf('@("pnpm", "db:generate")');
    const seedIndex = launcher.indexOf('@("pnpm", "db:seed:docker")');

    expect(migrateIndex).toBeGreaterThan(-1);
    expect(generateIndex).toBeGreaterThan(migrateIndex);
    expect(seedIndex).toBeGreaterThan(generateIndex);
  });
});
