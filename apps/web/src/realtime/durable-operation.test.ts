import { describe, expect, it } from "vitest";

import { DurableOperationTracker, PendingDurableOperationConflict } from "./durable-operation.js";

describe("durable operation tracker", () => {
  it("reuses the exact operation id and expected version until explicitly cleared", () => {
    const tracker = new DurableOperationTracker<{ readonly amount: number; readonly event: "buy-in" }>();
    let sequence = 0;
    const createId = () => `operation-${sequence += 1}`;

    const first = tracker.acquire({ amount: 100, event: "buy-in" }, 7, createId);
    const retry = tracker.acquire({ amount: 100, event: "buy-in" }, 99, createId);

    expect(retry).toEqual(first);
    expect(retry).toMatchObject({ expectedStateVersion: 7, operationId: "operation-1" });
    tracker.clear();
    expect(tracker.acquire({ amount: 100, event: "buy-in" }, 9, createId)).toMatchObject({ expectedStateVersion: 9, operationId: "operation-2" });
  });

  it("blocks a different durable intent while an earlier result is uncertain", () => {
    const tracker = new DurableOperationTracker<{ readonly amount: number }>();
    tracker.acquire({ amount: 100 }, 1, () => "operation-1");

    expect(() => tracker.acquire({ amount: 200 }, 1, () => "operation-2")).toThrow(PendingDurableOperationConflict);
    expect(tracker.current()?.operationId).toBe("operation-1");
  });

  it("clears an uncertain operation only when canonical state proves its effect", () => {
    const tracker = new DurableOperationTracker<{ readonly targetStack: number }>();
    tracker.acquire({ targetStack: 500 }, 3, () => "operation-1");

    tracker.clearIf(({ intent }) => intent.targetStack <= 499);
    expect(tracker.current()).not.toBeNull();
    tracker.clearIf(({ intent }) => intent.targetStack <= 500);
    expect(tracker.current()).toBeNull();
  });
});
