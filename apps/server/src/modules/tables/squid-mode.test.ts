import { describe, expect, it } from "vitest";

import { resolveSquidHandEnd, type SquidSeatState } from "./squid-mode.js";

const seats = (overrides: Partial<Record<string, Partial<SquidSeatState>>> = {}): SquidSeatState[] =>
  ["alice", "bob", "charlie"].map((userId, seatIndex) => ({
    leavingAfterHand: false,
    marked: false,
    participant: true,
    seatIndex,
    stack: 1_000,
    userId,
    ...overrides[userId],
  }));

describe("squid hand-end resolution", () => {
  it("marks only a unique main-pot winner and ignores a side-pot winner", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: false,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["alice"],
      seats: seats(),
      stakePerRecipient: 20,
    });
    expect(result.roundCompleted).toBe(false);
    expect(result.seats.find((seat) => seat.userId === "alice")?.marked).toBe(true);
    expect(result.settlement).toBeNull();
  });

  it("does not mark anyone when the main pot is split", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: false,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["alice", "bob"],
      seats: seats(),
      stakePerRecipient: 20,
    });
    expect(result.seats.every((seat) => !seat.marked)).toBe(true);
    expect(result.roundCompleted).toBe(false);
  });

  it("settles when marking the winner leaves one unmarked participant", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: false,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["bob"],
      seats: seats({ alice: { marked: true } }),
      stakePerRecipient: 20,
    });
    expect(result.roundCompleted).toBe(true);
    expect(result.settlement).toEqual({
      autoBuyInAmount: 0,
      payerStackAfterPayment: 960,
      payerUserId: "charlie",
      recipientUserIds: ["alice", "bob"],
      stakePerRecipient: 20,
      totalPayment: 40,
    });
    expect(Object.fromEntries(result.seats.map((seat) => [seat.userId, seat.stack]))).toEqual({
      alice: 1_020,
      bob: 1_020,
      charlie: 960,
    });
    expect(result.seats.every((seat) => !seat.marked && seat.participant)).toBe(true);
  });

  it("auto-buys through a zero or negative payment result up to the initial buy-in", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: false,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["bob"],
      seats: seats({ alice: { marked: true }, charlie: { stack: 10 } }),
      stakePerRecipient: 20,
    });
    expect(result.settlement).toMatchObject({
      autoBuyInAmount: 2_030,
      payerStackAfterPayment: -30,
      payerUserId: "charlie",
      totalPayment: 40,
    });
    expect(result.seats.find((seat) => seat.userId === "charlie")?.stack).toBe(2_000);
    const totalBefore = 2_010;
    const totalAfter = result.seats.reduce((sum, seat) => sum + seat.stack, 0);
    expect(totalAfter).toBe(totalBefore + 2_030);
  });

  it("keeps a forced no-mark leaver as payer even if that player wins the main pot", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: true,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["charlie"],
      seats: seats({
        alice: { marked: true },
        bob: { marked: true },
        charlie: { leavingAfterHand: true },
      }),
      stakePerRecipient: 20,
    });
    expect(result.settlement?.payerUserId).toBe("charlie");
  });

  it("excludes a late joiner from the frozen settlement and enrolls them next round", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: true,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["alice"],
      seats: seats({
        alice: { marked: true },
        bob: { marked: true },
        charlie: { leavingAfterHand: true },
      }).concat({
        leavingAfterHand: false,
        marked: false,
        participant: false,
        seatIndex: 3,
        stack: 2_000,
        userId: "late",
      }),
      stakePerRecipient: 20,
    });
    expect(result.settlement?.recipientUserIds).toEqual(["alice", "bob"]);
    expect(result.seats.find((seat) => seat.userId === "late")).toMatchObject({
      marked: false,
      participant: true,
      stack: 2_000,
    });
  });

  it("ends a forced round without payment when later departures leave fewer than two participants", () => {
    const result = resolveSquidHandEnd({
      forcedSettlementPending: true,
      initialBuyIn: 2_000,
      mainPotWinnerUserIds: ["alice"],
      seats: seats({
        alice: { leavingAfterHand: true },
        bob: { marked: true, participant: false },
        charlie: { marked: true, participant: false },
      }),
      stakePerRecipient: 20,
    });

    expect(result).toMatchObject({ roundCompleted: true, settlement: null });
    expect(result.seats.every((seat) => !seat.marked && seat.participant)).toBe(true);
  });
});
