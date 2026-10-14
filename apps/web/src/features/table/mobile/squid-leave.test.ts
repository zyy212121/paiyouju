import { describe, expect, it } from "vitest";

import { projectedSeat, tableState } from "../../../test/table-fixture.js";
import { squidLeaveConfirmation } from "./squid-leave.js";

const squidRoom = () => ({
  ...tableState().room,
  specialMode: "SQUID" as const,
  squidStake: 20,
  tableStartedAt: "2026-08-30T00:00:00.000Z",
});

describe("squid leave confirmation", () => {
  it("warns an active unmarked round participant about immediate settlement", () => {
    const result = squidLeaveConfirmation(squidRoom(), { ...projectedSeat(), squidRoundParticipant: true }, Date.parse("2026-08-30T00:01:00.000Z"));
    expect(result?.message).toContain("每人支付 20 点");
  });

  it("warns a marked participant that the mark and payout are lost", () => {
    const result = squidLeaveConfirmation(squidRoom(), { ...projectedSeat(), squidMarked: true, squidRoundParticipant: true }, Date.parse("2026-08-30T00:01:00.000Z"));
    expect(result?.message).toContain("标记会丢失");
  });

  it("does not warn before the table starts, during grace, or for a late excluded player", () => {
    const participant = { ...projectedSeat(), squidRoundParticipant: true };
    expect(squidLeaveConfirmation({ ...squidRoom(), tableStartedAt: null }, participant)).toBeNull();
    expect(squidLeaveConfirmation({ ...squidRoom(), squidRoundGraceEndsAt: "2026-08-30T00:02:00.000Z" }, participant, Date.parse("2026-08-30T00:01:00.000Z"))).toBeNull();
    expect(squidLeaveConfirmation(squidRoom(), projectedSeat(), Date.parse("2026-08-30T00:01:00.000Z"))).toBeNull();
  });
});
