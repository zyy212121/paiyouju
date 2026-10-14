import { createHash } from "node:crypto";

import { MAX_POINTS } from "../../config/environment.js";
import type { DatabaseClient } from "../../db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { WalletMutationInputSchema, type LedgerQuery, type WalletMutationInput } from "./wallet.schemas.js";

interface WalletServiceOptions {
  readonly maxCasAttempts?: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function fingerprint(input: WalletMutationInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
}

export async function applyWalletMutationInTransaction(
  transaction: Prisma.TransactionClient,
  rawInput: WalletMutationInput,
  requestFingerprint = fingerprint(WalletMutationInputSchema.parse(rawInput)),
) {
  const input = WalletMutationInputSchema.parse(rawInput);
  await transaction.$queryRaw<Array<{ readonly id: string }>>`
    SELECT "id" FROM "Wallet" WHERE "userId" = ${input.userId} FOR UPDATE
  `;
  const wallet = await transaction.wallet.findUnique({ where: { userId: input.userId } });
  if (!wallet) {
    throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
  }
  const balanceAfter = wallet.balance + input.signedAmount;
  if (balanceAfter < 0) {
    throw new ApiError(409, "WALLET_INSUFFICIENT_BALANCE", "钻石不足");
  }
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter > MAX_POINTS) {
    throw new ApiError(409, "WALLET_MAX_BALANCE_EXCEEDED", "钻石超过安全上限");
  }
  const nextSequence = wallet.version + 1;
  const updated = await transaction.wallet.updateMany({
    data: { balance: balanceAfter, version: nextSequence },
    where: { id: wallet.id, version: wallet.version },
  });
  if (updated.count !== 1) {
    return null;
  }

  return transaction.walletLedgerEntry.create({
    data: {
      balanceAfter,
      balanceBefore: wallet.balance,
      idempotencyKey: input.idempotencyKey,
      ...(input.metadata === undefined
        ? {}
        : { metadata: input.metadata as Prisma.InputJsonValue }),
      ...(input.relatedGameSessionId === undefined
        ? {}
        : { relatedGameSessionId: input.relatedGameSessionId }),
      ...(input.relatedHandId === undefined
        ? {}
        : { relatedHandId: input.relatedHandId }),
      ...(input.relatedRoomId === undefined
        ? {}
        : { relatedRoomId: input.relatedRoomId }),
      requestFingerprint,
      sequence: nextSequence,
      signedAmount: input.signedAmount,
      type: input.type,
      userId: input.userId,
      walletId: wallet.id,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export function createWalletService(
  database: DatabaseClient,
  options: WalletServiceOptions = {},
) {
  const maxCasAttempts = options.maxCasAttempts ?? 8;

  async function replayOrConflict(input: WalletMutationInput, requestFingerprint: string) {
    const existing = await database.walletLedgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (!existing) {
      return null;
    }
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
    }
    return existing;
  }

  function isRetryableTransactionError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
      return false;
    }
    const code = "code" in error ? (error as { code?: unknown }).code : undefined;
    const message =
      "message" in error ? String((error as { message?: unknown }).message) : "";
    return (
      code === "P2034" ||
      message.includes("deadlock detected") ||
      message.includes("could not serialize access")
    );
  }

  return {
    async applyWalletMutation(rawInput: WalletMutationInput) {
      const input = WalletMutationInputSchema.parse(rawInput);
      const requestFingerprint = fingerprint(input);
      const replay = await replayOrConflict(input, requestFingerprint);
      if (replay) {
        return replay;
      }

      for (let attempt = 0; attempt < maxCasAttempts; attempt += 1) {
        try {
          const result = await database.$transaction((transaction) =>
            applyWalletMutationInTransaction(transaction, input, requestFingerprint),
          );
          if (result) {
            return result;
          }
        } catch (error: unknown) {
          if (isUniqueViolation(error)) {
            const existing = await replayOrConflict(input, requestFingerprint);
            if (existing) {
              return existing;
            }
            continue;
          }
          if (isRetryableTransactionError(error)) {
            continue;
          }
          throw error;
        }
      }
      throw new ApiError(409, "WALLET_CONCURRENT_UPDATE", "钻石账户正在更新，请重试");
    },

    async getWallet(userId: string) {
      const wallet = await database.wallet.findUnique({
        select: { balance: true, updatedAt: true, version: true },
        where: { userId },
      });
      if (!wallet) {
        throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
      }
      return wallet;
    },

    async listLedger(userId: string, query: LedgerQuery) {
      const entries = await database.walletLedgerEntry.findMany({
        orderBy: { sequence: "desc" },
        take: query.limit + 1,
        where: {
          userId,
          ...(query.cursor === undefined ? {} : { sequence: { lt: query.cursor } }),
        },
      });
      const hasMore = entries.length > query.limit;
      const page = entries.slice(0, query.limit);
      return {
        entries: page.map((entry) => ({
          balanceAfter: entry.balanceAfter,
          balanceBefore: entry.balanceBefore,
          createdAt: entry.createdAt,
          id: entry.id,
          relatedGameSessionId: entry.relatedGameSessionId,
          relatedHandId: entry.relatedHandId,
          relatedRoomId: entry.relatedRoomId,
          sequence: entry.sequence,
          signedAmount: entry.signedAmount,
          type: entry.type,
        })),
        nextCursor: hasMore ? page.at(-1)?.sequence : undefined,
      };
    },
  };
}
