import { createHash } from "node:crypto";
import { tableDiamondFees } from "@paiyouju/shared";

import type { DatabaseClient } from "../../db/client.js";
import type { IdempotencyScope, Prisma, TableSeatPlayStatus } from "../../generated/prisma/client.js";
import { ApiError } from "../../http/api-error.js";
import { MAX_POINTS } from "../../config/environment.js";
import {
  BuyInInputSchema,
  SeatOperationInputSchema,
  TakeSeatInputSchema,
  type BuyInInput,
  type SeatOperationInput,
  type TakeSeatInput,
} from "./table.schemas.js";

export interface SeatAccountingResult {
  readonly gameSessionId: string;
  readonly playStatus: TableSeatPlayStatus;
  readonly roomId: string;
  readonly seatId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly version: number;
  readonly walletBalance: number;
}

export interface DetachedStackAccountingResult {
  readonly gameSessionId: string;
  readonly roomId: string;
  readonly seatId: null;
  readonly stack: number;
  readonly walletBalance: number;
}

export type BuyInAccountingResult = SeatAccountingResult | DetachedStackAccountingResult;

export interface LeaveAccountingResult {
  readonly cashOutAmount: number;
  readonly deferred: boolean;
  readonly gameSessionId: string;
  readonly playStatus: "LEAVE_AFTER_HAND" | null;
  readonly roomId: string;
  readonly seatId: string | null;
  readonly seatIndex: number;
  readonly stack: number;
  readonly version: number;
  readonly walletBalance: number;
}

export interface AccountingMutationHooks<TResult> {
  readonly beforeMutation?: (transaction: Prisma.TransactionClient) => Promise<void>;
  readonly afterMutation?: (result: TResult, transaction: Prisma.TransactionClient) => Promise<void>;
}

export interface LeaveAccountingContext extends AccountingMutationHooks<LeaveAccountingResult> {
  readonly confirmSquidPenalty?: boolean;
  readonly now?: Date;
  readonly participatingInHand: boolean;
}

interface CashOutMutationHooks extends AccountingMutationHooks<LeaveAccountingResult> {
  readonly confirmSquidPenalty?: boolean;
  readonly enforceSquidRules?: boolean;
  readonly now?: Date;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function activeOtherTableSeatWhere(
  roomId: string,
  userIds: readonly string[],
  now: Date,
): Prisma.TableSeatWhereInput {
  return {
    playStatus: { not: "SIT_OUT" },
    room: {
      OR: [
        { status: "CLOSING" },
        { expiresAt: { gt: now }, status: "OPEN" },
      ],
    },
    roomId: { not: roomId },
    userId: { in: [...userIds] },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "P2002";
}

async function activeRoomStackTotal(
  transaction: Prisma.TransactionClient,
  roomId: string,
): Promise<number> {
  const [seated, detached] = await Promise.all([
    transaction.tableSeat.aggregate({
      _sum: { stack: true },
      where: { roomId },
    }),
    transaction.gameSession.aggregate({
      _sum: { detachedStack: true },
      where: { detachedStack: { not: null }, roomId, status: "ACTIVE" },
    }),
  ]);
  return (seated._sum.stack ?? 0) + (detached._sum.detachedStack ?? 0);
}

async function appendSquidLeaveLedger(
  transaction: Prisma.TransactionClient,
  input: {
    readonly gameSessionId: string;
    readonly idempotencyKey: string;
    readonly metadata: Prisma.InputJsonValue;
    readonly roomId: string;
    readonly signedAmount: number;
    readonly stackAfter: number;
    readonly stackBefore: number;
    readonly type: "BUY_IN" | "SQUID_SETTLEMENT";
    readonly userId: string;
  },
): Promise<void> {
  if (input.signedAmount === 0 || input.stackAfter !== input.stackBefore + input.signedAmount || input.stackAfter < 0 || input.stackAfter > MAX_POINTS) {
    throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼离桌流水无效");
  }
  const last = await transaction.tableStackLedgerEntry.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true }, where: { gameSessionId: input.gameSessionId } });
  await transaction.tableStackLedgerEntry.create({
    data: {
      gameSessionId: input.gameSessionId,
      handId: null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      requestFingerprint: input.idempotencyKey,
      roomId: input.roomId,
      sequence: (last?.sequence ?? 0) + 1,
      signedAmount: input.signedAmount,
      stackAfter: input.stackAfter,
      stackBefore: input.stackBefore,
      type: input.type,
      userId: input.userId,
    },
  });
}

function parseStoredBuyInResult(response: Prisma.JsonValue | null): BuyInAccountingResult | null {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  const value = response as Record<string, Prisma.JsonValue>;
  if (
    typeof value.gameSessionId !== "string"
    || typeof value.roomId !== "string"
    || typeof value.stack !== "number"
    || typeof value.walletBalance !== "number"
  ) return null;
  if (value.seatId === null) {
    return { gameSessionId: value.gameSessionId, roomId: value.roomId, seatId: null, stack: value.stack, walletBalance: value.walletBalance };
  }
  if (
    typeof value.seatId !== "string"
    || typeof value.seatIndex !== "number"
    || typeof value.version !== "number"
    || !["ACTIVE", "SIT_OUT", "SIT_OUT_AFTER_HAND", "LEAVE_AFTER_HAND", "RESERVED_AWAY", "BUSTED_WAITING_REBUY"].includes(String(value.playStatus))
  ) return null;
  return {
    gameSessionId: value.gameSessionId,
    playStatus: value.playStatus as SeatAccountingResult["playStatus"],
    roomId: value.roomId,
    seatId: value.seatId,
    seatIndex: value.seatIndex,
    stack: value.stack,
    version: value.version,
    walletBalance: value.walletBalance,
  };
}

function parseStoredResult(response: Prisma.JsonValue | null): SeatAccountingResult | null {
  const result = parseStoredBuyInResult(response);
  return result?.seatId === null ? null : result;
}

function parseStoredLeaveResult(response: Prisma.JsonValue | null): LeaveAccountingResult | null {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return null;
  const value = response as Record<string, Prisma.JsonValue>;
  if (
    typeof value.cashOutAmount !== "number"
    || typeof value.deferred !== "boolean"
    || typeof value.gameSessionId !== "string"
    || (value.playStatus !== "LEAVE_AFTER_HAND" && value.playStatus !== null)
    || typeof value.roomId !== "string"
    || (typeof value.seatId !== "string" && value.seatId !== null)
    || typeof value.seatIndex !== "number"
    || typeof value.stack !== "number"
    || typeof value.version !== "number"
    || typeof value.walletBalance !== "number"
  ) return null;
  return {
    cashOutAmount: value.cashOutAmount,
    deferred: value.deferred,
    gameSessionId: value.gameSessionId,
    playStatus: value.playStatus,
    roomId: value.roomId,
    seatId: value.seatId,
    seatIndex: value.seatIndex,
    stack: value.stack,
    version: value.version,
    walletBalance: value.walletBalance,
  };
}

export function createTableAccountingService(database: DatabaseClient) {
  async function replayOrConflict<T>(
    actorId: string,
    scope: IdempotencyScope,
    operationId: string,
    requestHash: string,
    parse: (response: Prisma.JsonValue | null) => T | null,
    client: DatabaseClient | Prisma.TransactionClient = database,
  ): Promise<T | null> {
    const existing = await client.requestIdempotency.findUnique({
      where: { scope_actorId_key: { actorId, key: operationId, scope } },
    });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求");
    }
    const result = parse(existing.response);
    if (!result) {
      throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "请求正在处理");
    }
    return result;
  }

  return {
    async assertHandCanStart(roomId: string, participatingUserIds: readonly string[]): Promise<void> {
      const userIds = [...new Set(participatingUserIds)].sort();
      if (userIds.length < 2) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "开局人数不足");

      await database.$transaction(async (transaction) => {
        const now = new Date();
        const lockedRooms = await transaction.$queryRaw<Array<{ readonly id: string; readonly nextHandPaused: boolean; readonly status: string }>>`
          SELECT "id", "nextHandPaused", "status"::TEXT AS "status"
          FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
        `;
        if (lockedRooms[0]?.status !== "OPEN" || lockedRooms[0].nextHandPaused) {
          throw new ApiError(409, "TABLE_NOT_AVAILABLE", "房间当前不能开始新手牌");
        }
        for (const userId of userIds) {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
          `;
        }
        const [wallets, conflictingSeats, handSeats] = await Promise.all([
          transaction.wallet.findMany({ where: { userId: { in: userIds } } }),
          transaction.tableSeat.findMany({
            select: { id: true },
            where: activeOtherTableSeatWhere(roomId, userIds, now),
          }),
          transaction.tableSeat.findMany({ where: { roomId, userId: { in: userIds } } }),
        ]);
        if (wallets.length !== userIds.length || handSeats.length !== userIds.length) {
          throw new ApiError(409, "TABLE_NOT_AVAILABLE", "参与者账户或座位已更新");
        }
        const handEntryFee = tableDiamondFees().handEntry;
        if (wallets.some((wallet) => wallet.balance < handEntryFee)) {
          throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", `钻石不足，每手开局需要 ${handEntryFee} 钻石`);
        }
        if (conflictingSeats.length > 0) {
          throw new ApiError(409, "TABLE_NOT_AVAILABLE", "参与者正在其他牌桌活动");
        }
      });
    },

    async auditSystemPoints() {
      const [wallets, seats, detachedSessions] = await Promise.all([
        database.wallet.aggregate({ _sum: { balance: true } }),
        database.tableSeat.aggregate({ _sum: { stack: true } }),
        database.gameSession.aggregate({
          _sum: { detachedStack: true },
          where: { status: "ACTIVE", detachedStack: { not: null } },
        }),
      ]);
      return {
        activeTableStacks: (seats._sum.stack ?? 0) + (detachedSessions._sum.detachedStack ?? 0),
        wallets: wallets._sum.balance ?? 0,
      };
    },

    async buyIn(
      userId: string,
      rawInput: BuyInInput,
      context: { readonly handInProgress: boolean } & AccountingMutationHooks<SeatAccountingResult>,
    ): Promise<BuyInAccountingResult> {
      const input = BuyInInputSchema.parse(rawInput);
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_BUY_IN",
        input.operationId,
        requestHash,
        parseStoredBuyInResult,
      );
      if (replay) return replay;

      try {
        return await database.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
          `;
          const transactionalReplay = await replayOrConflict(
            userId,
            "TABLE_BUY_IN",
            input.operationId,
            requestHash,
            parseStoredBuyInResult,
            transaction,
          );
          if (transactionalReplay) return transactionalReplay;
          if (context.handInProgress) {
            throw new ApiError(409, "BUY_IN_DURING_HAND", "进行中的手牌不能追加买入");
          }
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "TableSeat"
            WHERE "roomId" = ${input.roomId} AND "userId" = ${userId}
            FOR UPDATE
          `;
          const seat = await transaction.tableSeat.findUnique({
            include: { gameSession: true, room: true },
            where: { roomId_userId: { roomId: input.roomId, userId } },
          });
          if (!seat) {
            await transaction.$queryRaw<Array<{ readonly id: string }>>`
              SELECT "id" FROM "GameSession"
              WHERE "roomId" = ${input.roomId} AND "userId" = ${userId} AND "status" = 'ACTIVE'
              FOR UPDATE
            `;
            const session = await transaction.gameSession.findFirst({
              include: { room: true },
              where: { roomId: input.roomId, status: "ACTIVE", userId },
            });
            if (!session || session.detachedStack === null) throw new ApiError(409, "PLAYER_NOT_SEATED", "首次入座前不能补充后手");
            if (session.room.status !== "OPEN") throw new ApiError(409, "ROOM_NOT_OPEN", "房间当前不可追加买入");
            if (input.amount > session.room.initialBuyIn) throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "单次补充不能超过房间初始带入");
            const tableTotal = await activeRoomStackTotal(transaction, input.roomId);
            if (tableTotal + input.amount > MAX_POINTS || session.totalBuyIn + input.amount > MAX_POINTS) {
              throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "追加后牌桌点数超过安全上限");
            }
            const wallet = await transaction.wallet.findUnique({ where: { userId } });
            if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
            const nextStack = session.detachedStack + input.amount;
            if (session.room.specialMode === "SHORT_DECK" && nextStack > session.room.maximumBuyIn) {
              throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "短牌后手不能超过房间上限");
            }
            await transaction.gameSession.update({
              data: { detachedStack: nextStack, totalBuyIn: { increment: input.amount } },
              where: { id: session.id },
            });
            const latestTableEntry = await transaction.tableStackLedgerEntry.findFirst({
              orderBy: { sequence: "desc" }, select: { sequence: true }, where: { gameSessionId: session.id },
            });
            await transaction.tableStackLedgerEntry.create({ data: {
              gameSessionId: session.id, idempotencyKey: `table-buy-in:${input.operationId}`,
              requestFingerprint: requestHash, roomId: input.roomId,
              sequence: (latestTableEntry?.sequence ?? 0) + 1, signedAmount: input.amount,
              stackAfter: nextStack, stackBefore: session.detachedStack, type: "BUY_IN", userId,
            } });
            const result: DetachedStackAccountingResult = {
              gameSessionId: session.id, roomId: input.roomId, seatId: null,
              stack: nextStack, walletBalance: wallet.balance,
            };
            await transaction.requestIdempotency.create({ data: {
              actorId: userId, key: input.operationId, requestHash, resourceId: session.id,
              response: result as unknown as Prisma.InputJsonValue, scope: "TABLE_BUY_IN",
            } });
            return result;
          }
          await context.beforeMutation?.(transaction);
          if (seat.room.status !== "OPEN") {
            throw new ApiError(409, "ROOM_NOT_OPEN", "房间当前不可追加买入");
          }
          if (input.amount > seat.room.initialBuyIn) throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "单次补充不能超过房间初始带入");
          const tableTotal = await activeRoomStackTotal(transaction, input.roomId);
          if (tableTotal + input.amount > MAX_POINTS) {
            throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "追加后整桌筹码超过安全上限");
          }
          if (seat.gameSession.totalBuyIn + input.amount > MAX_POINTS) {
            throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "本次桌上会话累计买入超过安全上限");
          }

          const wallet = await transaction.wallet.findUnique({ where: { userId } });
          if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
          const walletBalance = wallet.balance;
          const nextStack = seat.stack + input.amount;
          if (seat.room.specialMode === "SHORT_DECK" && nextStack > seat.room.maximumBuyIn) {
            throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "短牌后手不能超过房间上限");
          }
          const nextSeatVersion = seat.version + 1;
          const updatedSeat = await transaction.tableSeat.update({
            data: {
              ...(seat.playStatus === "BUSTED_WAITING_REBUY" ? { playStatus: "ACTIVE" } : {}),
              stack: nextStack,
              version: nextSeatVersion,
            },
            where: { id: seat.id },
          });
          await transaction.gameSession.update({
            data: { totalBuyIn: { increment: input.amount } },
            where: { id: seat.gameSessionId },
          });
          const latestTableEntry = await transaction.tableStackLedgerEntry.findFirst({
            orderBy: { sequence: "desc" },
            select: { sequence: true },
            where: { gameSessionId: seat.gameSessionId },
          });
          await transaction.tableStackLedgerEntry.create({
            data: {
              gameSessionId: seat.gameSessionId,
              idempotencyKey: `table-buy-in:${input.operationId}`,
              requestFingerprint: requestHash,
              roomId: seat.roomId,
              sequence: (latestTableEntry?.sequence ?? 0) + 1,
              signedAmount: input.amount,
              stackAfter: nextStack,
              stackBefore: seat.stack,
              type: "BUY_IN",
              userId,
            },
          });
          const result: SeatAccountingResult = {
            gameSessionId: seat.gameSessionId,
            playStatus: updatedSeat.playStatus,
            roomId: seat.roomId,
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            stack: nextStack,
            version: nextSeatVersion,
            walletBalance,
          };
          await transaction.requestIdempotency.create({
            data: {
              actorId: userId,
              key: input.operationId,
              requestHash,
              resourceId: seat.id,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "TABLE_BUY_IN",
            },
          });
          await context.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(
            userId,
            "TABLE_BUY_IN",
            input.operationId,
            requestHash,
            parseStoredBuyInResult,
          );
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },

    async cashOut(
      userId: string,
      rawInput: SeatOperationInput,
      hooks: CashOutMutationHooks = {},
    ): Promise<LeaveAccountingResult> {
      const input = SeatOperationInputSchema.parse(rawInput);
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_LEAVE",
        input.operationId,
        requestHash,
        parseStoredLeaveResult,
      );
      if (replay) return replay;

      try {
        return await database.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
          `;
          const transactionalReplay = await replayOrConflict(
            userId,
            "TABLE_LEAVE",
            input.operationId,
            requestHash,
            parseStoredLeaveResult,
            transaction,
          );
          if (transactionalReplay) return transactionalReplay;
          await hooks.beforeMutation?.(transaction);
          const locked = await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "TableSeat"
            WHERE "roomId" = ${input.roomId} AND "userId" = ${userId}
            FOR UPDATE
          `;
          if (locked.length === 0) {
            throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未在该房间入座");
          }
          const seat = await transaction.tableSeat.findUnique({
            where: { roomId_userId: { roomId: input.roomId, userId } },
          });
          if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未在该房间入座");
          let detachedStack = seat.stack;
          if (hooks.enforceSquidRules) {
            const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
            const now = hooks.now ?? new Date();
            const graceActive = room.squidRoundGraceEndsAt !== null && now.getTime() < room.squidRoundGraceEndsAt.getTime();
            const penaltyApplies = room.specialMode === "SQUID"
              && room.tableStartedAt !== null
              && !graceActive
              && seat.squidRoundParticipant;
            if (penaltyApplies && !hooks.confirmSquidPenalty) {
              throw new ApiError(409, "SQUID_LEAVE_CONFIRMATION_REQUIRED", "离开鱿鱼牌局需要确认");
            }
            if (penaltyApplies) {
              const roundSeats = await transaction.tableSeat.findMany({ orderBy: { seatIndex: "asc" }, where: { roomId: room.id } });
              const remainingParticipants = roundSeats.filter((candidate) => candidate.userId !== userId && candidate.squidRoundParticipant);
              const remainingUnmarked = remainingParticipants.filter((candidate) => !candidate.squidMarked);
              const payer = !seat.squidMarked
                ? seat
                : remainingParticipants.length >= 2 && remainingUnmarked.length === 1
                  ? remainingUnmarked[0]!
                  : null;
              const recipients = payer ? remainingParticipants.filter((candidate) => candidate.userId !== payer.userId) : [];
              if (payer && recipients.length > 0) {
                if (!room.squidStake) throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼模式缺少有效结算额度");
                const settlementReason = seat.squidMarked ? "MARKED_LEAVE_ROUND_COMPLETION" : "UNMARKED_LEAVE";
                const totalPayment = room.squidStake * recipients.length;
                if (!Number.isSafeInteger(totalPayment) || totalPayment > MAX_POINTS) throw new ApiError(409, "PERSISTENCE_ERROR", "鱿鱼离桌结算超过安全上限");
                for (const recipient of recipients) {
                  if (recipient.stack + room.squidStake > MAX_POINTS) throw new ApiError(409, "PERSISTENCE_ERROR", "鱿鱼离桌结算超过玩家安全上限");
                }
                const afterPayment = payer.stack - totalPayment;
                const autoBuy = afterPayment <= 0 ? room.initialBuyIn - afterPayment : 0;
                const activeTotal = await activeRoomStackTotal(transaction, room.id);
                const session = await transaction.gameSession.findUniqueOrThrow({ where: { id: payer.gameSessionId } });
                if (activeTotal + autoBuy > MAX_POINTS || session.totalBuyIn + autoBuy > MAX_POINTS) {
                  throw new ApiError(409, "PERSISTENCE_ERROR", "鱿鱼离桌自动补点超过安全上限");
                }
                let cursor = payer.stack;
                const firstDebit = Math.min(cursor, totalPayment);
                if (firstDebit > 0) {
                  await appendSquidLeaveLedger(transaction, {
                    gameSessionId: payer.gameSessionId,
                    idempotencyKey: `squid-leave:${input.operationId}:${payer.userId}:debit-1`,
                    metadata: { reason: settlementReason, roundNumber: room.squidRoundNumber },
                    roomId: room.id,
                    signedAmount: -firstDebit,
                    stackAfter: cursor - firstDebit,
                    stackBefore: cursor,
                    type: "SQUID_SETTLEMENT",
                    userId: payer.userId,
                  });
                  cursor -= firstDebit;
                }
                if (autoBuy > 0) {
                  await appendSquidLeaveLedger(transaction, {
                    gameSessionId: payer.gameSessionId,
                    idempotencyKey: `squid-leave:${input.operationId}:${payer.userId}:auto-buy`,
                    metadata: { reason: "SQUID_REPLENISH", roundNumber: room.squidRoundNumber },
                    roomId: room.id,
                    signedAmount: autoBuy,
                    stackAfter: cursor + autoBuy,
                    stackBefore: cursor,
                    type: "BUY_IN",
                    userId: payer.userId,
                  });
                  await transaction.gameSession.update({ data: { totalBuyIn: { increment: autoBuy } }, where: { id: payer.gameSessionId } });
                  cursor += autoBuy;
                }
                const remainingDebit = totalPayment - firstDebit;
                if (remainingDebit > 0) {
                  await appendSquidLeaveLedger(transaction, {
                    gameSessionId: payer.gameSessionId,
                    idempotencyKey: `squid-leave:${input.operationId}:${payer.userId}:debit-2`,
                    metadata: { reason: `${settlementReason}_AFTER_REPLENISH`, roundNumber: room.squidRoundNumber },
                    roomId: room.id,
                    signedAmount: -remainingDebit,
                    stackAfter: cursor - remainingDebit,
                    stackBefore: cursor,
                    type: "SQUID_SETTLEMENT",
                    userId: payer.userId,
                  });
                  cursor -= remainingDebit;
                }
                if (payer.userId === userId) detachedStack = cursor;
                for (const other of roundSeats.filter((candidate) => candidate.userId !== userId)) {
                  const recipientCredit = recipients.some((recipient) => recipient.userId === other.userId) ? room.squidStake : 0;
                  if (recipientCredit > 0) {
                    await appendSquidLeaveLedger(transaction, {
                      gameSessionId: other.gameSessionId,
                      idempotencyKey: `squid-leave:${input.operationId}:${other.userId}:credit`,
                      metadata: { payerUserId: payer.userId, reason: settlementReason, roundNumber: room.squidRoundNumber },
                      roomId: room.id,
                      signedAmount: recipientCredit,
                      stackAfter: other.stack + recipientCredit,
                      stackBefore: other.stack,
                      type: "SQUID_SETTLEMENT",
                      userId: other.userId,
                    });
                  }
                  const stackAfterSettlement = other.userId === payer.userId ? cursor : other.stack + recipientCredit;
                  await transaction.tableSeat.update({
                    data: {
                      squidMarked: false,
                      squidRoundParticipant: true,
                      stack: stackAfterSettlement,
                      version: { increment: 1 },
                    },
                    where: { id: other.id },
                  });
                }
                await transaction.room.update({
                  data: {
                    squidRoundGraceEndsAt: new Date(now.getTime() + 10_000),
                    squidRoundNumber: { increment: 1 },
                    squidSettlementPending: false,
                  },
                  where: { id: room.id },
                });
              }
            }
          }
          const wallet = await transaction.wallet.findUnique({ where: { userId } });
          if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
          const walletBalance = wallet.balance;

          await transaction.gameSession.update({
            data: { detachedStack },
            where: { id: seat.gameSessionId },
          });
          await transaction.tableSeat.delete({ where: { id: seat.id } });
          const result: LeaveAccountingResult = {
            cashOutAmount: 0,
            deferred: false,
            gameSessionId: seat.gameSessionId,
            playStatus: null,
            roomId: seat.roomId,
            seatId: null,
            seatIndex: seat.seatIndex,
            stack: detachedStack,
            version: seat.version + 1,
            walletBalance,
          };
          await transaction.requestIdempotency.create({
            data: {
              actorId: userId,
              key: input.operationId,
              requestHash,
              resourceId: seat.gameSessionId,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "TABLE_LEAVE",
            },
          });
          await hooks.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(
            userId,
            "TABLE_LEAVE",
            input.operationId,
            requestHash,
            parseStoredLeaveResult,
          );
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },

    async requestLeave(
      userId: string,
      rawInput: SeatOperationInput,
      context: LeaveAccountingContext,
    ): Promise<LeaveAccountingResult> {
      const input = SeatOperationInputSchema.parse(rawInput);
      if (!context.participatingInHand) return this.cashOut(userId, input, { ...context, enforceSquidRules: true });
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_LEAVE",
        input.operationId,
        requestHash,
        parseStoredLeaveResult,
      );
      if (replay) return replay;
      try {
        return await database.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
          `;
          const transactionalReplay = await replayOrConflict(
            userId,
            "TABLE_LEAVE",
            input.operationId,
            requestHash,
            parseStoredLeaveResult,
            transaction,
          );
          if (transactionalReplay) return transactionalReplay;
          await context.beforeMutation?.(transaction);
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "TableSeat"
            WHERE "roomId" = ${input.roomId} AND "userId" = ${userId}
            FOR UPDATE
          `;
          const seat = await transaction.tableSeat.findUnique({
            where: { roomId_userId: { roomId: input.roomId, userId } },
          });
          if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未在该房间入座");
          const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
          const now = context.now ?? new Date();
          const graceActive = room.squidRoundGraceEndsAt !== null && now.getTime() < room.squidRoundGraceEndsAt.getTime();
          const squidPenaltyApplies = room.specialMode === "SQUID"
            && room.tableStartedAt !== null
            && !graceActive
            && seat.squidRoundParticipant;
          if (squidPenaltyApplies && !context.confirmSquidPenalty) {
            throw new ApiError(409, "SQUID_LEAVE_CONFIRMATION_REQUIRED", "离开鱿鱼牌局需要确认");
          }
          if (squidPenaltyApplies && !seat.squidMarked) {
            await transaction.tableSeat.updateMany({
              data: { squidMarked: true, version: { increment: 1 } },
              where: {
                roomId: room.id,
                squidMarked: false,
                squidRoundParticipant: true,
                userId: { not: userId },
              },
            });
            await transaction.room.update({ data: { squidSettlementPending: true }, where: { id: room.id } });
          }
          const updated = await transaction.tableSeat.update({
            data: {
              nextActionAutoCallCurrentBet: null,
              nextActionAutopilotArmed: true,
              playStatus: "LEAVE_AFTER_HAND",
              reservedAwayEndsAt: null,
              ...(squidPenaltyApplies && seat.squidMarked ? { squidMarked: false, squidRoundParticipant: false } : {}),
              version: { increment: 1 },
            },
            where: { id: seat.id },
          });
          const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId } });
          const result: LeaveAccountingResult = {
            cashOutAmount: 0,
            deferred: true,
            gameSessionId: seat.gameSessionId,
            playStatus: "LEAVE_AFTER_HAND",
            roomId: seat.roomId,
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            stack: seat.stack,
            version: updated.version,
            walletBalance: wallet.balance,
          };
          await transaction.requestIdempotency.create({
            data: {
              actorId: userId,
              key: input.operationId,
              requestHash,
              resourceId: seat.id,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "TABLE_LEAVE",
            },
          });
          await context.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(userId, "TABLE_LEAVE", input.operationId, requestHash, parseStoredLeaveResult);
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },

    async returnToPlay(
      userId: string,
      rawInput: SeatOperationInput,
      context: { readonly handInProgress: boolean; readonly now?: Date } & AccountingMutationHooks<SeatAccountingResult>,
    ): Promise<SeatAccountingResult> {
      const input = SeatOperationInputSchema.parse(rawInput);
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_RETURN",
        input.operationId,
        requestHash,
        parseStoredResult,
      );
      if (replay) return replay;
      try {
        return await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
        `;
        const transactionalReplay = await replayOrConflict(
          userId,
          "TABLE_RETURN",
          input.operationId,
          requestHash,
          parseStoredResult,
          transaction,
        );
        if (transactionalReplay) return transactionalReplay;
        await context.beforeMutation?.(transaction);
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "TableSeat"
          WHERE "roomId" = ${input.roomId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        const seat = await transaction.tableSeat.findUnique({
          include: { room: true },
          where: { roomId_userId: { roomId: input.roomId, userId } },
        });
        if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未在该房间入座");
        if (seat.room.status !== "OPEN") throw new ApiError(409, "ROOM_NOT_OPEN", "房间当前不可恢复参与");
        const returningReserved = seat.playStatus === "RESERVED_AWAY";
        if (returningReserved && (!seat.reservedAwayEndsAt || seat.reservedAwayEndsAt.getTime() < (context.now ?? new Date()).getTime())) {
          throw new ApiError(409, "RESERVED_AWAY_NOT_AVAILABLE", "保留座位时间已结束");
        }
        if (context.handInProgress && !returningReserved) {
          throw new ApiError(409, "PLAYER_NOT_ACTIVE", "只能在两手牌之间恢复参与");
        }
        if (seat.stack <= 0 || (!returningReserved && seat.playStatus !== "SIT_OUT")) {
          throw new ApiError(409, "PLAYER_NOT_ACTIVE", "当前状态不能恢复参与");
        }
        const updated = await transaction.tableSeat.update({
          data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, playStatus: "ACTIVE", reservedAwayEndsAt: null, version: { increment: 1 } },
          where: { id: seat.id },
        });
        const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId } });
        const result: SeatAccountingResult = {
          gameSessionId: seat.gameSessionId,
          playStatus: updated.playStatus,
          roomId: seat.roomId,
          seatId: seat.id,
          seatIndex: seat.seatIndex,
          stack: seat.stack,
          version: updated.version,
          walletBalance: wallet.balance,
        };
        await transaction.requestIdempotency.create({
          data: { actorId: userId, key: input.operationId, requestHash, resourceId: seat.id, response: result as unknown as Prisma.InputJsonValue, scope: "TABLE_RETURN" },
        });
        await context.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(userId, "TABLE_RETURN", input.operationId, requestHash, parseStoredResult);
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },

    async setSitOut(
      userId: string,
      rawInput: SeatOperationInput,
      context: { readonly participatingInHand: boolean } & AccountingMutationHooks<SeatAccountingResult>,
    ): Promise<SeatAccountingResult> {
      const input = SeatOperationInputSchema.parse(rawInput);
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_SIT_OUT",
        input.operationId,
        requestHash,
        parseStoredResult,
      );
      if (replay) return replay;
      try {
        return await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
        `;
        const transactionalReplay = await replayOrConflict(
          userId,
          "TABLE_SIT_OUT",
          input.operationId,
          requestHash,
          parseStoredResult,
          transaction,
        );
        if (transactionalReplay) return transactionalReplay;
        await context.beforeMutation?.(transaction);
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "TableSeat"
          WHERE "roomId" = ${input.roomId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        const seat = await transaction.tableSeat.findUnique({
          where: { roomId_userId: { roomId: input.roomId, userId } },
        });
        if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未在该房间入座");
        const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
        if (room.specialMode === "SQUID") {
          throw new ApiError(409, "SQUID_RESERVED_AWAY_DISABLED", "鱿鱼模式不能暂停发牌");
        }
        if (seat.playStatus === "LEAVE_AFTER_HAND") {
          throw new ApiError(409, "PLAYER_NOT_ACTIVE", "已申请本手后离桌");
        }
        const playStatus = context.participatingInHand ? "SIT_OUT_AFTER_HAND" : "SIT_OUT";
        const updated = await transaction.tableSeat.update({
          data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, playStatus, reservedAwayEndsAt: null, version: { increment: 1 } },
          where: { id: seat.id },
        });
        const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId } });
        const result: SeatAccountingResult = {
          gameSessionId: seat.gameSessionId,
          playStatus: updated.playStatus,
          roomId: seat.roomId,
          seatId: seat.id,
          seatIndex: seat.seatIndex,
          stack: seat.stack,
          version: updated.version,
          walletBalance: wallet.balance,
        };
        await transaction.requestIdempotency.create({
          data: { actorId: userId, key: input.operationId, requestHash, resourceId: seat.id, response: result as unknown as Prisma.InputJsonValue, scope: "TABLE_SIT_OUT" },
        });
        await context.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(userId, "TABLE_SIT_OUT", input.operationId, requestHash, parseStoredResult);
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },

    async takeSeat(
      userId: string,
      rawInput: TakeSeatInput,
      hooks: AccountingMutationHooks<SeatAccountingResult> = {},
    ): Promise<SeatAccountingResult> {
      const input = TakeSeatInputSchema.parse(rawInput);
      const requestHash = fingerprint(input);
      const replay = await replayOrConflict(
        userId,
        "TABLE_SEAT_TAKE",
        input.operationId,
        requestHash,
        parseStoredResult,
      );
      if (replay) return replay;

      try {
        return await database.$transaction(async (transaction) => {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
          `;
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
          `;
          const transactionalReplay = await replayOrConflict(
            userId,
            "TABLE_SEAT_TAKE",
            input.operationId,
            requestHash,
            parseStoredResult,
            transaction,
          );
          if (transactionalReplay) return transactionalReplay;
          await hooks.beforeMutation?.(transaction);
          const room = await transaction.room.findUnique({
            include: {
              members: { select: { userId: true } },
              tableSeats: { select: { seatIndex: true, userId: true } },
            },
            where: { id: input.roomId },
          });
          if (!room || !room.members.some((member) => member.userId === userId)) {
            throw new ApiError(403, "ROOM_ACCESS_DENIED", "无权访问该房间");
          }
          const now = new Date();
          if (room.status !== "OPEN") {
            throw new ApiError(409, "ROOM_NOT_OPEN", "房间当前不可入座");
          }
          if (input.seatIndex >= room.maxSeats) {
            throw new ApiError(400, "SEAT_OUT_OF_RANGE", "座位编号超出房间范围");
          }
          if (room.tableSeats.some((seat) => seat.seatIndex === input.seatIndex)) {
            throw new ApiError(409, "SEAT_OCCUPIED", "座位已被占用");
          }
          if (room.tableSeats.some((seat) => seat.userId === userId)) {
            throw new ApiError(409, "USER_ALREADY_SEATED", "你已在该房间入座");
          }
          const conflictingSeat = await transaction.tableSeat.findFirst({
            select: { id: true },
            where: activeOtherTableSeatWhere(room.id, [userId], now),
          });
          if (conflictingSeat) {
            throw new ApiError(409, "TABLE_NOT_AVAILABLE", "你正在其他牌桌活动");
          }
          const existingSession = await transaction.gameSession.findFirst({
            include: { tableSeat: { select: { id: true } } },
            where: { roomId: room.id, status: "ACTIVE", userId },
          });
          if (existingSession?.tableSeat) {
            throw new ApiError(409, "USER_ALREADY_SEATED", "你已在该房间入座");
          }
          const seatStack = existingSession ? existingSession.detachedStack : room.initialBuyIn;
          if (seatStack === null) {
            throw new ApiError(500, "PERSISTENCE_ERROR", "活动牌桌会话缺少保留后手");
          }
          const tableTotal = await activeRoomStackTotal(transaction, input.roomId);
          if (tableTotal + (existingSession ? 0 : seatStack) > MAX_POINTS) {
            throw new ApiError(400, "BUY_IN_OUT_OF_RANGE", "入座后整桌点数超过安全上限");
          }

          const wallet = await transaction.wallet.findUnique({ where: { userId } });
          if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
          const walletBalance = wallet.balance;

          const gameSession = existingSession
            ? await transaction.gameSession.update({
                data: { detachedStack: null, seatIndex: input.seatIndex },
                where: { id: existingSession.id },
              })
            : await transaction.gameSession.create({
                data: {
                  roomId: room.id,
                  seatIndex: input.seatIndex,
                  totalBuyIn: room.initialBuyIn,
                  userId,
                },
              });
          const seat = await transaction.tableSeat.create({
            data: {
              gameSessionId: gameSession.id,
              playStatus: seatStack === 0 ? "BUSTED_WAITING_REBUY" : "ACTIVE",
              roomId: room.id,
              seatIndex: input.seatIndex,
              squidMarked: false,
              squidRoundParticipant: room.specialMode === "SQUID" && !room.squidSettlementPending,
              stack: seatStack,
              trusteeshipEnabled: false,
              userId,
              version: 1,
            },
          });
          if (!existingSession) {
            await transaction.tableStackLedgerEntry.create({
              data: {
                gameSessionId: gameSession.id,
                idempotencyKey: `table-buy-in:${input.operationId}`,
                requestFingerprint: requestHash,
                roomId: room.id,
                sequence: 1,
                signedAmount: seatStack,
                stackAfter: seatStack,
                stackBefore: 0,
                type: "BUY_IN",
                userId,
              },
            });
          }
          const result: SeatAccountingResult = {
            gameSessionId: gameSession.id,
            playStatus: seat.playStatus,
            roomId: room.id,
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            stack: seat.stack,
            version: seat.version,
            walletBalance,
          };
          await transaction.requestIdempotency.create({
            data: {
              actorId: userId,
              key: input.operationId,
              requestHash,
              resourceId: seat.id,
              response: result as unknown as Prisma.InputJsonValue,
              scope: "TABLE_SEAT_TAKE",
            },
          });
          await hooks.afterMutation?.(result, transaction);
          return result;
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) {
          const duplicateReplay = await replayOrConflict(
            userId,
            "TABLE_SEAT_TAKE",
            input.operationId,
            requestHash,
            parseStoredResult,
          );
          if (duplicateReplay) return duplicateReplay;
        }
        throw error;
      }
    },
  };
}
