import { createStandardDeck } from "@paiyouju/poker-core";
import { describe, expect, it } from "vitest";

import { FixedDeckProvider, FakeClockScheduler } from "./testing.js";
import type { Clock, ScheduledTask, Scheduler } from "./clock.js";
import { TableRuntime } from "./table-runtime.js";
import { createHandController } from "./hand-controller.js";

class LeakyClockScheduler implements Clock, Scheduler {
  private current = new Date("2026-01-01T00:00:00.000Z");
  private readonly tasks: Array<{ readonly at: Date; readonly task: () => void | Promise<void> }> = [];

  now(): Date { return new Date(this.current); }

  schedule(at: Date, task: () => void | Promise<void>): ScheduledTask {
    this.tasks.push({ at, task });
    return { cancel() { /* deliberately leave stale tasks runnable */ } };
  }

  async run(index: number): Promise<void> {
    const pending = this.tasks[index];
    if (!pending) throw new Error(`missing scheduled task ${index}`);
    this.current = new Date(pending.at);
    await pending.task();
  }

  setNow(value: Date): void { this.current = new Date(value); }
}

function createRuntimeController(time: Clock & Scheduler) {
  let handIndex = 0;
  const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "计时", nextHandPaused: false, roomCode: "123456", roomId: "room-1", smallBlind: 10, status: "OPEN" });
  for (const [seatIndex, userId] of [[0, "alice"], [1, "bob"]] as const) {
    runtime.seats.set(seatIndex, { gameSessionId: `g${seatIndex}`, nickname: userId, playStatus: "ACTIVE", seatId: `s${seatIndex}`, seatIndex, stack: 400, userId, version: 1 });
    runtime.addPresence(userId, userId);
  }
  const controller = createHandController(runtime, { clock: time, deckProvider: new FixedDeckProvider(createStandardDeck()), idFactory: () => `11111111-1111-4111-8111-${String(++handIndex).padStart(12, "0")}`, persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }), scheduler: time });
  return { controller, runtime };
}

function setup() {
  const time = new FakeClockScheduler();
  const { controller, runtime } = createRuntimeController(time);
  return { controller, runtime, time };
}

describe("action timeout races", () => {
  it("makes an obsolete actor timeout a no-op after the user acts", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart(); await time.advanceBy(5_000);
    const before = runtime.currentHand!.state;
    const actor = before.players.find((player) => player.seatIndex === before.currentActorSeat)!.playerId;
    await controller.submitAction(actor, { action: { type: "call" }, clientActionId: "55555555-5555-4555-8555-555555555555", expectedStateVersion: runtime.stateVersion, handId: before.handId, roomId: runtime.room.roomId });
    const afterActionVersion = runtime.stateVersion;
    await time.advanceBy(15_000);
    expect(runtime.stateVersion).toBeGreaterThanOrEqual(afterActionVersion);
    const history = runtime.currentHand?.state.actionHistory ?? runtime.lastCompletedHand?.state.actionHistory;
    expect(history?.filter((event) => event.stateVersion === before.stateVersion + 1)).toHaveLength(1);
  });

  it("timeout acts once and a late user action is rejected", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart(); await time.advanceBy(5_000);
    const before = runtime.currentHand!.state;
    const actor = before.players.find((player) => player.seatIndex === before.currentActorSeat)!.playerId;
    const oldVersion = runtime.stateVersion;
    await time.advanceBy(15_000);
    expect(runtime.stateVersion).toBeGreaterThan(oldVersion);
    await expect(controller.submitAction(actor, { action: { type: "call" }, clientActionId: "66666666-6666-4666-8666-666666666666", expectedStateVersion: oldVersion, handId: before.handId, roomId: runtime.room.roomId })).rejects.toMatchObject({ code: "STALE_STATE" });
  });

  it("accepts the action queued first at the exact deadline and makes the old actor timer a no-op", async () => {
    const time = new LeakyClockScheduler();
    const { controller, runtime } = createRuntimeController(time);
    await controller.evaluateStart();
    await time.run(0);
    const before = runtime.currentHand!.state;
    const actor = before.players.find((player) => player.seatIndex === before.currentActorSeat)!.playerId;
    time.setNow(runtime.currentHand!.turnDeadlineAt!);

    await controller.submitAction(actor, { action: { type: "call" }, clientActionId: "77777777-7777-4777-8777-777777777777", expectedStateVersion: runtime.stateVersion, handId: before.handId, roomId: runtime.room.roomId });
    const afterActionVersion = runtime.stateVersion;
    await time.run(1);

    expect(runtime.stateVersion).toBe(afterActionVersion);
    expect(runtime.currentHand?.state.actionHistory.filter((event) => event.playerId === actor && event.stateVersion > before.stateVersion)).toHaveLength(1);
  });

  it("rejects an action after the absolute deadline even before the timer callback runs", async () => {
    const time = new LeakyClockScheduler();
    const { controller, runtime } = createRuntimeController(time);
    await controller.evaluateStart();
    await time.run(0);
    const before = runtime.currentHand!.state;
    const actor = before.players.find((player) => player.seatIndex === before.currentActorSeat)!.playerId;
    time.setNow(new Date(runtime.currentHand!.turnDeadlineAt!.getTime() + 1));

    await expect(controller.submitAction(actor, { action: { type: "call" }, clientActionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedStateVersion: runtime.stateVersion, handId: before.handId, roomId: runtime.room.roomId })).rejects.toMatchObject({ code: "STALE_STATE" });

    expect(runtime.currentHand?.state.stateVersion).toBe(before.stateVersion);
    await time.run(1);
    const afterTimeout = runtime.currentHand?.state ?? runtime.lastCompletedHand?.state;
    expect(afterTimeout?.stateVersion).toBeGreaterThan(before.stateVersion);
  });

  it("makes a previous hand timer a no-op after the next hand has started", async () => {
    const time = new LeakyClockScheduler();
    const { controller, runtime } = createRuntimeController(time);
    await controller.evaluateStart();
    await time.run(0);
    const first = runtime.currentHand!.state;
    const actor = first.players.find((player) => player.seatIndex === first.currentActorSeat)!.playerId;
    await controller.submitAction(actor, { action: { type: "fold" }, clientActionId: "88888888-8888-4888-8888-888888888888", expectedStateVersion: runtime.stateVersion, handId: first.handId, roomId: runtime.room.roomId });
    await time.run(2);
    const nextHandId = runtime.currentHand!.state.handId;
    const nextHandVersion = runtime.stateVersion;
    expect(nextHandId).not.toBe(first.handId);

    await time.run(1);

    expect(runtime.currentHand?.state.handId).toBe(nextHandId);
    expect(runtime.stateVersion).toBe(nextHandVersion);
  });
});
