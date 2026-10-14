import { ProfileSchema, ProfileUpdateInputSchema, type ProfileUpdateInput } from "@paiyouju/shared";

import type { DatabaseClient } from "../../db/client.js";
import { ApiError } from "../../http/api-error.js";
import type { HistoryService } from "../history/history.service.js";
import { effectiveBuyInTotalsByUser } from "../tables/session-buy-in-totals.js";

export function createProfileService(
  database: DatabaseClient,
  history: HistoryService,
  options: { readonly onProfileChanged?: (userId: string, input: ProfileUpdateInput) => void | Promise<void> } = {},
) {
  async function get(userId: string) {
    const [user, handTotals, handsWon, gameSessions, activeGameSessions, recentGames] = await Promise.all([
      database.user.findUnique({ include: { wallet: true }, where: { id: userId } }),
      database.handPlayerRecord.aggregate({ _count: { _all: true }, _sum: { netResult: true }, where: { userId } }),
      database.handPlayerRecord.count({ where: { hand: { pots: { some: { winners: { has: userId } } } }, userId } }),
      database.gameSession.findMany({
        orderBy: [{ roomId: "asc" }, { startedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          roomId: true,
          startedAt: true,
          tableStackEntries: {
            orderBy: { sequence: "asc" },
            select: { sequence: true, signedAmount: true, type: true },
            take: 1,
          },
          totalBuyIn: true,
          totalCashOut: true,
          userId: true,
        },
        where: { userId },
      }),
      database.gameSession.count({ where: { status: "ACTIVE", userId } }),
      history.listGames(userId, { limit: 5 }),
    ]);
    if (!user?.wallet) throw new ApiError(404, "PROFILE_NOT_FOUND", "个人资料不存在");
    const [handsLost, handsBreakEven, profitableHands] = await Promise.all([
      database.handPlayerRecord.count({ where: { netResult: { lt: 0 }, userId } }),
      database.handPlayerRecord.count({ where: { netResult: 0, userId } }),
      database.handPlayerRecord.count({ where: { netResult: { gt: 0 }, userId } }),
    ]);
    return ProfileSchema.parse({
      activeGameSessions,
      avatarId: user.avatarId,
      createdAt: user.createdAt.toISOString(),
      handsBreakEven,
      handsLost,
      handsPlayed: handTotals._count._all,
      handsWon,
      hasPhoneNumber: user.phoneNumber !== null,
      nickname: user.nickname,
      phoneMasked: user.phoneNumber
        ? `${user.phoneNumber.slice(0, 3)}****${user.phoneNumber.slice(-4)}`
        : null,
      profitableHands,
      recentGames: recentGames.items,
      role: user.role,
      totalBuyIn: effectiveBuyInTotalsByUser(gameSessions).get(userId) ?? 0,
      totalCashOut: gameSessions.reduce((sum, session) => sum + session.totalCashOut, 0),
      totalNetResult: handTotals._sum.netResult ?? 0,
      userId: user.id,
      username: user.username,
      walletBalance: user.wallet.balance,
    });
  }

  return {
    get,
    async update(userId: string, rawInput: ProfileUpdateInput) {
      const input = ProfileUpdateInputSchema.parse(rawInput);
      await database.user.update({
        data: {
          ...(input.avatarId === undefined ? {} : { avatarId: input.avatarId }),
          ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
        },
        where: { id: userId },
      });
      await options.onProfileChanged?.(userId, input);
      return get(userId);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
