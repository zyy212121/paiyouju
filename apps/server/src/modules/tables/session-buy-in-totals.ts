interface SessionBuyInEntry {
  readonly sequence: number;
  readonly signedAmount: number;
  readonly type: string;
}

export interface SessionBuyInRow {
  readonly id: string;
  readonly roomId: string;
  readonly startedAt: Date;
  readonly tableStackEntries: readonly SessionBuyInEntry[];
  readonly totalBuyIn: number;
  readonly userId: string;
}

export function effectiveBuyInTotalsByUser(
  rows: readonly SessionBuyInRow[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  const seenRoomUsers = new Set<string>();
  const ordered = [...rows].sort((left, right) =>
    left.roomId.localeCompare(right.roomId)
    || left.userId.localeCompare(right.userId)
    || left.startedAt.getTime() - right.startedAt.getTime()
    || left.id.localeCompare(right.id));

  for (const session of ordered) {
    const roomUserKey = `${session.roomId}\u0000${session.userId}`;
    const firstEntry = session.tableStackEntries[0];
    const repeatedLegacySeatGrant = seenRoomUsers.has(roomUserKey)
      && firstEntry?.sequence === 1
      && firstEntry.type === "BUY_IN"
      ? Math.max(0, firstEntry.signedAmount)
      : 0;
    const effectiveBuyIn = Math.max(0, session.totalBuyIn - repeatedLegacySeatGrant);
    totals.set(session.userId, (totals.get(session.userId) ?? 0) + effectiveBuyIn);
    seenRoomUsers.add(roomUserKey);
  }

  return totals;
}
