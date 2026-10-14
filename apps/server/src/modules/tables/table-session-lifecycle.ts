import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";

export async function finalizeRoomGameSessions(
  transaction: Prisma.TransactionClient,
  input: { readonly closedAt: Date; readonly reason: string; readonly roomId: string },
): Promise<void> {
  const sessions = await transaction.gameSession.findMany({
    include: { tableSeat: { select: { id: true, stack: true } } },
    orderBy: { userId: "asc" },
    where: { roomId: input.roomId, status: "ACTIVE" },
  });

  for (const session of sessions) {
    const finalStack = session.tableSeat?.stack ?? session.detachedStack;
    if (finalStack === null) {
      throw new ApiError(500, "PERSISTENCE_ERROR", "活动牌桌会话缺少可结算的后手");
    }
    if (finalStack > 0) {
      const lastEntry = await transaction.tableStackLedgerEntry.findFirst({
        orderBy: { sequence: "desc" },
        select: { sequence: true },
        where: { gameSessionId: session.id },
      });
      await transaction.tableStackLedgerEntry.create({
        data: {
          gameSessionId: session.id,
          idempotencyKey: `table-cash-out:${input.reason}:${session.id}`,
          requestFingerprint: `table-cash-out:${input.reason}:${session.id}:${finalStack}`,
          roomId: input.roomId,
          sequence: (lastEntry?.sequence ?? 0) + 1,
          signedAmount: -finalStack,
          stackAfter: 0,
          stackBefore: finalStack,
          type: "CASH_OUT",
          userId: session.userId,
        },
      });
    }
    await transaction.gameSession.update({
      data: {
        detachedStack: null,
        endedAt: input.closedAt,
        status: "CLOSED",
        totalCashOut: { increment: finalStack },
      },
      where: { id: session.id },
    });
  }

  await transaction.tableSeat.deleteMany({ where: { roomId: input.roomId } });
}
