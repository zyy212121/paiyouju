import { describe, expect, it } from "vitest";

import { hydrateTableRuntime, type TableRuntimeHydrationSnapshot } from "./hydrate-table-runtime.js";
import { TableRuntime } from "./table-runtime.js";
import type { RuntimeRoomConfig, RuntimeSeat } from "./types.js";

const room: RuntimeRoomConfig = {
  actionTimeSeconds: 30,
  bigBlind: 20,
  durationMinutes: 60,
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  maximumBuyIn: 2_000,
  maxSeats: 2,
  minimumBuyIn: 400,
  name: "水合测试",
  nextHandPaused: false,
  roomCode: "123456",
  roomId: "room-1",
  smallBlind: 10,
  status: "OPEN",
};

const seat: RuntimeSeat = {
  gameSessionId: "game-1",
  nickname: "Alice",
  playStatus: "ACTIVE",
  seatId: "seat-1",
  seatIndex: 0,
  stack: 400,
  userId: "alice",
  version: 1,
};

describe("table runtime hydration", () => {
  it("serializes a captured database snapshot before a later seat mutation", async () => {
    const runtime = new TableRuntime(room);
    let releaseSnapshot!: () => void;
    let snapshotCaptured!: () => void;
    const release = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
    const captured = new Promise<void>((resolve) => { snapshotCaptured = resolve; });
    const staleSnapshot: TableRuntimeHydrationSnapshot = {
      handNumber: 3,
      lastButtonSeat: 1,
      room,
      seats: [seat],
    };

    const hydration = hydrateTableRuntime(runtime, async () => {
      snapshotCaptured();
      await release;
      return staleSnapshot;
    });
    await captured;
    const leave = runtime.queue.run(() => { runtime.seats.clear(); });
    releaseSnapshot();
    await Promise.all([hydration, leave]);

    expect(runtime.hydrated).toBe(true);
    expect(runtime.seats.size).toBe(0);
    expect(runtime.handNumber).toBe(3);
    expect(runtime.lastButtonSeat).toBe(1);
  });

  it("loads only once when concurrent subscribers share a runtime", async () => {
    const runtime = new TableRuntime(room);
    let calls = 0;
    const load = async (): Promise<TableRuntimeHydrationSnapshot> => {
      calls += 1;
      return { handNumber: 0, lastButtonSeat: null, room: { ...room, status: "CLOSING" }, seats: [seat] };
    };

    await Promise.all([
      hydrateTableRuntime(runtime, load),
      hydrateTableRuntime(runtime, load),
    ]);

    expect(calls).toBe(1);
    expect(runtime.status).toBe("CLOSING");
    expect(runtime.seats.get(0)).toEqual(seat);
  });
});
