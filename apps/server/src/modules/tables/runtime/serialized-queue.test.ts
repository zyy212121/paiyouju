import { describe, expect, it } from "vitest";

import { SerializedQueue } from "./serialized-queue.js";

describe("SerializedQueue", () => {
  it("runs commands on one table strictly in arrival order", async () => {
    const queue = new SerializedQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run(async () => { order.push("first:start"); await firstGate; order.push("first:end"); });
    const second = queue.run(async () => { order.push("second"); });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("allows different table queues to progress independently", async () => {
    const left = new SerializedQueue();
    const right = new SerializedQueue();
    let releaseLeft!: () => void;
    const gate = new Promise<void>((resolve) => { releaseLeft = resolve; });
    const blocked = left.run(async () => gate);

    await expect(right.run(async () => "right-complete")).resolves.toBe("right-complete");
    releaseLeft();
    await blocked;
  });

  it("does not poison later commands when one command fails", async () => {
    const queue = new SerializedQueue();
    await expect(queue.run(async () => { throw new Error("expected failure"); })).rejects.toThrow("expected failure");
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });
});
