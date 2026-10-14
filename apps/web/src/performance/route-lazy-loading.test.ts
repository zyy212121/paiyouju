import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("release route chunking", () => {
  it("keeps admin, history, and replay pages out of the eager table shell", async () => {
    const source = await readFile(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(source).toContain("lazy(");
    for (const module of ["AdminPages", "GamesPage", "GameSessionPage", "HandsPage", "HandDetailPage", "ReplayPage"]) {
      expect(source).toMatch(new RegExp(`import\\(".*${module}\\.js"\\)`));
      expect(source).not.toMatch(new RegExp(`^import .* from ".*${module}\\.js"`, "mu"));
    }
  });
});
