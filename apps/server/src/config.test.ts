import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveRootEnvironmentPath } from "./config.js";

describe("root environment file", () => {
  it("resolves from both source and compiled server modules to the repository root", () => {
    expect(
      resolveRootEnvironmentPath(
        "file:///D:/wepoker/apps/server/src/config.ts",
      ),
    ).toBe(fileURLToPath("file:///D:/wepoker/.env"));
    expect(
      resolveRootEnvironmentPath(
        "file:///D:/wepoker/apps/server/dist/config.js",
      ),
    ).toBe(fileURLToPath("file:///D:/wepoker/.env"));
  });
});
