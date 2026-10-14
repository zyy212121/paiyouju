import { createShortDeck, createStandardDeck, startHand } from "@paiyouju/poker-core";
import { describe, expect, it } from "vitest";

import { TableRuntime } from "../runtime/table-runtime.js";
import type { RuntimeRoomConfig, RuntimeSeat } from "../runtime/types.js";
import {
  SnapshotValidationError,
  deserializeTableSnapshot,
  serializeTableSnapshot,
  validateTableSnapshot,
} from "./snapshot-codec.js";
import { TABLE_SNAPSHOT_SCHEMA_VERSION } from "./snapshot-schema.js";

const room: RuntimeRoomConfig = {
  actionTimeSeconds: 30,
  bigBlind: 20,
  durationMinutes: 60,
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  maximumBuyIn: 2_000,
  maxSeats: 2,
  minimumBuyIn: 400,
  name: "恢复测试",
  nextHandPaused: false,
  ownerId: "owner-1",
  roomCode: "123456",
  roomId: "room-1",
  requiresManualStart: true,
  smallBlind: 10,
  status: "OPEN",
  tableStartedAt: null,
};

const seats: readonly RuntimeSeat[] = [
  { avatarId: "avatar-04", gameSessionId: "game-a", nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, nickname: "Alice", pendingShowCardIndices: [], playStatus: "ACTIVE", reservedAwayEndsAt: null, seatId: "seat-a", seatIndex: 0, squidMarked: false, squidRoundParticipant: false, stack: 400, trusteeshipEnabled: false, userId: "alice", version: 1 },
  { avatarId: "avatar-09", gameSessionId: "game-b", nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, nickname: "Bob", pendingShowCardIndices: [], playStatus: "ACTIVE", reservedAwayEndsAt: null, seatId: "seat-b", seatIndex: 1, squidMarked: false, squidRoundParticipant: false, stack: 400, trusteeshipEnabled: false, userId: "bob", version: 1 },
];

function activeRuntime(): TableRuntime {
  const runtime = new TableRuntime(room);
  for (const seat of seats) runtime.seats.set(seat.seatIndex, seat);
  const state = startHand({
    config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 },
    deck: createStandardDeck(),
    handId: "11111111-1111-4111-8111-111111111111",
    previousButtonSeat: null,
    seats: seats.map((seat) => ({ isParticipating: true, playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
  }).state;
  runtime.currentHand = {
    actions: [],
    handNumber: 7,
    paidCardRevealCost: 0,
    paidCardRevealEnabled: false,
    runoutChoicesByUser: {},
    runoutVote: null,
    startedAt: new Date("2026-08-14T00:00:00.000Z"),
    state,
    turnDeadlineAt: new Date("2026-08-14T00:00:30.000Z"),
  };
  runtime.handNumber = 7;
  runtime.lastButtonSeat = 1;
  runtime.stateVersion = 11;
  runtime.status = "PLAYING";
  runtime.snapshotRevision = 4;
  return runtime;
}

function activeShortDeckRuntime(): TableRuntime {
  const shortRoom: RuntimeRoomConfig = {
    ...room,
    initialBuyIn: 500,
    maximumBuyIn: 2_000,
    minimumBuyIn: 500,
    specialMode: "SHORT_DECK",
  };
  const shortSeats = seats.map((seat) => ({ ...seat, stack: 500 }));
  const runtime = new TableRuntime(shortRoom);
  for (const seat of shortSeats) runtime.seats.set(seat.seatIndex, seat);
  const state = startHand({
    config: { bigBlind: 20, maxSeats: 2, smallBlind: 10, variant: "SHORT_DECK" },
    deck: createShortDeck(),
    handId: "33333333-3333-4333-8333-333333333333",
    previousButtonSeat: null,
    seats: shortSeats.map((seat) => ({ isParticipating: true, playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
  }).state;
  runtime.currentHand = {
    actions: [],
    handNumber: 8,
    paidCardRevealCost: 0,
    paidCardRevealEnabled: false,
    runoutChoicesByUser: {},
    runoutVote: null,
    startedAt: new Date("2026-08-30T00:00:00.000Z"),
    state,
    turnDeadlineAt: new Date("2026-08-30T00:00:30.000Z"),
  };
  runtime.handNumber = 8;
  runtime.lastButtonSeat = 1;
  runtime.stateVersion = 12;
  runtime.status = "PLAYING";
  runtime.snapshotRevision = 5;
  return runtime;
}

function activeBombPotRuntime(): TableRuntime {
  const bombRoom: RuntimeRoomConfig = {
    ...room,
    bombPotBlindMultiplier: 3,
    bombPotIntervalMinutes: 5,
    bombPotNextAt: new Date("2026-08-30T00:05:00.000Z"),
    specialMode: "BOMB_POT",
    tableStartedAt: new Date("2026-08-30T00:00:00.000Z"),
  };
  const runtime = new TableRuntime(bombRoom);
  for (const seat of seats) runtime.seats.set(seat.seatIndex, seat);
  const state = startHand({
    bombPotBlind: 60,
    config: { bigBlind: 20, maxSeats: 2, smallBlind: 10 },
    deck: createStandardDeck(),
    handId: "44444444-4444-4444-8444-444444444444",
    previousButtonSeat: null,
    seats: seats.map((seat) => ({ isParticipating: true, playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
  }).state;
  runtime.currentHand = { actions: [], handNumber: 9, paidCardRevealCost: 0, paidCardRevealEnabled: false, runoutChoicesByUser: {}, runoutVote: null, startedAt: new Date("2026-08-30T00:05:00.000Z"), state, turnDeadlineAt: new Date("2026-08-30T00:05:30.000Z") };
  runtime.handNumber = 9;
  runtime.lastButtonSeat = 1;
  runtime.stateVersion = 13;
  runtime.status = "PLAYING";
  runtime.snapshotRevision = 6;
  return runtime;
}

function record(runtime = activeRuntime()) {
  const serialized = serializeTableSnapshot(runtime);
  return {
    ...serialized,
    id: "snapshot-1",
    roomId: runtime.room.roomId,
    snapshotRevision: runtime.snapshotRevision,
  };
}

const relations = { room, seats };

describe("versioned table snapshot codec", () => {
  it("round-trips every private hand field without serializing process objects or credentials", () => {
    const runtime = activeRuntime();
    const serialized = record(runtime);
    const json = JSON.stringify(serialized);

    expect(serialized.schemaVersion).toBe(TABLE_SNAPSHOT_SCHEMA_VERSION);
    expect(json).not.toMatch(/socket|timer|scheduler|logger|password|cookie|token|databaseUrl|actionCache/i);
    const recovered = deserializeTableSnapshot(serialized, relations);
    expect(recovered.currentHand).toEqual(runtime.currentHand);
    expect(recovered.stateVersion).toBe(11);
    expect(recovered.snapshotRevision).toBe(4);
    expect(recovered.seats).toEqual(seats);
  });

  it("round-trips a short-deck hand without widening it back to a standard deck", () => {
    const runtime = activeShortDeckRuntime();
    const serialized = serializeTableSnapshot(runtime);
    const recovered = deserializeTableSnapshot(
      {
        ...serialized,
        id: "snapshot-short-deck",
        roomId: runtime.room.roomId,
        snapshotRevision: runtime.snapshotRevision,
      },
      { room: runtime.room, seats: [...runtime.seats.values()] },
    );

    expect(recovered.room.specialMode).toBe("SHORT_DECK");
    expect(recovered.currentHand?.state.config.variant).toBe("SHORT_DECK");
    const cards = recovered.currentHand
      ? [...recovered.currentHand.state.deck, ...recovered.currentHand.state.board, ...recovered.currentHand.state.players.flatMap((player) => player.holeCards)]
      : [];
    expect(cards).toHaveLength(36);
    expect(cards.every((card) => card.rank >= 6)).toBe(true);
  });

  it("round-trips a bomb-pot deadline and active forced blind", () => {
    const runtime = activeBombPotRuntime();
    const serialized = serializeTableSnapshot(runtime);
    const recovered = deserializeTableSnapshot({ ...serialized, id: "snapshot-bomb", roomId: runtime.room.roomId, snapshotRevision: runtime.snapshotRevision }, { room: runtime.room, seats: [...runtime.seats.values()] });

    expect(recovered.room).toMatchObject({ bombPotBlindMultiplier: 3, bombPotIntervalMinutes: 5, bombPotNextAt: new Date("2026-08-30T00:05:00.000Z"), specialMode: "BOMB_POT" });
    expect(recovered.currentHand?.state).toMatchObject({ bombPotBlind: 60, street: "flop" });
  });

  it("strictly rejects unsupported versions, duplicate cards, invalid actors, reveal-config drift, and column/payload drift", () => {
    const valid = record();
    const payload = structuredClone(valid.payload);
    if (!payload.currentHand) throw new Error("fixture hand missing");

    expect(() => validateTableSnapshot({ ...valid, schemaVersion: 7 }, relations)).toThrow(SnapshotValidationError);

    const duplicate = structuredClone(payload);
    if (!duplicate.currentHand) throw new Error("fixture hand missing");
    duplicate.currentHand.state.deck[0] = duplicate.currentHand.state.players[0]!.holeCards[0]!;
    expect(() => validateTableSnapshot({ ...valid, payload: duplicate }, relations)).toThrow(SnapshotValidationError);

    const badActor = structuredClone(payload);
    if (!badActor.currentHand) throw new Error("fixture hand missing");
    badActor.currentHand.state.currentActorSeat = 8;
    expect(() => validateTableSnapshot({ ...valid, payload: badActor }, relations)).toThrow(SnapshotValidationError);

    const badFrozenReveal = structuredClone(payload);
    if (!badFrozenReveal.currentHand) throw new Error("fixture hand missing");
    badFrozenReveal.currentHand.paidCardRevealEnabled = false;
    badFrozenReveal.currentHand.paidCardRevealCost = 10;
    expect(() => validateTableSnapshot({ ...valid, payload: badFrozenReveal }, relations)).toThrow(SnapshotValidationError);

    const badRoomReveal = structuredClone(payload);
    badRoomReveal.room.paidCardRevealEnabled = true;
    badRoomReveal.room.paidCardRevealCost = 0;
    expect(() => validateTableSnapshot({ ...valid, payload: badRoomReveal }, relations)).toThrow(SnapshotValidationError);

    expect(() => validateTableSnapshot({ ...valid, stateVersion: valid.stateVersion + 1 }, relations)).toThrow(SnapshotValidationError);
    expect(() => validateTableSnapshot({ ...valid, activeHandId: "22222222-2222-4222-8222-222222222222" }, relations)).toThrow(SnapshotValidationError);
  });

  it("rejects room, seat, session, stack, and table-accounting mismatches", () => {
    const valid = record();
    expect(() => validateTableSnapshot(valid, { room: { ...room, status: "CLOSING" }, seats })).toThrow(SnapshotValidationError);
    expect(() => validateTableSnapshot(valid, { room, seats: [{ ...seats[0]!, stack: 399 }, seats[1]!] })).toThrow(SnapshotValidationError);
    expect(() => validateTableSnapshot(valid, { room, seats: [{ ...seats[0]!, gameSessionId: "other" }, seats[1]!] })).toThrow(SnapshotValidationError);
    expect(() => validateTableSnapshot(valid, { room, seats: [seats[0]!] })).toThrow(SnapshotValidationError);
  });

  it("supports IDLE, PAUSED, CLOSING, CLOSED, and persistence-error states without inventing a hand", () => {
    for (const status of ["IDLE", "PAUSED", "CLOSING", "CLOSED", "PERSISTENCE_ERROR"] as const) {
      const runtime = new TableRuntime({ ...room, nextHandPaused: status === "PAUSED", status: status === "CLOSED" ? "CLOSED" : status === "CLOSING" ? "CLOSING" : "OPEN" });
      for (const seat of status === "CLOSED" ? [] : seats) runtime.seats.set(seat.seatIndex, seat);
      runtime.status = status;
      runtime.stateVersion = 3;
      const serialized = serializeTableSnapshot(runtime);
      const restored = deserializeTableSnapshot(
        { ...serialized, id: `snapshot-${status}`, roomId: room.roomId, snapshotRevision: 0 },
        { room: runtime.room, seats: [...runtime.seats.values()] },
      );
      expect(restored.status).toBe(status);
      expect(restored.currentHand).toBeNull();
    }
  });

  it("upgrades legacy Step 5 snapshots with reveals disabled while adopting current display data", () => {
    const current = structuredClone(record());
    const legacy = { ...current, schemaVersion: 1 };
    const payload = legacy.payload as unknown as {
      currentHand: { paidCardRevealCost?: number; paidCardRevealEnabled?: boolean } | null;
      lastCompletedHand?: unknown;
      postHandReview?: unknown;
      room: {
        ownerId?: string;
        paidCardRevealCost?: number;
        paidCardRevealEnabled?: boolean;
        requiresManualStart?: boolean;
        tableStartedAt?: string | null;
      };
      seats: Array<{
        avatarId?: string;
        nextActionAutoCallCurrentBet?: number | null;
        nextActionAutopilotArmed?: boolean;
        reservedAwayEndsAt?: string | null;
      }>;
    };
    if (!payload.currentHand) throw new Error("fixture hand missing");
    delete payload.currentHand.paidCardRevealCost;
    delete payload.currentHand.paidCardRevealEnabled;
    delete payload.lastCompletedHand;
    delete payload.postHandReview;
    delete payload.room.ownerId;
    delete payload.room.paidCardRevealCost;
    delete payload.room.paidCardRevealEnabled;
    delete payload.room.requiresManualStart;
    delete payload.room.tableStartedAt;
    for (const seat of payload.seats) {
      delete seat.avatarId;
      delete seat.nextActionAutoCallCurrentBet;
      delete seat.nextActionAutopilotArmed;
      delete seat.reservedAwayEndsAt;
    }
    const currentRoom = { ...room, paidCardRevealCost: 10, paidCardRevealEnabled: true };
    const currentSeats = [{ ...seats[0]!, avatarId: "avatar-12" as const, nickname: "爱丽丝" }, seats[1]!] as const;

    const recovered = deserializeTableSnapshot(legacy, { room: currentRoom, seats: currentSeats });

    expect(recovered.currentHand).toMatchObject({ paidCardRevealCost: 0, paidCardRevealEnabled: false });
    expect(recovered.room).toMatchObject({ paidCardRevealCost: 10, paidCardRevealEnabled: true });
    expect(recovered.seats[0]?.nickname).toBe("爱丽丝");
    expect(recovered.seats[0]?.avatarId).toBe("avatar-12");
    expect(recovered.seats.every((seat) => !seat.nextActionAutopilotArmed && seat.reservedAwayEndsAt === null)).toBe(true);
    expect(recovered.postHandReview).toBeNull();
  });

  it("reads healthy pre-squid schema-v2 snapshots with conservative mode defaults", () => {
    const previous = structuredClone(record());
    previous.schemaVersion = 2;
    const payloadRoom = previous.payload.room as Partial<typeof previous.payload.room>;
    delete payloadRoom.specialMode;
    delete payloadRoom.squidRoundGraceEndsAt;
    delete payloadRoom.squidRoundNumber;
    delete payloadRoom.squidSettlementPending;
    delete payloadRoom.squidStake;
    for (const seat of previous.payload.seats as Array<Partial<(typeof previous.payload.seats)[number]>>) {
      delete seat.squidMarked;
      delete seat.squidRoundParticipant;
      delete seat.trusteeshipEnabled;
    }

    const recovered = deserializeTableSnapshot(previous, relations);

    expect(recovered.room).toMatchObject({ specialMode: "NORMAL", squidRoundGraceEndsAt: null, squidRoundNumber: 1, squidSettlementPending: false, squidStake: null });
    expect(recovered.seats.every((seat) => !seat.squidMarked && !seat.squidRoundParticipant && !seat.trusteeshipEnabled)).toBe(true);
  });

  it("adopts authoritative room clock fields when older snapshots predate the room clock", () => {
    const legacyClock = structuredClone(record());
    const payloadRoom = legacyClock.payload.room as Partial<typeof legacyClock.payload.room>;
    delete payloadRoom.durationMinutes;
    delete payloadRoom.expiresAt;

    const recovered = deserializeTableSnapshot(legacyClock, relations);

    expect(recovered.room.durationMinutes).toBe(room.durationMinutes);
    expect(recovered.room.expiresAt).toEqual(room.expiresAt);
  });

  it("revalidates a repaired snapshot after an earlier recovery error marker", () => {
    const marked = {
      ...record(),
      recoveryStatus: "ERROR" as const,
      runtimeStatus: "RECOVERY_ERROR",
    };

    const recovered = deserializeTableSnapshot(marked, relations);

    expect(recovered.status).toBe("PLAYING");
    expect(recovered.currentHand?.state.handId).toBe("11111111-1111-4111-8111-111111111111");
  });
});
