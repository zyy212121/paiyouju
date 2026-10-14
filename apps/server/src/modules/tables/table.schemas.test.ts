import { describe, expect, it } from "vitest";

import {
  BuyInInputSchema,
  SeatOperationInputSchema,
  TakeSeatInputSchema,
} from "./table.schemas.js";

const operationId = "11111111-1111-4111-8111-111111111111";

describe("table command schemas", () => {
  it("accepts strict bounded seat and buy-in intentions", () => {
    expect(TakeSeatInputSchema.parse({
      buyInAmount: 400,
      expectedStateVersion: 0,
      operationId,
      roomId: "room-1",
      seatIndex: 0,
    })).toMatchObject({ buyInAmount: 400, seatIndex: 0 });
    expect(BuyInInputSchema.parse({
      amount: 100,
      expectedStateVersion: 1,
      operationId,
      roomId: "room-1",
    })).toMatchObject({ amount: 100 });
  });

  it.each([
    { buyInAmount: 0 },
    { buyInAmount: 1.5 },
    { buyInAmount: 2_000_000_001 },
    { seatIndex: -1 },
    { seatIndex: 9 },
    { operationId: "predictable" },
    { expectedStateVersion: -1 },
    { userId: "client-must-not-send-identity" },
  ])("rejects invalid or authority-bearing seat payload %#", (override) => {
    expect(() => TakeSeatInputSchema.parse({
      buyInAmount: 400,
      expectedStateVersion: 0,
      operationId,
      roomId: "room-1",
      seatIndex: 0,
      ...override,
    })).toThrow();
  });

  it("uses the same durable operation envelope for lifecycle commands", () => {
    expect(SeatOperationInputSchema.parse({
      expectedStateVersion: 5,
      operationId,
      roomId: "room-1",
    })).toEqual({ expectedStateVersion: 5, operationId, roomId: "room-1" });
  });
});
