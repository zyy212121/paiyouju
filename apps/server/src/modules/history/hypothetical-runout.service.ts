import {
  HypotheticalRunoutPurchaseResultSchema,
  HypotheticalRunoutResultSchema,
  type HypotheticalRunoutInput,
  type HypotheticalRunoutPurchaseResult,
  type HypotheticalRunoutResult,
  tableDiamondFees,
} from "@paiyouju/shared";
import { createShortDeck, createStandardDeck, serializeCard } from "@paiyouju/poker-core";
import { createHash, randomInt, randomUUID } from "node:crypto";

import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";

interface HypotheticalRunoutOptions {
  readonly clock?: () => Date;
  readonly randomIndex?: (exclusiveMaximum: number) => number;
}

function fingerprint(handId: string): string {
  return createHash("sha256").update(JSON.stringify({ handId })).digest("hex");
}

function resultFor(
  handId: string,
  board: readonly string[],
  runout: { readonly cards: readonly string[]; readonly createdAt: Date; readonly generationSource: "ORIGINAL_REMAINING_DECK" | "CSPRNG_LEGACY_FALLBACK" },
): HypotheticalRunoutResult {
  return HypotheticalRunoutResultSchema.parse({
    actualBoard: board,
    cards: runout.cards,
    createdAt: runout.createdAt.toISOString(),
    generationSource: runout.generationSource,
    handId,
    simulatedBoard: [...board, ...runout.cards],
  });
}

export function createHypotheticalRunoutService(
  database: DatabaseClient,
  options: HypotheticalRunoutOptions = {},
) {
  const clock = options.clock ?? (() => new Date());
  const randomIndex = options.randomIndex ?? ((exclusiveMaximum: number) => randomInt(exclusiveMaximum));

  return {
    async generate(userId: string, handId: string, input: HypotheticalRunoutInput): Promise<HypotheticalRunoutPurchaseResult> {
      const requestHash = fingerprint(handId);
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
        `;
        const replay = await transaction.requestIdempotency.findUnique({
          where: { scope_actorId_key: { actorId: userId, key: input.operationId, scope: "HYPOTHETICAL_RUNOUT" } },
        });
        if (replay) {
          if (replay.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "operationId 已用于其他模拟补牌请求");
          const parsed = HypotheticalRunoutPurchaseResultSchema.safeParse(replay.response);
          if (!parsed.success) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "模拟补牌请求正在处理");
          return parsed.data;
        }
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "HandRecord" WHERE "id" = ${handId} FOR UPDATE
        `;
        const hand = await transaction.handRecord.findUnique({ where: { id: handId } });
        if (!hand) throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
        const room = await transaction.room.findUniqueOrThrow({ select: { specialMode: true }, where: { id: hand.roomId } });
        const players = await transaction.handPlayerRecord.findMany({
          select: { gameSessionId: true, holeCards: true, userId: true },
          where: { handId },
        });
        const membership = await transaction.roomMember.findUnique({
          where: { roomId_userId: { roomId: hand.roomId, userId } },
        });
        if (!membership) {
          throw new ApiError(404, "HAND_ACCESS_DENIED", "无权查看该历史牌局");
        }
        if (hand.reviewEndsAt && clock().getTime() <= hand.reviewEndsAt.getTime()) {
          throw new ApiError(409, "HAND_REVIEW_IN_PROGRESS", "结算复盘结束后才能模拟补牌");
        }
        if (hand.runoutCount === 2) throw new ApiError(409, "HYPOTHETICAL_RUNOUT_NOT_AVAILABLE", "发两次牌局不提供发发看");
        if (hand.board.length >= 5) throw new ApiError(409, "HYPOTHETICAL_RUNOUT_NOT_AVAILABLE", "真实公共牌已经完整");
        const wallet = await transaction.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
        const existingPurchase = await transaction.hypotheticalRunoutPurchase.findFirst({
          where: { buyerUserId: userId, handId },
        });
        const persistedRunout = await transaction.handHypotheticalRunout.findUnique({ where: { handId } });
        if (existingPurchase) {
          if (!persistedRunout) throw new ApiError(500, "PERSISTENCE_ERROR", "发发看购买记录缺少公共牌结果");
          const result = HypotheticalRunoutPurchaseResultSchema.parse({
            alreadyOwned: true,
            cost: existingPurchase.cost,
            operationId: input.operationId,
            runout: resultFor(hand.id, hand.board, persistedRunout),
            walletBalance: wallet.balance,
          });
          await transaction.requestIdempotency.create({
            data: { actorId: userId, key: input.operationId, requestHash, resourceId: existingPurchase.id, response: result as unknown as Prisma.InputJsonValue, scope: "HYPOTHETICAL_RUNOUT" },
          });
          return result;
        }
        let runout = persistedRunout;
        if (!runout) {
          const dealt = new Set([...hand.board, ...players.flatMap((player) => player.holeCards)]);
          const needed = 5 - hand.board.length;
          let cards: string[];
          let generationSource: "ORIGINAL_REMAINING_DECK" | "CSPRNG_LEGACY_FALLBACK";
          if (hand.fullBoard.length === 5) {
            if (
              new Set(hand.fullBoard).size !== 5
              || hand.fullBoard.some((card) => !/^[2-9TJQKA][cdhs]$/u.test(card))
              || hand.board.some((card, index) => hand.fullBoard[index] !== card)
              || hand.fullBoard.slice(hand.board.length).some((card) => dealt.has(card))
            ) throw new ApiError(500, "PERSISTENCE_ERROR", "完整公共牌记录损坏");
            cards = hand.fullBoard.slice(hand.board.length);
            generationSource = "ORIGINAL_REMAINING_DECK";
          } else if (hand.remainingDeck.length > 0) {
            if (
              hand.remainingDeck.length < needed
              || new Set(hand.remainingDeck).size !== hand.remainingDeck.length
              || hand.remainingDeck.some((card) => dealt.has(card) || !/^[2-9TJQKA][cdhs]$/u.test(card))
            ) throw new ApiError(500, "PERSISTENCE_ERROR", "原始牌堆记录损坏");
            cards = hand.remainingDeck.slice(0, needed);
            generationSource = "ORIGINAL_REMAINING_DECK";
          } else {
            const available = (room.specialMode === "SHORT_DECK" ? createShortDeck() : createStandardDeck())
              .map(serializeCard)
              .filter((card) => !dealt.has(card));
            cards = [];
            for (let index = 0; index < needed; index += 1) {
              const selected = randomIndex(available.length);
              if (!Number.isSafeInteger(selected) || selected < 0 || selected >= available.length) {
                throw new ApiError(500, "PERSISTENCE_ERROR", "密码学随机源返回无效索引");
              }
              cards.push(available.splice(selected, 1)[0]!);
            }
            generationSource = "CSPRNG_LEGACY_FALLBACK";
          }
          runout = await transaction.handHypotheticalRunout.create({ data: { cards, generationSource, handId: hand.id } });
        }
        const cost = tableDiamondFees().hypotheticalRunout;
        const balanceAfter = wallet.balance - cost;
        if (balanceAfter < 0) throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", "钻石不足");
        const walletVersion = wallet.version + 1;
        const purchaseId = randomUUID();
        await transaction.wallet.update({ data: { balance: balanceAfter, version: walletVersion }, where: { id: wallet.id } });
        const participant = players.find((player) => player.userId === userId) ?? null;
        const walletEntry = await transaction.walletLedgerEntry.create({
          data: {
            balanceAfter,
            balanceBefore: wallet.balance,
            idempotencyKey: `hypothetical-runout:${input.operationId}`,
            metadata: { hypotheticalRunoutPurchaseId: purchaseId, runoutId: runout.id },
            relatedGameSessionId: participant?.gameSessionId ?? null,
            relatedHandId: hand.id,
            relatedRoomId: hand.roomId,
            requestFingerprint: requestHash,
            sequence: walletVersion,
            signedAmount: -cost,
            type: "HYPOTHETICAL_RUNOUT",
            userId,
            walletId: wallet.id,
          },
        });
        const purchase = await transaction.hypotheticalRunoutPurchase.create({
          data: {
            buyerUserId: userId,
            cost,
            handId: hand.id,
            id: purchaseId,
            idempotencyKey: input.operationId,
            requestFingerprint: requestHash,
            roomId: hand.roomId,
            walletLedgerEntryId: walletEntry.id,
            walletSignedAmount: -cost,
            walletType: "HYPOTHETICAL_RUNOUT",
          },
        });
        const result = HypotheticalRunoutPurchaseResultSchema.parse({
          alreadyOwned: false,
          cost,
          operationId: input.operationId,
          runout: resultFor(hand.id, hand.board, runout),
          walletBalance: balanceAfter,
        });
        await transaction.requestIdempotency.create({
          data: { actorId: userId, key: input.operationId, requestHash, resourceId: purchase.id, response: result as unknown as Prisma.InputJsonValue, scope: "HYPOTHETICAL_RUNOUT" },
        });
        return result;
      });
    },
  };
}

export type HypotheticalRunoutService = ReturnType<typeof createHypotheticalRunoutService>;
