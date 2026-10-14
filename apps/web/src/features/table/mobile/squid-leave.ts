import type { ProjectedSeat, TableStateProjection } from "@paiyouju/shared";

export interface SquidLeaveConfirmation {
  readonly message: string;
  readonly penaltyApplies: true;
}

export function squidLeaveConfirmation(
  room: TableStateProjection["room"],
  seat: ProjectedSeat,
  nowMs = Date.now(),
): SquidLeaveConfirmation | null {
  if (room.specialMode !== "SQUID" || room.tableStartedAt === null || !seat.squidRoundParticipant) return null;
  const graceDeadline = room.squidRoundGraceEndsAt ? Date.parse(room.squidRoundGraceEndsAt) : Number.NaN;
  if (Number.isFinite(graceDeadline) && graceDeadline > nowMs) return null;
  return {
    message: seat.squidMarked
      ? "站起后鱿鱼标记会丢失，本轮不会获得鱿鱼支付。确定站起吗？"
      : `当前离开会直接结束本轮，并向本轮其他玩家每人支付 ${room.squidStake?.toLocaleString() ?? "本局设定"} 点鱿鱼筹码。确定站起吗？`,
    penaltyApplies: true,
  };
}
