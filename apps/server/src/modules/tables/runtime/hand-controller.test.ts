import { applyPlayerAction, createStandardDeck, startHand } from "@paiyouju/poker-core";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../http/api-error.js";
import { advanceRuntimeAuthority, captureRuntimeAuthority } from "./runtime-authority-state.js";
import { FixedDeckProvider, FakeClockScheduler } from "./testing.js";
import { TableRuntime } from "./table-runtime.js";
import { createHandController, type HandStartProbeEvent } from "./hand-controller.js";
import type { RuntimeSeat } from "./types.js";

function setup(options: {
  readonly onLifecycle?: (event: { readonly type: string }) => void;
  readonly onProbe?: (event: HandStartProbeEvent) => void;
  readonly prepareHandParticipants?: (seats: readonly RuntimeSeat[]) => readonly RuntimeSeat[] | Promise<readonly RuntimeSeat[]>;
  readonly retainConnectedParticipants?: (seats: readonly RuntimeSeat[]) => readonly RuntimeSeat[];
} = {}) {
  const time = new FakeClockScheduler();
  const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "运行时", nextHandPaused: false, roomCode: "123456", roomId: "room-1", smallBlind: 10, status: "OPEN" });
  runtime.seats.set(0, { gameSessionId: "ga", nickname: "Alice", playStatus: "ACTIVE", seatId: "sa", seatIndex: 0, stack: 400, userId: "alice", version: 1 });
  runtime.seats.set(1, { gameSessionId: "gb", nickname: "Bob", playStatus: "ACTIVE", seatId: "sb", seatIndex: 1, stack: 400, userId: "bob", version: 1 });
  runtime.addPresence("alice", "a");
  runtime.addPresence("bob", "b");
  const controller = createHandController(runtime, { clock: time, deckProvider: new FixedDeckProvider(createStandardDeck()), idFactory: () => "11111111-1111-4111-8111-111111111111", ...(options.onLifecycle ? { onLifecycle: options.onLifecycle } : {}), ...(options.onProbe ? { onProbe: options.onProbe } : {}), ...(options.prepareHandParticipants ? { prepareHandParticipants: options.prepareHandParticipants } : {}), ...(options.retainConnectedParticipants ? { retainConnectedParticipants: options.retainConnectedParticipants } : {}), persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }), scheduler: time });
  return { controller, runtime, time };
}

describe("authoritative hand controller", () => {
  it("starts only after five seconds and cancels when eligibility falls below two", async () => {
    const first = setup();
    await first.controller.evaluateStart();
    expect(first.runtime.status).toBe("START_COUNTDOWN");
    await first.time.advanceBy(4_999);
    expect(first.runtime.currentHand).toBeNull();
    await first.time.advanceBy(1);
    expect(first.runtime.status).toBe("PLAYING");
    expect(first.runtime.currentHand?.state.status).toBe("active");
    expect(first.runtime.currentHand?.turnDeadlineAt?.getTime()).toBe(first.time.now().getTime() + 15_000);

    const cancelled = setup();
    await cancelled.controller.evaluateStart();
    cancelled.runtime.seats.set(1, { ...cancelled.runtime.seats.get(1)!, playStatus: "SIT_OUT" });
    await cancelled.controller.evaluateStart();
    await cancelled.time.advanceBy(5_000);
    expect(cancelled.runtime.currentHand).toBeNull();
    expect(cancelled.runtime.status).toBe("IDLE");
  });

  it("probes the exact gate that cancels an already scheduled hand start", async () => {
    const probes: HandStartProbeEvent[] = [];
    const { controller, runtime } = setup({ onProbe: (event) => { probes.push(event); } });

    await controller.evaluateStart();
    runtime.seats.set(1, { ...runtime.seats.get(1)!, playStatus: "SIT_OUT" });
    await controller.evaluateStart();

    expect(probes).toEqual([
      expect.objectContaining({ outcome: "scheduled", reason: null, type: "HAND_START_COUNTDOWN" }),
      expect.objectContaining({ outcome: "cancelled", reason: "INSUFFICIENT_ELIGIBLE_SEATS_DURING_COUNTDOWN", type: "HAND_START_GATE" }),
    ]);
    expect(runtime.status).toBe("IDLE");
  });

  it("distinguishes participant loss during authenticated preparation from the final socket recheck", async () => {
    const preparedProbes: HandStartProbeEvent[] = [];
    const prepared = setup({
      onProbe: (event) => { preparedProbes.push(event); },
      prepareHandParticipants: (seats) => seats.slice(0, 1),
    });
    await prepared.controller.evaluateStart();
    await prepared.time.advanceBy(5_000);
    expect(preparedProbes).toContainEqual(expect.objectContaining({
      candidateUserIds: ["alice"],
      outcome: "cancelled",
      reason: "PREPARED_PARTICIPANTS_BELOW_TWO",
      type: "HAND_START_GATE",
    }));
    expect(preparedProbes.at(-1)).toMatchObject({ outcome: "scheduled", type: "HAND_START_COUNTDOWN" });
    expect(prepared.runtime.status).toBe("START_COUNTDOWN");

    const retainedProbes: HandStartProbeEvent[] = [];
    const retained = setup({
      onProbe: (event) => { retainedProbes.push(event); },
      retainConnectedParticipants: (seats) => seats.slice(0, 1),
    });
    await retained.controller.evaluateStart();
    await retained.time.advanceBy(5_000);
    expect(retainedProbes).toContainEqual(expect.objectContaining({
      candidateUserIds: ["alice"],
      outcome: "cancelled",
      reason: "AUTHENTICATED_CONNECTED_PARTICIPANTS_BELOW_TWO",
      type: "HAND_START_GATE",
    }));
    expect(retainedProbes.at(-1)).toMatchObject({ outcome: "scheduled", type: "HAND_START_COUNTDOWN" });
    expect(retained.runtime.status).toBe("START_COUNTDOWN");
  });

  it("emits allow-listed lifecycle events without cards or internal runtime state", async () => {
    const lifecycleEvents: Array<{ readonly type: string }> = [];
    const { controller, runtime, time } = setup({ onLifecycle: (event) => { lifecycleEvents.push(event); } });

    await controller.evaluateStart();
    await time.advanceBy(5_000);
    await time.advanceBy(15_000);
    expect(runtime.status).toBe("POST_HAND_REVIEW");
    await time.advanceBy(4_000);

    expect(lifecycleEvents.map((event) => event.type)).toEqual([
      "start countdown",
      "hand started",
      "automatic action",
      "hand completed",
      "hand started",
    ]);
    expect(JSON.stringify(lifecycleEvents)).not.toMatch(/holeCards|remainingDeck|"deck"|futureBoard/i);
    expect(runtime.currentHand?.state.status).toBe("active");
    expect(runtime.status).toBe("PLAYING");
    expect(runtime.startCountdownAt).toBeNull();
  });

  it("times out with check when free or fold when facing a bet and never adds chips", async () => {
    const facingBet = setup();
    await facingBet.controller.evaluateStart();
    await facingBet.time.advanceBy(5_000);
    const hand = facingBet.runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const stackBefore = actor.stack;
    const committedBefore = actor.committedThisStreet;

    await facingBet.time.advanceBy(15_000);

    const automatic = facingBet.runtime.lastCompletedHand!.actions.at(-1);
    const finishedActor = facingBet.runtime.lastCompletedHand!.state.players.find((player) => player.playerId === actor.playerId)!;
    expect(automatic).toMatchObject({
      actionType: "FOLD",
      amount: null,
      automatic: true,
      automaticReason: "TURN_TIMEOUT",
      userId: actor.playerId,
    });
    expect(finishedActor.stack).toBe(stackBefore);
    expect(finishedActor.committedThisStreet).toBe(committedBefore);

    const freeCheck = setup();
    await freeCheck.controller.evaluateStart();
    await freeCheck.time.advanceBy(5_000);
    const first = freeCheck.runtime.currentHand!.state;
    const firstActor = first.players.find((player) => player.seatIndex === first.currentActorSeat)!.playerId;
    await freeCheck.controller.submitAction(firstActor, {
      action: { type: "call" },
      clientActionId: "21212121-2121-4121-8121-212121212121",
      expectedStateVersion: freeCheck.runtime.stateVersion,
      handId: first.handId,
      roomId: freeCheck.runtime.room.roomId,
    });
    const second = freeCheck.runtime.currentHand!.state;
    const secondActor = second.players.find((player) => player.seatIndex === second.currentActorSeat)!;
    const secondStackBefore = secondActor.stack;

    await freeCheck.time.advanceBy(15_000);

    const checkedHand = freeCheck.runtime.currentHand ?? freeCheck.runtime.lastCompletedHand;
    expect(checkedHand!.actions.find((action) => action.automaticReason === "TURN_TIMEOUT" && action.userId === secondActor.playerId)).toMatchObject({
      actionType: "CHECK",
      amount: null,
      automatic: true,
      automaticReason: "TURN_TIMEOUT",
      userId: secondActor.playerId,
    });
    expect(secondStackBefore).toBeGreaterThan(0);
  });

  it("rejects stale and wrong-hand actions and replays exact client action ids", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    const action = { action: { type: "fold" as const }, clientActionId: "22222222-2222-4222-8222-222222222222", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId };

    await expect(controller.submitAction(actor, { ...action, expectedStateVersion: runtime.stateVersion - 1 })).rejects.toMatchObject({ code: "STALE_STATE" });
    await expect(controller.submitAction(actor, { ...action, handId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ code: "HAND_ID_MISMATCH" });
    const first = await controller.submitAction(actor, action);
    const replay = await controller.submitAction(actor, action);
    expect(replay).toEqual({ ...first, alreadyProcessed: true });
    await expect(controller.submitAction(actor, { ...action, action: { type: "check" } })).rejects.toMatchObject({ code: "ACTION_IDEMPOTENCY_CONFLICT" });
    expect(runtime.currentHand).toBeNull();
    expect(runtime.lastCompletedHand?.state.status).toBe("finished");
    expect(runtime.status).toBe("POST_HAND_REVIEW");
    await time.advanceBy(3_999);
    expect(runtime.status).toBe("POST_HAND_REVIEW");
    await time.advanceBy(1);
    expect(runtime.status).toBe("PLAYING");
    expect(runtime.currentHand?.state.status).toBe("active");
    expect(runtime.startCountdownAt).toBeNull();
  });

  it("resynchronizes and retries a post-hand review transition after a snapshot conflict", async () => {
    const time = new FakeClockScheduler();
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "恢复 Review", nextHandPaused: false, requiresManualStart: false, roomCode: "123456", roomId: "room-review-retry", smallBlind: 10, status: "OPEN" });
    for (const [seatIndex, userId] of [[0, "alice"], [1, "bob"]] as const) {
      runtime.seats.set(seatIndex, { gameSessionId: `g${seatIndex}`, nickname: userId, playStatus: "ACTIVE", seatId: `s${seatIndex}`, seatIndex, stack: 400, userId, version: 1 });
      runtime.addPresence(userId, userId);
    }
    const onError = vi.fn();
    let reviewAttempts = 0;
    const controller = createHandController(runtime, {
      clock: time,
      commitPostHandReviewEnd: async (state) => {
        reviewAttempts += 1;
        if (reviewAttempts === 1) throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌状态已更新");
        return advanceRuntimeAuthority(state, { postHandReview: null, status: "IDLE" });
      },
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "91919191-9191-4191-8191-919191919191",
      loadAuthoritativeState: async () => captureRuntimeAuthority(runtime),
      onError,
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: time,
    });

    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    await controller.submitAction(actor, { action: { type: "fold" }, clientActionId: "92929292-9292-4292-8292-929292929292", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId });
    expect(runtime.status).toBe("POST_HAND_REVIEW");

    await time.advanceBy(4_000);

    expect(reviewAttempts).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(runtime.status).toBe("PLAYING");
    expect(runtime.postHandReview).toBeNull();
  });

  it("continues automatic play when the post-review start conflicts after review persistence", async () => {
    const time = new FakeClockScheduler();
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "恢复自动开局", nextHandPaused: false, requiresManualStart: false, roomCode: "123456", roomId: "room-start-retry", smallBlind: 10, status: "OPEN" });
    for (const [seatIndex, userId] of [[0, "alice"], [1, "bob"]] as const) {
      runtime.seats.set(seatIndex, { gameSessionId: `g${seatIndex}`, nickname: userId, playStatus: "ACTIVE", seatId: `s${seatIndex}`, seatIndex, stack: 400, userId, version: 1 });
      runtime.addPresence(userId, userId);
    }
    const first = startHand({
      config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 },
      deck: createStandardDeck(),
      handId: "93939393-9393-4393-8393-939393939393",
      previousButtonSeat: null,
      seats: [...runtime.seats.values()].map((seat) => ({ isParticipating: true, playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
    });
    const actor = first.state.players.find((player) => player.seatIndex === first.state.currentActorSeat)!.playerId;
    const completed = applyPlayerAction(first.state, { actionType: "fold", playerId: actor }).state;
    const completedHand = { actions: [], handNumber: 1, paidCardRevealCost: 0, paidCardRevealEnabled: false, startedAt: time.now(), state: completed, turnDeadlineAt: null };
    runtime.handNumber = 1;
    runtime.lastCompletedHand = completedHand;
    runtime.postHandReview = { endsAt: new Date(time.now().getTime() + 4_000), hand: completedHand, voluntarilyRevealedCardIndicesByUser: {}, voluntarilyRevealedUserIds: [] };
    runtime.status = "POST_HAND_REVIEW";

    let authoritative = captureRuntimeAuthority(runtime);
    let startAttempts = 0;
    const controller = createHandController(runtime, {
      clock: time,
      commitPostHandReviewEnd: async (state) => {
        authoritative = advanceRuntimeAuthority(state, { postHandReview: null, status: "IDLE" });
        return authoritative;
      },
      commitStart: async (state, input) => {
        startAttempts += 1;
        if (startAttempts === 1) throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌状态已更新");
        const started = startHand({
          config: { bigBlind: state.room.bigBlind, maxSeats: state.room.maxSeats, smallBlind: state.room.smallBlind },
          deck: input.deck,
          handId: input.handId,
          previousButtonSeat: state.lastButtonSeat,
          seats: state.seats.map((seat) => ({ isParticipating: true, playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
        });
        authoritative = advanceRuntimeAuthority(state, {
          currentHand: { actions: [], handNumber: state.handNumber + 1, paidCardRevealCost: 0, paidCardRevealEnabled: false, startedAt: input.now, state: started.state, turnDeadlineAt: null },
          handNumber: state.handNumber + 1,
          lastCompletedHand: null,
          status: "PLAYING",
        });
        return { events: started.events, state: authoritative };
      },
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "94949494-9494-4494-8494-949494949494",
      loadAuthoritativeState: async () => authoritative,
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: time,
    });

    await controller.refreshTimers();
    await time.advanceBy(4_250);

    expect(startAttempts).toBe(2);
    expect(runtime.status).toBe("PLAYING");
    expect(runtime.currentHand?.state.status).toBe("active");
  });

  it("re-arms post-hand review when the host timer fires one millisecond early", async () => {
    const time = new FakeClockScheduler();
    let fireNextTimerEarly = false;
    const scheduler = {
      schedule: (at: Date, task: () => void | Promise<void>) => {
        const scheduledAt = fireNextTimerEarly ? new Date(at.getTime() - 1) : at;
        fireNextTimerEarly = false;
        return time.schedule(scheduledAt, task);
      },
    };
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "提前触发", nextHandPaused: false, roomCode: "123456", roomId: "room-early-review", smallBlind: 10, status: "OPEN" });
    runtime.seats.set(0, { gameSessionId: "ga", nickname: "Alice", playStatus: "ACTIVE", seatId: "sa", seatIndex: 0, stack: 400, userId: "alice", version: 1 });
    runtime.seats.set(1, { gameSessionId: "gb", nickname: "Bob", playStatus: "ACTIVE", seatId: "sb", seatIndex: 1, stack: 400, userId: "bob", version: 1 });
    runtime.addPresence("alice", "a");
    runtime.addPresence("bob", "b");
    const controller = createHandController(runtime, {
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "95959595-9595-4595-8595-959595959595",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler,
    });

    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    fireNextTimerEarly = true;
    await controller.submitAction(actor, { action: { type: "fold" }, clientActionId: "96969696-9696-4696-8696-969696969696", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId });

    await time.advanceBy(4_000);

    expect(runtime.status).toBe("PLAYING");
    expect(runtime.postHandReview).toBeNull();
  });

  it("does not start the table early and re-arms an early countdown timer", async () => {
    const time = new FakeClockScheduler();
    let fireNextTimerEarly = true;
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "提前倒计时", nextHandPaused: false, roomCode: "123456", roomId: "room-early-countdown", smallBlind: 10, status: "OPEN" });
    for (const [seatIndex, userId] of [[0, "alice"], [1, "bob"]] as const) {
      runtime.seats.set(seatIndex, { gameSessionId: `g${seatIndex}`, nickname: userId, playStatus: "ACTIVE", seatId: `s${seatIndex}`, seatIndex, stack: 400, userId, version: 1 });
      runtime.addPresence(userId, userId);
    }
    const controller = createHandController(runtime, {
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "97979797-9797-4797-8797-979797979797",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: { schedule: (at, task) => {
        const scheduledAt = fireNextTimerEarly ? new Date(at.getTime() - 1) : at;
        fireNextTimerEarly = false;
        return time.schedule(scheduledAt, task);
      } },
    });

    await controller.evaluateStart();
    await time.advanceBy(4_999);
    expect(runtime.status).toBe("START_COUNTDOWN");
    expect(runtime.currentHand).toBeNull();
    await time.advanceBy(1);
    expect(runtime.status).toBe("PLAYING");
  });

  it("re-arms an early turn deadline instead of losing the timeout action", async () => {
    const time = new FakeClockScheduler();
    let fireNextTimerEarly = false;
    const lifecycle: string[] = [];
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt: new Date("2099-01-01T00:00:00.000Z"), maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "提前行动", nextHandPaused: false, roomCode: "123456", roomId: "room-early-turn", smallBlind: 10, status: "OPEN" });
    for (const [seatIndex, userId] of [[0, "alice"], [1, "bob"]] as const) {
      runtime.seats.set(seatIndex, { gameSessionId: `g${seatIndex}`, nickname: userId, playStatus: "ACTIVE", seatId: `s${seatIndex}`, seatIndex, stack: 400, userId, version: 1 });
      runtime.addPresence(userId, userId);
    }
    const controller = createHandController(runtime, {
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "98989898-9898-4898-8898-989898989898",
      onLifecycle: (event) => { lifecycle.push(event.type); },
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: { schedule: (at, task) => {
        const scheduledAt = fireNextTimerEarly ? new Date(at.getTime() - 1) : at;
        fireNextTimerEarly = false;
        return time.schedule(scheduledAt, task);
      } },
    });

    await controller.evaluateStart();
    fireNextTimerEarly = true;
    await time.advanceBy(5_000);
    await time.advanceBy(14_999);
    expect(lifecycle).not.toContain("automatic action");
    await time.advanceBy(1);
    expect(lifecycle.filter((event) => event === "automatic action")).toHaveLength(1);
  });

  it("re-arms an early room-expiry timer", async () => {
    const time = new FakeClockScheduler();
    const expiresAt = new Date(time.now().getTime() + 10_000);
    const runtime = new TableRuntime({ actionTimeSeconds: 15, bigBlind: 20, durationMinutes: 60, expiresAt, maximumBuyIn: 2_000, maxSeats: 2, minimumBuyIn: 400, name: "提前到期", nextHandPaused: false, roomCode: "123456", roomId: "room-early-expiry", smallBlind: 10, status: "OPEN", tableStartedAt: time.now() });
    let expiryCommits = 0;
    let fireNextTimerEarly = true;
    const controller = createHandController(runtime, {
      clock: time,
      commitRoomExpiry: async (state) => {
        expiryCommits += 1;
        return advanceRuntimeAuthority(state, { room: { ...state.room, requiresManualStart: true, status: "CLOSING" }, status: "CLOSING" });
      },
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "99999999-9999-4999-8999-999999999999",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: { schedule: (at, task) => {
        const scheduledAt = fireNextTimerEarly ? new Date(at.getTime() - 1) : at;
        fireNextTimerEarly = false;
        return time.schedule(scheduledAt, task);
      } },
    });

    await controller.refreshTimers();
    await time.advanceBy(9_999);
    expect(expiryCommits).toBe(0);
    await time.advanceBy(1);
    expect(expiryCommits).toBe(1);
    expect(runtime.room.status).toBe("CLOSING");
  });

  it("executes next-decision autopilot once as a zero-payment fold and records its reason", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    const stackBefore = actor.stack;
    const committedBefore = actor.committedThisStreet;
    runtime.seats.set(seat.seatIndex, { ...seat, nextActionAutopilotArmed: true });

    await controller.refreshTimers();
    await time.advanceBy(0);

    const action = runtime.lastCompletedHand?.actions.at(-1);
    const finishedPlayer = runtime.lastCompletedHand?.state.players.find((player) => player.playerId === actor.playerId);
    expect(action).toMatchObject({ actionType: "FOLD", amount: null, automatic: true, automaticReason: "NEXT_DECISION_AUTOPILOT" });
    expect(finishedPlayer).toMatchObject({ committedThisStreet: committedBefore, stack: stackBefore });
    expect(runtime.seats.get(seat.seatIndex)?.nextActionAutopilotArmed).toBe(false);
  });

  it("keeps persistent trusteeship armed while checking or folding without voluntary payment", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    runtime.seats.set(seat.seatIndex, { ...seat, trusteeshipEnabled: true });

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.lastCompletedHand?.actions.at(-1)).toMatchObject({
      actionType: "FOLD",
      amount: null,
      automatic: true,
      automaticReason: "TRUSTEESHIP",
    });
    expect(runtime.seats.get(seat.seatIndex)?.trusteeshipEnabled).toBe(true);
  });

  it("treats a disconnected active actor as immediate check-or-fold trusteeship without changing the seat", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    runtime.removePresence(actor.playerId, actor.playerId === "alice" ? "a" : "b");

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.lastCompletedHand?.actions.at(-1)).toMatchObject({
      actionType: "FOLD",
      amount: null,
      automatic: true,
      automaticReason: "TRUSTEESHIP",
      userId: actor.playerId,
    });
    expect(runtime.seats.get(seat.seatIndex)).toMatchObject({ playStatus: "ACTIVE" });
    expect(runtime.seats.get(seat.seatIndex)?.trusteeshipEnabled ?? false).toBe(false);
  });

  it("keeps a disconnected active seat eligible for later hands", async () => {
    const { controller, runtime, time } = setup();
    runtime.removePresence("bob", "b");

    await controller.evaluateStart();
    await time.advanceBy(5_000);

    const dealtHand = runtime.currentHand ?? runtime.lastCompletedHand;
    expect(dealtHand?.state.players.map((player) => player.playerId)).toContain("bob");
    expect(runtime.seats.get(1)).toMatchObject({ playStatus: "ACTIVE", userId: "bob" });
  });

  it("uses next-decision autopilot to check when legal, then clears it before the following decision", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    let state = runtime.currentHand!.state;
    let actor = state.players.find((player) => player.seatIndex === state.currentActorSeat)!;
    await controller.submitAction(actor.playerId, { action: { type: "call" }, clientActionId: "16161616-0000-4000-8000-000000000001", expectedStateVersion: runtime.stateVersion, handId: state.handId, roomId: runtime.room.roomId });
    state = runtime.currentHand!.state;
    actor = state.players.find((player) => player.seatIndex === state.currentActorSeat)!;
    await controller.submitAction(actor.playerId, { action: { type: "check" }, clientActionId: "16161616-0000-4000-8000-000000000002", expectedStateVersion: runtime.stateVersion, handId: state.handId, roomId: runtime.room.roomId });
    state = runtime.currentHand!.state;
    actor = state.players.find((player) => player.seatIndex === state.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    runtime.seats.set(seat.seatIndex, { ...seat, nextActionAutopilotArmed: true });

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.currentHand?.actions.at(-1)).toMatchObject({ actionType: "CHECK", amount: null, automatic: true, automaticReason: "NEXT_DECISION_AUTOPILOT" });
    expect(runtime.seats.get(seat.seatIndex)?.nextActionAutopilotArmed).toBe(false);
    expect(runtime.currentHand?.turnDeadlineAt?.getTime()).toBe(time.now().getTime() + 15_000);
  });

  it("automatically calls the bound current bet once and records a distinct reason", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    runtime.seats.set(seat.seatIndex, { ...seat, nextActionAutoCallCurrentBet: hand.currentBet, nextActionAutopilotArmed: true });

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.currentHand?.actions.at(-1)).toMatchObject({ actionType: "CALL", amount: 10, automatic: true, automaticReason: "NEXT_DECISION_AUTO_CALL" });
    expect(runtime.seats.get(seat.seatIndex)).toMatchObject({ nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false });
  });

  it("cancels auto-call when the maximum street bet changes but preserves check-or-fold", async () => {
    const autoCall = setup();
    await autoCall.controller.evaluateStart();
    await autoCall.time.advanceBy(5_000);
    const autoCallHand = autoCall.runtime.currentHand!.state;
    const actor = autoCallHand.players.find((player) => player.seatIndex === autoCallHand.currentActorSeat)!;
    const waiting = autoCallHand.players.find((player) => player.playerId !== actor.playerId)!;
    const waitingSeat = [...autoCall.runtime.seats.values()].find((seat) => seat.userId === waiting.playerId)!;
    autoCall.runtime.seats.set(waitingSeat.seatIndex, { ...waitingSeat, nextActionAutoCallCurrentBet: autoCallHand.currentBet, nextActionAutopilotArmed: true });
    await autoCall.controller.submitAction(actor.playerId, { action: { raiseTo: 40, type: "raiseTo" }, clientActionId: "18181818-0000-4000-8000-000000000001", expectedStateVersion: autoCall.runtime.stateVersion, handId: autoCallHand.handId, roomId: autoCall.runtime.room.roomId });
    expect(autoCall.runtime.seats.get(waitingSeat.seatIndex)).toMatchObject({ nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false });

    const checkFold = setup();
    await checkFold.controller.evaluateStart();
    await checkFold.time.advanceBy(5_000);
    const checkFoldHand = checkFold.runtime.currentHand!.state;
    const checkFoldActor = checkFoldHand.players.find((player) => player.seatIndex === checkFoldHand.currentActorSeat)!;
    const checkFoldWaiting = checkFoldHand.players.find((player) => player.playerId !== checkFoldActor.playerId)!;
    const checkFoldSeat = [...checkFold.runtime.seats.values()].find((seat) => seat.userId === checkFoldWaiting.playerId)!;
    checkFold.runtime.seats.set(checkFoldSeat.seatIndex, { ...checkFoldSeat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: true });
    await checkFold.controller.submitAction(checkFoldActor.playerId, { action: { raiseTo: 40, type: "raiseTo" }, clientActionId: "18181818-0000-4000-8000-000000000002", expectedStateVersion: checkFold.runtime.stateVersion, handId: checkFoldHand.handId, roomId: checkFold.runtime.room.roomId });
    expect(checkFold.runtime.seats.get(checkFoldSeat.seatIndex)).toMatchObject({ nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: true });
  });

  it("applies reserved-away protection without adding chips and excludes that seat from the next hand", async () => {
    const { controller, runtime, time } = setup();
    runtime.room = { ...runtime.room, tableStartedAt: time.now() };
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    const stackBefore = actor.stack;
    runtime.seats.set(seat.seatIndex, { ...seat, playStatus: "RESERVED_AWAY", reservedAwayEndsAt: new Date(time.now().getTime() + 60_000) });

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.lastCompletedHand?.actions.at(-1)).toMatchObject({ actionType: "FOLD", amount: null, automatic: true, automaticReason: "RESERVED_AWAY" });
    expect(runtime.lastCompletedHand?.state.players.find((player) => player.playerId === actor.playerId)?.stack).toBe(stackBefore);
    await time.advanceBy(4_000);
    expect(runtime).toMatchObject({ currentHand: null, status: "IDLE" });
    expect(runtime.room).toMatchObject({ requiresManualStart: false, status: "OPEN" });
  });

  it("stops below two active seats, then resumes from the 30-second heartbeat without another owner start", async () => {
    const { controller, runtime, time } = setup();
    const startedAt = new Date("2025-12-31T23:00:00.000Z");
    runtime.room = { ...runtime.room, requiresManualStart: false, tableStartedAt: startedAt };
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const other = hand.players.find((player) => player.playerId !== actor.playerId)!;
    const otherSeat = [...runtime.seats.values()].find((seat) => seat.userId === other.playerId)!;
    runtime.seats.set(otherSeat.seatIndex, { ...otherSeat, playStatus: "SIT_OUT" });
    await controller.submitAction(actor.playerId, { action: { type: "fold" }, clientActionId: "17171717-0000-4000-8000-000000000001", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId });
    await time.advanceBy(4_000);

    expect(runtime.currentHand).toBeNull();
    expect(runtime.room).toMatchObject({ requiresManualStart: false, status: "OPEN", tableStartedAt: startedAt });
    expect(runtime.status).toBe("IDLE");
    runtime.seats.set(otherSeat.seatIndex, { ...runtime.seats.get(otherSeat.seatIndex)!, playStatus: "ACTIVE" });
    await time.advanceBy(29_999);
    expect(runtime.currentHand).toBeNull();
    expect(runtime.startCountdownAt).toBeNull();
    await time.advanceBy(1);
    expect(runtime.status).toBe("START_COUNTDOWN");
    await time.advanceBy(5_000);
    expect(runtime.status).toBe("PLAYING");
  });

  it("cancels the insufficient-player heartbeat while the owner pause is active", async () => {
    const { controller, runtime, time } = setup();
    runtime.room = { ...runtime.room, nextHandPaused: true, requiresManualStart: false, tableStartedAt: time.now() };
    runtime.removePresence("bob", "b");
    await controller.evaluateStart();
    runtime.addPresence("bob", "b2");

    await time.advanceBy(60_000);

    expect(runtime.currentHand).toBeNull();
    expect(runtime.startCountdownAt).toBeNull();
    expect(runtime.status).toBe("PAUSED");
  });

  it("immediately check-folds a player who stands while still in the hand", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;
    const seat = [...runtime.seats.values()].find((candidate) => candidate.userId === actor.playerId)!;
    const stackBefore = actor.stack;
    runtime.seats.set(seat.seatIndex, { ...seat, nextActionAutopilotArmed: true, playStatus: "LEAVE_AFTER_HAND" });

    await controller.refreshTimers();
    await time.advanceBy(0);

    expect(runtime.lastCompletedHand?.actions.at(-1)).toMatchObject({
      actionType: "FOLD",
      amount: null,
      automatic: true,
      automaticReason: "LEAVE_AFTER_HAND",
      userId: actor.playerId,
    });
    expect(runtime.lastCompletedHand?.state.players.find((player) => player.playerId === actor.playerId)?.stack).toBe(stackBefore);
  });

  it("retains every action id for the active hand even when the cache exceeds 512 entries", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    for (let index = 0; index < 512; index += 1) {
      runtime.actionCache.set(`existing-${index}`, { fingerprint: `fingerprint-${index}`, handId: handIdForCache(runtime), result: { alreadyProcessed: false, events: [], stateVersion: index } });
    }
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;

    await controller.submitAction(actor, { action: { type: "call" }, clientActionId: "99999999-9999-4999-8999-999999999999", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId });

    expect(runtime.actionCache.size).toBe(513);
    expect(runtime.actionCache.has("existing-0")).toBe(true);
  });

  it("bounds historical action receipts after a durable action commit", async () => {
    const seeded = setup();
    await seeded.controller.evaluateStart();
    await seeded.time.advanceBy(5_000);
    seeded.controller.dispose();
    for (let index = 0; index < 512; index += 1) {
      seeded.runtime.actionCache.set(`historical-${index}`, {
        fingerprint: `fingerprint-${index}`,
        handId: `historical-hand-${index}`,
        result: { alreadyProcessed: false, events: [], stateVersion: index },
      });
    }
    const controller = createHandController(seeded.runtime, {
      clock: seeded.time,
      commitPlayerAction: async (state) => ({
        events: [],
        replayed: false,
        result: { alreadyProcessed: false, events: [], stateVersion: state.stateVersion + 1 },
        state: { ...state, stateVersion: state.stateVersion + 1 },
      }),
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "81818181-8181-4181-8181-818181818181",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: seeded.time,
    });
    const hand = seeded.runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    const clientActionId = "81818181-0000-4000-8000-000000000001";

    await controller.submitAction(actor, { action: { type: "call" }, clientActionId, expectedStateVersion: seeded.runtime.stateVersion, handId: hand.handId, roomId: seeded.runtime.room.roomId });

    expect(seeded.runtime.actionCache.size).toBe(512);
    expect(seeded.runtime.actionCache.has(`historical-0`)).toBe(false);
    expect(seeded.runtime.actionCache.has(`${actor}:${clientActionId}`)).toBe(true);
    controller.dispose();
  });

  it("maps illegal actor actions to stable public errors", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const nonActor = hand.players.find((player) => player.seatIndex !== hand.currentActorSeat)!.playerId;
    await expect(controller.submitAction(nonActor, { action: { type: "check" }, clientActionId: "44444444-4444-4444-8444-444444444444", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId })).rejects.toBeInstanceOf(ApiError);
  });

  it("records the actual chip movement for calls and raise-to actions", async () => {
    const called = setup();
    await called.controller.evaluateStart();
    await called.time.advanceBy(5_000);
    const callHand = called.runtime.currentHand!.state;
    const callActor = callHand.players.find((player) => player.seatIndex === callHand.currentActorSeat)!.playerId;

    await called.controller.submitAction(callActor, {
      action: { type: "call" },
      clientActionId: "55555555-5555-4555-8555-555555555551",
      expectedStateVersion: called.runtime.stateVersion,
      handId: callHand.handId,
      roomId: called.runtime.room.roomId,
    });

    expect(called.runtime.currentHand?.actions[0]).toMatchObject({ actionType: "CALL", amount: 10, raiseTo: null });

    const raised = setup();
    await raised.controller.evaluateStart();
    await raised.time.advanceBy(5_000);
    const raiseHand = raised.runtime.currentHand!.state;
    const raiseActor = raiseHand.players.find((player) => player.seatIndex === raiseHand.currentActorSeat)!.playerId;

    await raised.controller.submitAction(raiseActor, {
      action: { raiseTo: 40, type: "raiseTo" },
      clientActionId: "55555555-5555-4555-8555-555555555552",
      expectedStateVersion: raised.runtime.stateVersion,
      handId: raiseHand.handId,
      roomId: raised.runtime.room.roomId,
    });

    expect(raised.runtime.currentHand?.actions[0]).toMatchObject({ actionType: "RAISE_TO", amount: 30, raiseTo: 40 });
  });

  it("records an exact-stack call as all-in while keeping both audit amounts non-negative", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const firstHand = runtime.currentHand!.state;
    const firstActor = firstHand.players.find((player) => player.seatIndex === firstHand.currentActorSeat)!.playerId;
    await controller.submitAction(firstActor, {
      action: { type: "allIn" },
      clientActionId: "55555555-5555-4555-8555-555555555553",
      expectedStateVersion: runtime.stateVersion,
      handId: firstHand.handId,
      roomId: runtime.room.roomId,
    });
    const secondHand = runtime.currentHand!.state;
    const secondActor = secondHand.players.find((player) => player.seatIndex === secondHand.currentActorSeat)!.playerId;

    await controller.submitAction(secondActor, {
      action: { type: "call" },
      clientActionId: "55555555-5555-4555-8555-555555555554",
      expectedStateVersion: runtime.stateVersion,
      handId: secondHand.handId,
      roomId: runtime.room.roomId,
    });

    expect(runtime.lastCompletedHand?.actions.map((action) => ({ actionType: action.actionType, amount: action.amount }))).toEqual([
      { actionType: "ALL_IN", amount: 390 },
      { actionType: "ALL_IN", amount: 380 },
    ]);
  });

  it("records an exact-stack raise as all-in without violating the persisted raise shape", async () => {
    const { controller, runtime, time } = setup();
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!;

    await controller.submitAction(actor.playerId, {
      action: { raiseTo: actor.committedThisStreet + actor.stack, type: "raiseTo" },
      clientActionId: "55555555-5555-4555-8555-555555555555",
      expectedStateVersion: runtime.stateVersion,
      handId: hand.handId,
      roomId: runtime.room.roomId,
    });

    expect(runtime.currentHand?.actions[0]).toMatchObject({ actionType: "ALL_IN", amount: actor.stack, raiseTo: null });
  });

  it("waits for both all-in players and resolves two boards only after both choose twice", async () => {
    const { controller, runtime, time } = setup();
    runtime.room = { ...runtime.room, runItTwiceEnabled: true, specialMode: "NORMAL" };
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const first = runtime.currentHand!.state;
    const firstActor = first.players.find((player) => player.seatIndex === first.currentActorSeat)!.playerId;
    await controller.submitAction(firstActor, {
      action: { type: "allIn" },
      clientActionId: "56565656-5656-4656-8656-565656565651",
      expectedStateVersion: runtime.stateVersion,
      handId: first.handId,
      roomId: runtime.room.roomId,
    });
    const facing = runtime.currentHand!.state;
    const secondActor = facing.players.find((player) => player.seatIndex === facing.currentActorSeat)!.playerId;
    await controller.submitAction(secondActor, {
      action: { type: "call" },
      clientActionId: "56565656-5656-4656-8656-565656565652",
      expectedStateVersion: runtime.stateVersion,
      handId: facing.handId,
      roomId: runtime.room.roomId,
    });

    expect(runtime.currentHand?.state.status).toBe("runout_choice");
    expect(runtime.currentHand?.runoutVote?.eligibleUserIds).toHaveLength(2);
    const [left, right] = runtime.currentHand!.runoutVote!.eligibleUserIds;
    await controller.submitRunoutChoice(left, {
      choice: "TWICE",
      expectedStateVersion: runtime.stateVersion,
      handId: facing.handId,
      operationId: "56565656-5656-4656-8656-565656565653",
      roomId: runtime.room.roomId,
    });
    expect(runtime.currentHand?.state.status).toBe("runout_choice");
    await controller.submitRunoutChoice(right, {
      choice: "TWICE",
      expectedStateVersion: runtime.stateVersion,
      handId: facing.handId,
      operationId: "56565656-5656-4656-8656-565656565654",
      roomId: runtime.room.roomId,
    });

    expect(runtime.status).toBe("POST_HAND_REVIEW");
    expect(runtime.postHandReview?.hand.state.runoutBoards).toHaveLength(2);
    expect(runtime.postHandReview?.hand.state.settlement?.runouts).toHaveLength(2);
  });

  it("keeps an early once vote pending until the full five-second deadline", async () => {
    const { controller, runtime, time } = setup();
    runtime.room = { ...runtime.room, runItTwiceEnabled: true, specialMode: "NORMAL" };
    await controller.evaluateStart();
    await time.advanceBy(5_000);
    const first = runtime.currentHand!.state;
    const firstActor = first.players.find((player) => player.seatIndex === first.currentActorSeat)!.playerId;
    await controller.submitAction(firstActor, {
      action: { type: "allIn" }, clientActionId: "57575757-5757-4757-8757-575757575751",
      expectedStateVersion: runtime.stateVersion, handId: first.handId, roomId: runtime.room.roomId,
    });
    const facing = runtime.currentHand!.state;
    const secondActor = facing.players.find((player) => player.seatIndex === facing.currentActorSeat)!.playerId;
    await controller.submitAction(secondActor, {
      action: { type: "call" }, clientActionId: "57575757-5757-4757-8757-575757575752",
      expectedStateVersion: runtime.stateVersion, handId: facing.handId, roomId: runtime.room.roomId,
    });
    const voter = runtime.currentHand!.runoutVote!.eligibleUserIds[0];
    await controller.submitRunoutChoice(voter, {
      choice: "ONCE", expectedStateVersion: runtime.stateVersion, handId: facing.handId,
      operationId: "57575757-5757-4757-8757-575757575753", roomId: runtime.room.roomId,
    });

    await time.advanceBy(4_999);
    expect(runtime.currentHand?.state.status).toBe("runout_choice");
    await time.advanceBy(1);
    expect(runtime.status).toBe("POST_HAND_REVIEW");
    expect(runtime.postHandReview?.hand.state.runoutBoards).toBeUndefined();
  });

  it("exposes PAUSED while the next hand is paused and returns to countdown after resume", async () => {
    const { controller, runtime } = setup();
    runtime.room = { ...runtime.room, nextHandPaused: true };

    await controller.evaluateStart();

    expect(runtime.currentHand).toBeNull();
    expect(runtime.status).toBe("PAUSED");

    runtime.room = { ...runtime.room, nextHandPaused: false };
    await controller.evaluateStart();

    expect(runtime.status).toBe("START_COUNTDOWN");
  });

  it("starts with exactly the participant set that passed the asynchronous start guard", async () => {
    let releaseGuard!: () => void;
    let guardStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseGuard = resolve; });
    const started = new Promise<void>((resolve) => { guardStarted = resolve; });
    const { runtime, time } = setup();
    runtime.seats.set(2, { gameSessionId: "gc", nickname: "Carol", playStatus: "ACTIVE", seatId: "sc", seatIndex: 2, stack: 400, userId: "carol", version: 1 });
    runtime.room = { ...runtime.room, maxSeats: 3 };
    const controller = createHandController(runtime, {
      assertHandCanStart: async (seats) => {
        expect(seats.map((seat) => seat.userId).sort()).toEqual(["alice", "bob", "carol"]);
        guardStarted();
        await release;
      },
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "12121212-1212-4121-8121-121212121212",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler: time,
    });
    await controller.evaluateStart();
    const countdown = time.advanceBy(5_000);
    await started;
    runtime.addPresence("carol", "c");
    releaseGuard();
    await countdown;

    expect(runtime.currentHand?.state.players.map((player) => player.playerId).sort()).toEqual(["alice", "bob", "carol"]);
  });

  it("does not drop a frozen participant who disconnects during an asynchronous start guard", async () => {
    let releaseGuard!: () => void;
    let guardStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseGuard = resolve; });
    const started = new Promise<void>((resolve) => { guardStarted = resolve; });
    const { runtime, time } = setup();
    let participantChecks = 0;
    const controller = createHandController(runtime, {
      assertHandCanStart: async () => {
        guardStarted();
        await release;
      },
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "13131313-1313-4131-8131-131313131313",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      prepareHandParticipants: (seats) => {
        participantChecks += 1;
        return seats;
      },
      retainConnectedParticipants: (seats) => {
        participantChecks += 1;
        return seats;
      },
      scheduler: time,
    });
    await controller.evaluateStart();
    const countdown = time.advanceBy(5_000);
    await started;
    runtime.removePresence("bob", "b");
    releaseGuard();
    await countdown;

    expect(participantChecks).toBe(2);
    expect(runtime.currentHand?.state.players.map((player) => player.playerId).sort()).toEqual(["alice", "bob"]);
    expect(runtime.status).toBe("PLAYING");
  });

  it("finishes asynchronous participant validation before the final database start guard", async () => {
    let releaseParticipants!: () => void;
    let participantsStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseParticipants = resolve; });
    const started = new Promise<void>((resolve) => { participantsStarted = resolve; });
    const { runtime, time } = setup();
    let roomMayStart = true;
    const controller = createHandController(runtime, {
      assertHandCanStart: () => {
        if (!roomMayStart) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "房间已暂停");
      },
      clock: time,
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "14141414-1414-4141-8141-141414141414",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      prepareHandParticipants: async (seats) => {
        participantsStarted();
        await release;
        return seats;
      },
      scheduler: time,
    });
    await controller.evaluateStart();
    const countdown = time.advanceBy(5_000);
    await started;
    roomMayStart = false;
    releaseParticipants();
    await countdown;

    expect(runtime.currentHand).toBeNull();
    expect(runtime.status).toBe("IDLE");
  });

  it("never clears or restarts a RECOVERY_ERROR runtime during ordinary eligibility evaluation", async () => {
    const { controller, runtime } = setup();
    runtime.status = "RECOVERY_ERROR";
    const version = runtime.stateVersion;

    await controller.evaluateStart();

    expect(runtime).toMatchObject({ currentHand: null, startCountdownAt: null, stateVersion: version, status: "RECOVERY_ERROR" });
  });

  it("keeps a manually stopped CLOSED room terminal during presence-driven eligibility evaluation", async () => {
    const { controller, runtime } = setup();
    runtime.room = { ...runtime.room, requiresManualStart: true, status: "CLOSED", tableStartedAt: null };
    runtime.status = "CLOSED";
    const version = runtime.stateVersion;

    await controller.evaluateStart();

    expect(runtime).toMatchObject({ currentHand: null, startCountdownAt: null, stateVersion: version, status: "CLOSED" });
  });

  it("does not schedule a new action timer after disposal crosses an in-flight committed action", async () => {
    let releaseCommit!: () => void;
    let commitStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const started = new Promise<void>((resolve) => { commitStarted = resolve; });
    const { controller: seedController, runtime, time } = setup();
    await seedController.evaluateStart(); await time.advanceBy(5_000);
    seedController.dispose();
    let scheduled = 0;
    const scheduler = {
      schedule() {
        scheduled += 1;
        return { cancel() { /* test observes scheduling, cancellation is irrelevant */ } };
      },
    };
    const controller = createHandController(runtime, {
      clock: time,
      commitPlayerAction: async (state, input) => {
        commitStarted();
        await release;
        const current = state.currentHand!;
        const actor = current.state.players.find((player) => player.playerId === input.userId)!;
        const applied = applyPlayerAction(current.state, { actionType: "call", playerId: actor.playerId });
        return { events: applied.events, replayed: false, result: { alreadyProcessed: false, events: [], stateVersion: state.stateVersion + 1 }, state: { ...state, currentHand: { ...current, state: applied.state, turnDeadlineAt: new Date(time.now().getTime() + 15_000) }, stateVersion: state.stateVersion + 1 } };
      },
      deckProvider: new FixedDeckProvider(createStandardDeck()),
      idFactory: () => "15151515-1515-4151-8151-151515151515",
      persistCompletedHand: async (table) => ({ remainingSeats: [...table.seats.values()], roomStatus: table.room.status }),
      scheduler,
    });
    const hand = runtime.currentHand!.state;
    const actor = hand.players.find((player) => player.seatIndex === hand.currentActorSeat)!.playerId;
    const action = controller.submitAction(actor, { action: { type: "call" }, clientActionId: "15151515-0000-4000-8000-000000000001", expectedStateVersion: runtime.stateVersion, handId: hand.handId, roomId: runtime.room.roomId });
    await started;
    controller.dispose();
    releaseCommit();
    await action;

    expect(scheduled).toBe(0);
  });
});

function handIdForCache(runtime: TableRuntime): string {
  return runtime.currentHand!.state.handId;
}
