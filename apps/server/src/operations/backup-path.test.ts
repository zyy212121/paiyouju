import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as operations from "./backup.js";

describe("portable backup destination", () => {
  const repository = resolve("arbitrary folder", "牌友局");

  it("places the default outside a checkout on any drive", () => {
    expect(operations.resolveBackupDirectory(repository)).toBe(resolve(repository, "../paiyouju-backups"));
  });

  it("resolves configured relative destinations against the checkout instead of the shell", () => {
    expect(operations.resolveBackupDirectory(repository, "../safe backups")).toBe(resolve(repository, "../safe backups"));
  });

  it("rejects destinations inside the source checkout", () => {
    expect(() => operations.resolveBackupDirectory(repository, "backups")).toThrow(/outside/u);
    expect(() => operations.resolveBackupDirectory(repository, ".")).toThrow(/outside/u);
    expect(() => operations.resolveBackupDirectory(repository, "..private/dumps")).toThrow(/outside/u);
  });
});
