import { PaidCardRevealResultSchema, type PaidCardRevealInput, type PaidCardRevealResult } from "@paiyouju/shared";
import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";

interface StoredRevealResponse {
  readonly alreadyOwned: boolean;
  readonly cost: number;
  readonly paidCardRevealId: string;
  readonly targetUserId: string;
  readonly walletBalance: number;
}

interface PaidCardRevealServiceOptions {
  readonly afterNewPurchaseWrites?: (transaction: Prisma.TransactionClient) => Promise<void> | void;
  readonly clock?: () => Date;
}

function fingerprint(handId: string, targetUserId: string): string {
  return createHash("sha256").update(JSON.stringify({ handId, targetUserId })).digest("hex");
}

function parseStoredResponse(value: unknown): StoredRevealResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(500, "PERSISTENCE_ERROR", "偷偷看幂等记录损坏");
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.alreadyOwned !== "boolean"
    || !Number.isSafeInteger(response.cost)
    || typeof response.paidCardRevealId !== "string"
    || typeof response.targetUserId !== "string"
    || !Number.isSafeInteger(response.walletBalance)
  ) {
    throw new ApiError(500, "PERSISTENCE_ERROR", "偷偷看幂等记录损坏");
  }
  return response as unknown as StoredRevealResponse;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export function createPaidCardRevealService(
  database: DatabaseClient,
  options: PaidCardRevealServiceOptions = {},
) {
  const clock = options.clock ?? (() => new Date());
  async function projectResult(
    transaction: Prisma.TransactionClient,
    operationId: string,
    stored: StoredRevealResponse,
  ): Promise<PaidCardRevealResult> {
    const reveal = await transaction.paidCardReveal.findUnique({
      include: { targetPlayer: { select: { holeCards: true } } },
      where: { id: stored.paidCardRevealId },
    });
    if (!reveal || reveal.targetUserId !== stored.targetUserId || reveal.targetPlayer.holeCards.length !== 2) {
      throw new ApiError(500, "PERSISTENCE_ERROR", "偷偷看授权记录损坏");
    }
    return PaidCardRevealResultSchema.parse({
      ...stored,
      holeCards: reveal.targetPlayer.holeCards,
      operationId,
    });
  }

  async function replayOrConflict(
    transaction: Prisma.TransactionClient,
    buyerUserId: string,
    operationId: string,
    requestFingerprint: string,
  ): Promise<PaidCardRevealResult | null> {
    const request = await transaction.requestIdempotency.findUnique({
      where: { scope_actorId_key: { actorId: buyerUserId, key: operationId, scope: "PAID_CARD_REVEAL" } },
    });
    if (!request) return null;
    if (request.requestHash !== requestFingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "operationId 已用于其他偷偷看请求");
    }
    if (!request.resourceId || request.response === null) {
      throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "偷偷看请求正在处理");
    }
    const stored = parseStoredResponse(request.response);
    if (stored.paidCardRevealId !== request.resourceId) {
      throw new ApiError(500, "PERSISTENCE_ERROR", "偷偷看幂等关系损坏");
    }
    return projectResult(transaction, operationId, stored);
  }

  return {
    async purchase(buyerUserId: string, handId: string, input: PaidCardRevealInput): Promise<PaidCardRevealResult> {
      const requestFingerprint = fingerprint(handId, input.targetUserId);
      try {
        return await database.$transaction(async (transaction) => {
          const lockedWallet = await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Wallet" WHERE "userId" = ${buyerUserId} FOR UPDATE
          `;
          if (lockedWallet.length === 0) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");

          const replay = await replayOrConflict(transaction, buyerUserId, input.operationId, requestFingerprint);
          if (replay) return replay;

          const lockedHand = await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "HandRecord" WHERE "id" = ${handId} FOR UPDATE
          `;
          if (lockedHand.length === 0) throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
          const hand = await transaction.handRecord.findUnique({
            include: {
              players: { select: { gameSessionId: true, holeCards: true, holeCardsPublic: true, holeCardsPublicReason: true, userId: true } },
            },
            where: { id: handId },
          });
          if (!hand) throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
          const membership = await transaction.roomMember.findUnique({
            where: { roomId_userId: { roomId: hand.roomId, userId: buyerUserId } },
          });
          if (!membership) throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
          const buyer = hand.players.find((player) => player.userId === buyerUserId) ?? null;
          if (hand.reviewEndsAt && clock().getTime() <= hand.reviewEndsAt.getTime()) {
            throw new ApiError(409, "HAND_REVIEW_IN_PROGRESS", "结算复盘结束后才能使用偷偷看");
          }
          if (input.targetUserId === buyerUserId) throw new ApiError(409, "TARGET_IS_SELF", "自己的底牌无需付费查看");
          const target = hand.players.find((player) => player.userId === input.targetUserId);
          if (!target || target.holeCards.length !== 2) throw new ApiError(404, "TARGET_NOT_IN_HAND", "目标玩家不在该手牌中");
          if (target.holeCardsPublic && target.holeCardsPublicReason !== "VOLUNTARY") {
            throw new ApiError(409, "CARD_ALREADY_PUBLIC", "目标底牌已经公开");
          }
          if (!hand.paidCardRevealEnabled || hand.paidCardRevealCost <= 0) {
            throw new ApiError(409, "PAID_REVEAL_DISABLED", "该历史牌局未开启偷偷看");
          }

          const existing = await transaction.paidCardReveal.findUnique({
            where: { buyerUserId_handId_targetUserId: { buyerUserId, handId, targetUserId: input.targetUserId } },
          });
          if (existing) {
            const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId: buyerUserId } });
            const stored: StoredRevealResponse = {
              alreadyOwned: true,
              cost: existing.cost,
              paidCardRevealId: existing.id,
              targetUserId: existing.targetUserId,
              walletBalance: wallet.balance,
            };
            await transaction.requestIdempotency.create({
              data: {
                actorId: buyerUserId,
                key: input.operationId,
                requestHash: requestFingerprint,
                resourceId: existing.id,
                response: stored as unknown as Prisma.InputJsonObject,
                scope: "PAID_CARD_REVEAL",
              },
            });
            return projectResult(transaction, input.operationId, stored);
          }

          const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId: buyerUserId } });
          const balanceAfter = wallet.balance - hand.paidCardRevealCost;
          if (balanceAfter < 0) throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", "钻石不足");
          const nextSequence = wallet.version + 1;
          const revealId = randomUUID();
          await transaction.wallet.update({
            data: { balance: balanceAfter, version: nextSequence },
            where: { id: wallet.id },
          });
          const walletEntry = await transaction.walletLedgerEntry.create({
            data: {
              balanceAfter,
              balanceBefore: wallet.balance,
              idempotencyKey: `paid-card-reveal:${input.operationId}`,
              metadata: { paidCardRevealId: revealId, targetUserId: input.targetUserId },
              relatedGameSessionId: buyer?.gameSessionId ?? null,
              relatedHandId: hand.id,
              relatedRoomId: hand.roomId,
              requestFingerprint,
              sequence: nextSequence,
              signedAmount: -hand.paidCardRevealCost,
              type: "PAID_CARD_REVEAL",
              userId: buyerUserId,
              walletId: wallet.id,
            },
          });
          const reveal = await transaction.paidCardReveal.create({
            data: {
              buyerUserId,
              cost: hand.paidCardRevealCost,
              handId: hand.id,
              id: revealId,
              idempotencyKey: input.operationId,
              requestFingerprint,
              roomId: hand.roomId,
              targetUserId: input.targetUserId,
              walletLedgerEntryId: walletEntry.id,
              walletSignedAmount: -hand.paidCardRevealCost,
              walletType: "PAID_CARD_REVEAL",
            },
          });
          const stored: StoredRevealResponse = {
            alreadyOwned: false,
            cost: reveal.cost,
            paidCardRevealId: reveal.id,
            targetUserId: reveal.targetUserId,
            walletBalance: balanceAfter,
          };
          await transaction.requestIdempotency.create({
            data: {
              actorId: buyerUserId,
              key: input.operationId,
              requestHash: requestFingerprint,
              resourceId: reveal.id,
              response: stored as unknown as Prisma.InputJsonObject,
              scope: "PAID_CARD_REVEAL",
            },
          });
          await options.afterNewPurchaseWrites?.(transaction);
          return projectResult(transaction, input.operationId, stored);
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const existing = await database.paidCardReveal.findUnique({ where: { idempotencyKey: input.operationId } });
          if (existing && (existing.buyerUserId !== buyerUserId || existing.requestFingerprint !== requestFingerprint)) {
            throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "operationId 已用于其他偷偷看请求");
          }
        }
        throw error;
      }
    },
  };
}

export type PaidCardRevealService = ReturnType<typeof createPaidCardRevealService>;
