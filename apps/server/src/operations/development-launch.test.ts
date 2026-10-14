import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const helper = new URL("../../scripts/development-launch.mjs", import.meta.url).href;
const fixtureRoot = resolve("any folder", "牌友局");
const fixtureModule = pathToFileURL(resolve(fixtureRoot, "apps/server/scripts/start-local-development.mjs")).href;
interface LaunchConfiguration {
  environment: Record<string, string>;
  serverRoot: string;
}
const implementation = await import(helper) as {
  createDevelopmentLaunch(moduleUrl: string, environment: Record<string, string>): LaunchConfiguration;
};

function configuration(environment: Record<string, string>) {
  return implementation.createDevelopmentLaunch(fixtureModule, environment);
}

describe("development launcher configuration", () => {
  it("preserves an explicitly configured browser origin", () => {
    expect(configuration({ CLIENT_ORIGIN: "https://dev.example.com" }).environment.CLIENT_ORIGIN).toBe("https://dev.example.com");
  });

  it("lets the application load its configured origin when the shell has no override", () => {
    expect(configuration({}).environment).not.toHaveProperty("CLIENT_ORIGIN");
  });

  it("resolves a configured file from the checkout rather than the shell directory", () => {
    const result = configuration({ WEPOKER_ENV_FILE: "config/development.env" });
    expect(result.environment.WEPOKER_ENV_FILE).toBe(resolve(fixtureRoot, "config/development.env"));
    expect(result.serverRoot).toBe(resolve(fixtureRoot, "apps/server") + sep);
  });
});
