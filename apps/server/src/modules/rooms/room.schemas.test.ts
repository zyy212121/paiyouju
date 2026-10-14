import { describe, expect, it } from "vitest";

import { CreateRoomInputSchema, JoinRoomInputSchema } from "./room.schemas.js";

const validRoom = {
  actionTimeSeconds: 30,
  bigBlind: 20,
  durationMinutes: 60,
  maximumBuyIn: 2_000,
  maxSeats: 9,
  minimumBuyIn: 400,
  name: "  周末牌局  ",
};

describe("room input", () => {
  it("normalizes a valid room configuration", () => {
    expect(CreateRoomInputSchema.parse(validRoom)).toMatchObject({
      smallBlind: 10,
      name: "周末牌局",
      runItTwiceEnabled: false,
      specialMode: "NORMAL",
      squidStake: null,
    });
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      maximumBuyIn: 222_222_222,
      minimumBuyIn: 20,
    })).toMatchObject({ maximumBuyIn: 222_222_222, maxSeats: 9 });
  });

  it("allows run-it-twice only in normal rooms", () => {
    expect(CreateRoomInputSchema.parse({ ...validRoom, runItTwiceEnabled: true })).toMatchObject({
      runItTwiceEnabled: true,
      specialMode: "NORMAL",
    });
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: 2_000,
      runItTwiceEnabled: true,
      specialMode: "SQUID",
      squidStake: 20,
    })).toMatchObject({ runItTwiceEnabled: false, specialMode: "SQUID" });
  });

  it("accepts only a derived squid stake tier", () => {
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: 2_000,
      specialMode: "SQUID",
      squidStake: 60,
    })).toMatchObject({ specialMode: "SQUID", squidStake: 60 });
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: 2_000,
      specialMode: "SQUID",
      squidStake: 61,
    })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      specialMode: "NORMAL",
      squidStake: 20,
    })).toThrow();
  });

  it.each([
    [2, 1],
    [9, 5],
    [10, 5],
    [37, 19],
    [1_999, 1_000],
  ])("derives small blind from a manually entered %s-point big blind", (bigBlind, smallBlind) => {
    expect(CreateRoomInputSchema.parse({ ...validRoom, bigBlind })).toMatchObject({ bigBlind, smallBlind });
  });

  it("rejects a caller-supplied small blind and a big blind that does not stay below the default buy-in", () => {
    expect(() => CreateRoomInputSchema.parse({ ...validRoom, smallBlind: 1 })).toThrow();
    expect(() => CreateRoomInputSchema.parse({ ...validRoom, bigBlind: 2_000 })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      bigBlind: 500,
      initialBuyIn: undefined,
      maximumBuyIn: 2_000,
      minimumBuyIn: 500,
      specialMode: "SHORT_DECK",
    })).toThrow();
  });

  it("normalizes short-deck stack limits and disables every other mode", () => {
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: undefined,
      maximumBuyIn: 2_000,
      minimumBuyIn: 500,
      runItTwiceEnabled: true,
      specialMode: "SHORT_DECK",
    })).toMatchObject({
      initialBuyIn: 500,
      maximumBuyIn: 2_000,
      minimumBuyIn: 500,
      runItTwiceEnabled: false,
      specialMode: "SHORT_DECK",
      squidStake: null,
    });
  });

  it("requires valid short-deck lower and upper stack limits", () => {
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: undefined,
      maximumBuyIn: undefined,
      minimumBuyIn: undefined,
      specialMode: "SHORT_DECK",
    })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      initialBuyIn: undefined,
      maximumBuyIn: 499,
      minimumBuyIn: 500,
      specialMode: "SHORT_DECK",
    })).toThrow();
  });

  it("requires bounded bomb-pot timing and blind settings and disables run-it-twice", () => {
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 10,
      initialBuyIn: 2_000,
      runItTwiceEnabled: true,
      specialMode: "BOMB_POT",
    })).toMatchObject({
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 10,
      runItTwiceEnabled: false,
      specialMode: "BOMB_POT",
      squidStake: null,
    });
    expect(CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 1,
      initialBuyIn: 2_000,
      specialMode: "BOMB_POT",
    })).toMatchObject({ bombPotIntervalMinutes: 1, specialMode: "BOMB_POT" });
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 0,
      bombPotIntervalMinutes: 5,
      initialBuyIn: 2_000,
      specialMode: "BOMB_POT",
    })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 6,
      initialBuyIn: 2_000,
      specialMode: "BOMB_POT",
    })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 3,
      bombPotIntervalMinutes: 31,
      initialBuyIn: 2_000,
      specialMode: "BOMB_POT",
    })).toThrow();
    expect(() => CreateRoomInputSchema.parse({
      ...validRoom,
      bombPotBlindMultiplier: 3,
      specialMode: "NORMAL",
    })).toThrow();
  });

  it.each([
    { maxSeats: 1 },
    { maxSeats: 10 },
    { bigBlind: 1 },
    { maximumBuyIn: 399 },
    { maximumBuyIn: 222_222_223 },
    { actionTimeSeconds: 9 },
    { actionTimeSeconds: 46 },
    { actionTimeSeconds: 12 },
    { durationMinutes: 29 },
    { durationMinutes: 181 },
    { durationMinutes: 45 },
    { password: "123" },
    { name: "<script>" },
  ])("rejects an invalid room override %#", (override) => {
    expect(() => CreateRoomInputSchema.parse({ ...validRoom, ...override })).toThrow();
  });

  it.each([10, 15, 20, 25, 30, 35, 40, 45])("accepts %s-second stepped action time", (actionTimeSeconds) => {
    expect(CreateRoomInputSchema.parse({ ...validRoom, actionTimeSeconds }).actionTimeSeconds).toBe(actionTimeSeconds);
  });

  it.each([30, 60, 90, 120, 150, 180])("accepts %s-minute stepped room duration", (durationMinutes) => {
    expect(CreateRoomInputSchema.parse({ ...validRoom, durationMinutes }).durationMinutes).toBe(durationMinutes);
  });

  it("keeps leading zeroes in a six-digit join code", () => {
    expect(JoinRoomInputSchema.parse({ roomCode: "000123" })).toEqual({
      roomCode: "000123",
    });
    expect(() => JoinRoomInputSchema.parse({ roomCode: "123" })).toThrow();
  });
});
