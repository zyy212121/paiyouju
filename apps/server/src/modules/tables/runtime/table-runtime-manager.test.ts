import { describe, expect, it } from "vitest";

import { TableRuntimeManager } from "./table-runtime-manager.js";

const config = (roomId: string) => ({
  actionTimeSeconds: 30,
  bigBlind: 20,
  durationMinutes: 60,
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  maximumBuyIn: 2_000,
  maxSeats: 9,
  minimumBuyIn: 400,
  name: roomId,
  nextHandPaused: false,
  roomCode: "123456",
  roomId,
  smallBlind: 10,
  status: "OPEN" as const,
});

describe("TableRuntimeManager", () => {
  it("returns one runtime for concurrent access to the same room", async () => {
    const manager = new TableRuntimeManager();
    const [first, second, third] = await Promise.all([
      manager.getOrCreate(config("room-a")),
      manager.getOrCreate(config("room-a")),
      manager.getOrCreate(config("room-a")),
    ]);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(manager.size).toBe(1);
  });

  it("keeps different rooms and their queues independent", async () => {
    const manager = new TableRuntimeManager();
    const left = await manager.getOrCreate(config("left"));
    const right = await manager.getOrCreate(config("right"));
    expect(left).not.toBe(right);
    expect(left.queue).not.toBe(right.queue);
    expect(manager.size).toBe(2);
  });

  it("cleans up only closed empty runtimes without presence", async () => {
    const manager = new TableRuntimeManager();
    const runtime = await manager.getOrCreate(config("room-a"));
    expect(manager.cleanup("room-a")).toBe(false);
    runtime.status = "CLOSED";
    expect(manager.cleanup("room-a")).toBe(true);
    expect(manager.size).toBe(0);
  });

  it("business state and presence use independent monotonic versions", async () => {
    const manager = new TableRuntimeManager();
    const runtime = await manager.getOrCreate(config("room-a"));
    runtime.incrementStateVersion();
    runtime.addPresence("alice", "socket-1");
    runtime.addPresence("alice", "socket-2");
    runtime.removePresence("alice", "socket-1");
    expect(runtime.stateVersion).toBe(1);
    expect(runtime.presenceVersion).toBe(3);
    expect(runtime.isConnected("alice")).toBe(true);
    runtime.removePresence("alice", "socket-2");
    expect(runtime.stateVersion).toBe(1);
    expect(runtime.presenceVersion).toBe(4);
    expect(runtime.isConnected("alice")).toBe(false);
    expect(runtime.isDisconnectedTrustee("alice")).toBe(true);
    expect(runtime.isDisconnectedTrustee("never-connected")).toBe(false);
    runtime.addPresence("alice", "socket-3");
    expect(runtime.isDisconnectedTrustee("alice")).toBe(false);
  });

  it("notifies and cleanly unregisters room lifecycle listeners", async () => {
    const manager = new TableRuntimeManager();
    const rooms: string[] = [];
    const unsubscribe = manager.onChange((roomId) => { rooms.push(roomId); });
    await manager.notify("room-a");
    unsubscribe();
    await manager.notify("room-b");
    expect(rooms).toEqual(["room-a"]);
  });

  it("evicts only safe empty runtimes and clears transient references", async () => {
    const manager = new TableRuntimeManager();
    const empty = await manager.getOrCreate(config("empty"));
    empty.actionCache.set("old", { fingerprint: "fingerprint", handId: "hand", result: { alreadyProcessed: false, events: [], stateVersion: 1 } });
    const active = await manager.getOrCreate(config("active"));
    active.currentHand = {} as never;
    const errored = await manager.getOrCreate(config("errored"));
    errored.status = "RECOVERY_ERROR";

    expect(manager.evictEligible()).toEqual(["empty"]);
    expect(empty.actionCache.size).toBe(0);
    expect(manager.get("active")).toBe(active);
    expect(manager.get("errored")).toBe(errored);
  });

  it("close releases every runtime and listener without changing durable game state", async () => {
    const manager = new TableRuntimeManager();
    const runtime = await manager.getOrCreate(config("room-a"));
    runtime.status = "PLAYING";
    runtime.currentHand = {} as never;
    const unsubscribe = manager.onChange(() => undefined);

    manager.close();

    expect(manager.size).toBe(0);
    await expect(manager.notify("room-a")).resolves.toBeUndefined();
    unsubscribe();
  });

  it("does not evict a CLOSED runtime while a transient timer identity is still present", async () => {
    const manager = new TableRuntimeManager();
    const runtime = await manager.getOrCreate({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 400, maxSeats: 2, minimumBuyIn: 400, name: "关闭计时", nextHandPaused: false, roomCode: "123456", roomId: "closed-timer", smallBlind: 10, status: "CLOSED" });
    runtime.status = "CLOSED";
    runtime.startCountdownAt = new Date("2026-01-01T00:00:05.000Z");

    expect(manager.cleanup("closed-timer")).toBe(false);
    runtime.startCountdownAt = null;
    expect(manager.cleanup("closed-timer")).toBe(true);
  });
});
