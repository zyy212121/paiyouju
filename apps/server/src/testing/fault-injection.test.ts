import { describe, expect, it, vi } from "vitest";

import { assertFaultInjectionAllowed, TABLE_FAULT_POINTS } from "./fault-injection.js";

describe("table fault injection boundary", () => {
  it("exposes only explicit dependency-injection points and rejects production wiring", () => {
    const injector = { hit: vi.fn() };

    expect(TABLE_FAULT_POINTS).toEqual([
      "afterSettlementCommitBeforeRuntimeUpdate",
      "afterSettlementCommitBeforeBroadcast",
      "afterSnapshotCommitBeforeRuntimeUpdate",
      "afterActionCommitBeforeBroadcast",
      "beforeActionReceiptCommit",
      "beforeSettlementCommit",
      "beforeSnapshotCommit",
    ]);
    expect(() => assertFaultInjectionAllowed("test", injector)).not.toThrow();
    expect(() => assertFaultInjectionAllowed("development", injector)).toThrow(/NODE_ENV=test/);
    expect(() => assertFaultInjectionAllowed("production", injector)).toThrow(/NODE_ENV=test/);
    expect(() => assertFaultInjectionAllowed("production", undefined)).not.toThrow();
  });
});
