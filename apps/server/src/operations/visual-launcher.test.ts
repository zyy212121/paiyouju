import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryFile = (path: string) => new URL(`../../../../${path}`, import.meta.url);

describe("Windows visual test launchers", () => {
  it("provides a UTF-8 BOM WinForms panel for LAN probes and a double-click entry", async () => {
    const [scriptBuffer, command] = await Promise.all([
      readFile(repositoryFile("scripts/start-lan-test-ui.ps1")),
      readFile(repositoryFile("start-test-ui.cmd"), "utf8"),
    ]);
    const source = scriptBuffer.toString("utf8");

    expect([...scriptBuffer.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    expect(source).toContain("System.Windows.Forms");
    expect(source).toContain("ADMIN_ROOM_FILE_LOG_ENABLED");
    expect(source).toContain("ADMIN_ROOM_CONNECTION_PROBES_ENABLED");
    expect(source).toContain("corepack pnpm dev:lan");
    expect(source).toContain("$probe3CheckBox");
    expect(source).toContain("$probe4CheckBox");
    expect(source).toContain("$probe5CheckBox");
    expect(command).toContain("scripts\\start-lan-test-ui.ps1");
  });

});
