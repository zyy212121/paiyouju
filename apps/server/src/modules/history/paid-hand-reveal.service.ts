import { PaidHandRevealResultSchema, type PaidHandRevealInput, type PaidHandRevealResult } from "@paiyouju/shared";
import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";

interface PaidHandRevealServiceOptions {
  readonly afterNewPurchaseWrites?: (transaction: Prisma.TransactionClient) => Promise<void> | void;
  readonly clock?: () => Date;
}

function fingerprint(handId: string): string {
  return createHash("sha256").update(JSON.stringify({ handId })).digest("hex");
}

function parseStored(value: Prisma.JsonValue | null): PaidHandRevealResult | null {
  const parsed = PaidHandRevealResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createPaidHandRevealService(
  database: DatabaseClient,
  options: PaidHandRevealServiceOptions = {},
) {
  const clock = options.clock ?? (() => new Date());

  return {
    async purchase(buyerUserId: string, handId: string, input: PaidHandRevealInput): Promise<PaidHandRevealResult> {
      const requestFingerprint = fingerprint(handId);
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Wallet" WHERE "userId" = ${buyerUserId} FOR UPDATE
        `;
        const replay = await transaction.requestIdempotency.findUnique({
          where: { scope_actorId_key: { actorId: buyerUserId, key: input.operationId, scope: "PAID_HAND_REVEAL" } },
        });
        if (replay) {
          if (replay.requestHash !== requestFingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "operationId 已用于其他整手看牌请求");
          const stored = parseStored(replay.response);
          if (!stored) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "整手看牌请求正在处理");
          return stored;
        }
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "HandRecord" WHERE "id" = ${handId} FOR UPDATE
        `;
        const hand = await transaction.handRecord.findUnique({ where: { id: handId } });
        if (!hand) {
          throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
        }
        // Keep relation reads sequential inside the interactive transaction. Prisma's
        // adapter-pg currently parallelizes multi-relation includes on one pg client,
        // which pg@8 deprecates and pg@9 will reject.
        const players = await transaction.handPlayerRecord.findMany({
          select: { gameSessionId: true, holeCardsPublic: true, holeCardsPublicReason: true, userId: true },
          where: { handId },
        });
        const membership = await transaction.roomMember.findUnique({
          where: { roomId_userId: { roomId: hand.roomId, userId: buyerUserId } },
        });
        if (!membership) {
          throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
        }
        const buyer = players.find((player) => player.userId === buyerUserId) ?? null;
        const paidCardReveals = await transaction.paidCardReveal.findMany({
          select: { id: true },
          where: { buyerUserId, handId },
        });
        const paidHandRevealPurchases = await transaction.paidHandRevealPurchase.findMany({
          where: { buyerUserId, handId },
        });
        if (hand.reviewEndsAt && clock().getTime() <= hand.reviewEndsAt.getTime()) {
          throw new ApiError(409, "HAND_REVIEW_IN_PROGRESS", "结算复盘结束后才能使用偷偷看");
        }
        const hiddenOpponents = players.filter((player) =>
          (!buyer || player.userId !== buyerUserId)
          && !(player.holeCardsPublic && player.holeCardsPublicReason !== "VOLUNTARY")
        );
        const wallet = await transaction.wallet.findUnique({ where: { userId: buyerUserId } });
        if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
        const existing = paidHandRevealPurchases[0];
        if (existing || paidCardReveals.length > 0) {
          const result = PaidHandRevealResultSchema.parse({
            alreadyOwned: true,
            cost: existing?.cost ?? 0,
            operationId: input.operationId,
            paidHandRevealPurchaseId: existing?.id ?? null,
            revealedPlayerCount: hiddenOpponents.length,
            walletBalance: wallet.balance,
          });
          await transaction.requestIdempotency.create({
            data: {
              actorId: buyerUserId,
              key: input.operationId,
              requestHash: requestFingerprint,
              resourceId: existing?.id ?? hand.id,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "PAID_HAND_REVEAL",
            },
          });
          return result;
        }
        if (hiddenOpponents.length === 0) throw new ApiError(409, "ALL_CARDS_PUBLIC", "本手所有底牌都已公开");
        if (!hand.paidCardRevealEnabled || hand.paidCardRevealCost <= 0) {
          throw new ApiError(409, "PAID_REVEAL_DISABLED", "该历史牌局未开启偷偷看");
        }
        const balanceAfter = wallet.balance - hand.paidCardRevealCost;
        if (balanceAfter < 0) throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", "钻石不足");
        const purchaseId = randomUUID();
        const walletVersion = wallet.version + 1;
        await transaction.wallet.update({ data: { balance: balanceAfter, version: walletVersion }, where: { id: wallet.id } });
        const walletEntry = await transaction.walletLedgerEntry.create({
          data: {
            balanceAfter,
            balanceBefore: wallet.balance,
            idempotencyKey: `paid-hand-reveal:${input.operationId}`,
            metadata: { paidHandRevealPurchaseId: purchaseId },
            relatedGameSessionId: buyer?.gameSessionId ?? null,
            relatedHandId: hand.id,
            relatedRoomId: hand.roomId,
            requestFingerprint,
            sequence: walletVersion,
            signedAmount: -hand.paidCardRevealCost,
            type: "PAID_CARD_REVEAL",
            userId: buyerUserId,
            walletId: wallet.id,
          },
        });
        const purchase = await transaction.paidHandRevealPurchase.create({
          data: {
            buyerUserId,
            cost: hand.paidCardRevealCost,
            handId: hand.id,
            id: purchaseId,
            idempotencyKey: input.operationId,
            requestFingerprint,
            roomId: hand.roomId,
            walletLedgerEntryId: walletEntry.id,
            walletSignedAmount: -hand.paidCardRevealCost,
            walletType: "PAID_CARD_REVEAL",
          },
        });
        const result = PaidHandRevealResultSchema.parse({
          alreadyOwned: false,
          cost: purchase.cost,
          operationId: input.operationId,
          paidHandRevealPurchaseId: purchase.id,
          revealedPlayerCount: hiddenOpponents.length,
          walletBalance: balanceAfter,
        });
        await transaction.requestIdempotency.create({
          data: {
            actorId: buyerUserId,
            key: input.operationId,
            requestHash: requestFingerprint,
            resourceId: purchase.id,
            response: result as unknown as Prisma.InputJsonValue,
            scope: "PAID_HAND_REVEAL",
          },
        });
        await options.afterNewPurchaseWrites?.(transaction);
        return result;
      });
    },
  };
}

export type PaidHandRevealService = ReturnType<typeof createPaidHandRevealService>;
