import type { Prisma } from "../generated/prisma/client.js";

export interface RoomDataDeletionResult {
  readonly hands: number;
  readonly rooms: number;
}

export async function deleteRoomDataInTransaction(
  transaction: Prisma.TransactionClient,
  roomIds: readonly string[],
): Promise<RoomDataDeletionResult> {
  if (roomIds.length === 0) return { hands: 0, rooms: 0 };
  const hands = await transaction.handRecord.findMany({
    select: { id: true },
    where: { roomId: { in: [...roomIds] } },
  });
  const handIds = hands.map((hand) => hand.id);

  await transaction.auditLog.deleteMany({
    where: {
      OR: [
        { roomId: { in: [...roomIds] } },
        { handId: { in: handIds } },
        { targetType: "ROOM", targetId: { in: [...roomIds] } },
      ],
    },
  });
  await transaction.paidCardReveal.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.paidHandRevealPurchase.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.hypotheticalRunoutPurchase.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.handHypotheticalRunout.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.tableActionReceipt.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.tableStackLedgerEntry.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.walletLedgerEntry.deleteMany({ where: { relatedRoomId: { in: [...roomIds] } } });
  await transaction.handActionRecord.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.handRunoutPotRecord.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.handRunoutRecord.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.handPotRecord.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.handPlayerRecord.deleteMany({ where: { handId: { in: handIds } } });
  await transaction.handRecord.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.tableSnapshot.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.tableSeat.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.gameSession.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.roomMember.deleteMany({ where: { roomId: { in: [...roomIds] } } });
  await transaction.requestIdempotency.deleteMany({ where: { resourceId: { in: [...roomIds] } } });
  const deleted = await transaction.room.deleteMany({ where: { id: { in: [...roomIds] }, status: "CLOSED" } });
  if (deleted.count !== roomIds.length) throw new Error("room deletion requires CLOSED rooms");
  return { hands: handIds.length, rooms: deleted.count };
}
