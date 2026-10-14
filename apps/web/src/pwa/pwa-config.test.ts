import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("safe PWA contract", () => {
  it("prompts for updates and denies private/API/socket navigation caches", async () => {
    const config = await readFile(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(config).toContain('registerType: "prompt"');
    expect(config).not.toContain('registerType: "autoUpdate"');
    expect(config).toMatch(/navigateFallbackDenylist:[\s\S]*api[\s\S]*socket/);
    expect(config).toMatch(/pathname\.startsWith\("\/api\/"\)[\s\S]*handler: "NetworkOnly"/);
    expect(config).toContain('request.destination');
    expect(config).toContain('icon-maskable.svg');
    expect(config).not.toMatch(/cacheName:[^\n]*(?:phone|account|profile|auth)/iu);
  });

  it("keeps standard local development on the trusted localhost origin", async () => {
    const [config, localEntry, rootPackage, serverPackage] = await Promise.all([
      readFile(resolve(process.cwd(), "vite.config.ts"), "utf8"),
      readFile(resolve(process.cwd(), "../server/scripts/start-local-development.mjs"), "utf8"),
      readFile(resolve(process.cwd(), "../../package.json"), "utf8"),
      readFile(resolve(process.cwd(), "../server/package.json"), "utf8"),
    ]);
    expect(config).toContain('host: "localhost"');
    expect(config).toContain("strictPort: true");
    expect(rootPackage).toContain("@paiyouju/server dev:local");
    expect(serverPackage).toContain('"dev:local": "node scripts/start-local-development.mjs"');
    const developmentDefaults = await readFile(resolve(process.cwd(), "../../.env.example"), "utf8");
    expect(developmentDefaults).toContain("CLIENT_ORIGIN=http://localhost:5173");
    expect(localEntry).toContain('spawn(process.execPath, ["--watch", "--import", "tsx", "src/index.ts"]');
  });
});
