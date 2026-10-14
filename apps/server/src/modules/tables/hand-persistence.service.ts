import { serializeCard, type HandState } from "@paiyouju/poker-core";
import { createHash } from "node:crypto";

import type { DatabaseClient } from "../../db/client.js";
import type { HandActionAutomaticReason, HandActionType, HandStreet, Prisma, TableSeatPlayStatus } from "../../generated/prisma/client.js";
import { MAX_POINTS } from "../../config/environment.js";
import { ApiError } from "../../http/api-error.js";
import { postHandReviewDurationMs } from "./runtime/review-timing.js";
import { resolveSquidHandEnd } from "./squid-mode.js";
import { resolveShortDeckStackLimit } from "./short-deck-stack-limits.js";
import { finalizeRoomGameSessions } from "./table-session-lifecycle.js";

export interface CompletedActionInput {
  readonly actionType: HandActionType;
  readonly amount: number | null;
  readonly automatic: boolean;
  readonly automaticReason?: HandActionAutomaticReason | null;
  readonly clientActionId: string | null;
  readonly createdAt: Date;
  readonly raiseTo: number | null;
  readonly seatIndex: number;
  readonly sequence: number;
  readonly stateVersion: number;
  readonly street: HandStreet;
  readonly userId: string;
}

export interface PersistCompletedHandInput {
  readonly actions: readonly CompletedActionInput[];
  readonly connectedUserIds: ReadonlySet<string>;
  readonly finishedAt: Date;
  readonly handNumber: number;
  readonly handState: HandState;
  readonly paidCardRevealCost: number;
  readonly paidCardRevealEnabled: boolean;
  readonly pendingShowCardIndicesByUser?: ReadonlyMap<string, readonly (0 | 1)[]>;
  readonly roomId: string;
  readonly runoutChoicesByUser?: Readonly<Record<string, "ONCE" | "TWICE">>;
  readonly seatSessions: ReadonlyMap<string, string>;
  readonly startedAt: Date;
}

export interface PersistedSeatResult {
  readonly gameSessionId: string;
  readonly nextActionAutoCallCurrentBet?: number | null;
  readonly nextActionAutopilotArmed?: boolean;
  readonly pendingShowCardIndices?: readonly (0 | 1)[];
  readonly playStatus: TableSeatPlayStatus;
  readonly reservedAwayEndsAt?: Date | null;
  readonly seatId: string;
  readonly seatIndex: number;
  readonly stack: number;
  readonly squidMarked?: boolean;
  readonly squidRoundParticipant?: boolean;
  readonly trusteeshipEnabled?: boolean;
  readonly userId: string;
  readonly version: number;
}

export interface PersistCompletedHandResult {
  readonly reviewEndsAt?: Date;
  readonly remainingSeats: readonly PersistedSeatResult[];
  readonly roomStatus: "OPEN" | "CLOSING" | "CLOSED";
  readonly squidRoundGraceEndsAt?: Date | null;
  readonly squidRoundNumber?: number;
  readonly squidSettlementCompleted?: boolean;
}

function settlementFingerprint(input: PersistCompletedHandInput): string {
  return createHash("sha256").update(JSON.stringify({
    actions: input.actions.map((action) => ({
      actionType: action.actionType,
      amount: action.amount,
      automatic: action.automatic,
      automaticReason: action.automaticReason ?? null,
      clientActionId: action.clientActionId,
      raiseTo: action.raiseTo,
      seatIndex: action.seatIndex,
      sequence: action.sequence,
      stateVersion: action.stateVersion,
      street: action.street,
      userId: action.userId,
    })),
    handId: input.handState.handId,
    handNumber: input.handNumber,
    paidCardRevealCost: input.paidCardRevealCost,
    paidCardRevealEnabled: input.paidCardRevealEnabled,
    pendingShowCardIndicesByUser: Object.fromEntries(input.pendingShowCardIndicesByUser ?? []),
    roomId: input.roomId,
    runoutChoicesByUser: input.runoutChoicesByUser ?? {},
    settlement: input.handState.settlement,
  })).digest("hex");
}

async function appendTableStackEntry(
  transaction: Prisma.TransactionClient,
  input: {
    readonly gameSessionId: string;
    readonly handId?: string | null;
    readonly idempotencyKey: string;
    readonly metadata: Prisma.InputJsonValue;
    readonly requestFingerprint: string;
    readonly roomId: string;
    readonly signedAmount: number;
    readonly stackAfter: number;
    readonly stackBefore: number;
    readonly type: "BUY_IN" | "CASH_OUT" | "SQUID_SETTLEMENT";
    readonly userId: string;
  },
): Promise<void> {
  if (input.stackAfter !== input.stackBefore + input.signedAmount) {
    throw new ApiError(500, "PERSISTENCE_ERROR", "牌桌流水前后值不一致");
  }
  if (input.stackBefore < 0 || input.stackAfter < 0 || input.stackAfter > MAX_POINTS) {
    throw new ApiError(500, "PERSISTENCE_ERROR", "牌桌结算超出安全点数范围");
  }
  const last = await transaction.tableStackLedgerEntry.findFirst({
    orderBy: { sequence: "desc" },
    select: { sequence: true },
    where: { gameSessionId: input.gameSessionId },
  });
  await transaction.tableStackLedgerEntry.create({
    data: {
      gameSessionId: input.gameSessionId,
      handId: input.handId ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
      requestFingerprint: input.requestFingerprint,
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

export function createHandPersistenceService(database: DatabaseClient) {
  async function persistCompletedHandInTransaction(
    transaction: Prisma.TransactionClient,
    input: PersistCompletedHandInput,
    fingerprint = settlementFingerprint(input),
  ): Promise<PersistCompletedHandResult> {
      if (input.handState.status !== "finished" || !input.handState.settlement) {
        throw new ApiError(409, "PERSISTENCE_ERROR", "只能持久化已完成的牌局");
      }
      const settlement = input.handState.settlement;
      let reviewEndsAt = new Date(input.finishedAt.getTime() + postHandReviewDurationMs(input.handState));
      const startingTotal = input.handState.players.reduce((sum, player) => sum + player.startingStack, 0);
      const endingTotal = input.handState.players.reduce((sum, player) => sum + player.stack, 0);
      if (startingTotal !== endingTotal) {
        throw new ApiError(500, "PERSISTENCE_ERROR", "桌上筹码不守恒");
      }

        await transaction.handRecord.create({
          data: {
            bigBlindAmount: input.handState.config.bigBlind,
            bigBlindSeat: input.handState.bigBlindSeat,
            bombPotBlindAmount: input.handState.bombPotBlind ?? null,
            board: input.handState.board.map(serializeCard),
            fullBoard: [
              ...input.handState.board,
              ...input.handState.deck.slice(0, 5 - input.handState.board.length),
            ].map(serializeCard),
            buttonSeat: input.handState.buttonSeat,
            finishReason: input.handState.street === "showdown" ? "SHOWDOWN" : "FOLD_TO_WIN",
            finishedAt: input.finishedAt,
            handNumber: input.handNumber,
            id: input.handState.handId,
            paidCardRevealCost: input.paidCardRevealCost,
            paidCardRevealEnabled: input.paidCardRevealEnabled,
            remainingDeck: input.handState.deck.map(serializeCard),
            reviewEndsAt,
            runoutCount: settlement.runouts?.length ?? 1,
            ...(Object.keys(input.runoutChoicesByUser ?? {}).length > 0
              ? { runoutVotes: input.runoutChoicesByUser as Prisma.InputJsonValue }
              : {}),
            roomId: input.roomId,
            smallBlindAmount: input.handState.config.smallBlind,
            smallBlindSeat: input.handState.smallBlindSeat,
            startedAt: input.startedAt,
          },
        });

        // Hand-entry and action-time purchases happen while the hand is still in
        // memory. Link the already-audited wallet rows once the durable hand exists.
        await transaction.walletLedgerEntry.updateMany({
          data: { relatedHandId: input.handState.handId },
          where: {
            metadata: { equals: input.handState.handId, path: ["handId"] },
            relatedHandId: null,
            relatedRoomId: input.roomId,
            type: { in: ["ACTION_TIME_EXTENSION", "HAND_ENTRY_FEE"] },
          },
        });

        for (const player of [...input.handState.players].sort((left, right) => left.playerId.localeCompare(right.playerId))) {
          const gameSessionId = input.seatSessions.get(player.playerId);
          if (!gameSessionId) throw new ApiError(500, "PERSISTENCE_ERROR", "缺少玩家桌上会话");
          const reachedShowdown = player.holeCardsVisibility === "showdown";
          const pendingShowCardIndices = reachedShowdown
            ? []
            : [...(input.pendingShowCardIndicesByUser?.get(player.playerId) ?? [])].sort();
          await transaction.handPlayerRecord.create({
            data: {
              allIn: player.isAllIn,
              committed: player.committedThisHand,
              endingStack: player.stack,
              folded: player.hasFolded,
              gameSessionId,
              handId: input.handState.handId,
              holeCards: player.holeCards.map(serializeCard),
              holeCardsPublic: reachedShowdown || pendingShowCardIndices.length === 2,
              holeCardsPublicReason: reachedShowdown
                ? "SHOWDOWN"
                : pendingShowCardIndices.length > 0 ? "VOLUNTARY" : null,
              voluntarilyRevealedAt: pendingShowCardIndices.length > 0 ? input.finishedAt : null,
              voluntarilyRevealedCardIndices: pendingShowCardIndices,
              netResult: player.stack - player.startingStack,
              roomId: input.roomId,
              seatIndex: player.seatIndex,
              startingStack: player.startingStack,
              userId: player.playerId,
            },
          });
        }

        for (const action of input.actions) {
          await transaction.handActionRecord.create({
            data: {
              actionType: action.actionType,
              amount: action.amount,
              automatic: action.automatic,
              automaticReason: action.automaticReason ?? null,
              clientActionId: action.clientActionId,
              createdAt: action.createdAt,
              handId: input.handState.handId,
              raiseTo: action.raiseTo,
              seatIndex: action.seatIndex,
              sequence: action.sequence,
              stateVersion: action.stateVersion,
              street: action.street,
              userId: action.userId,
            },
          });
        }

        for (const [potIndex, pot] of settlement.pots.entries()) {
          await transaction.handPotRecord.create({
            data: {
              amount: pot.amount,
              contributors: [...pot.contributors],
              eligiblePlayers: [...pot.eligiblePlayers],
              handId: input.handState.handId,
              oddChipRecipients: [...pot.oddChipRecipients],
              potIndex,
              winners: [...pot.winners],
            },
          });
        }

        for (const runout of settlement.runouts ?? []) {
          await transaction.handRunoutRecord.create({
            data: {
              board: runout.board.map(serializeCard),
              handId: input.handState.handId,
              runoutIndex: runout.runoutIndex,
              pots: {
                create: runout.pots.map((pot, potIndex) => ({
                  amount: pot.amount,
                  contributors: [...pot.contributors],
                  eligiblePlayers: [...pot.eligiblePlayers],
                  oddChipRecipients: [...pot.oddChipRecipients],
                  potIndex,
                  winners: [...pot.winners],
                })),
              },
            },
          });
        }

        for (const player of input.handState.players) {
          const gameSessionId = input.seatSessions.get(player.playerId)!;
          const locked = await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "TableSeat"
            WHERE "gameSessionId" = ${gameSessionId}
            FOR UPDATE
          `;
          if (locked.length === 0) throw new ApiError(500, "PERSISTENCE_ERROR", "玩家座位已丢失");
          const seat = await transaction.tableSeat.findUniqueOrThrow({ where: { gameSessionId } });
          if (seat.stack !== player.startingStack) {
            throw new ApiError(409, "PERSISTENCE_ERROR", "数据库桌上筹码与开局值不一致");
          }
          const lastEntry = await transaction.tableStackLedgerEntry.findFirst({
            orderBy: { sequence: "desc" },
            select: { sequence: true },
            where: { gameSessionId },
          });
          await transaction.tableSeat.update({
            data: {
              nextActionAutoCallCurrentBet: null,
              nextActionAutopilotArmed: false,
              pendingShowCardIndices: [],
              playStatus: seat.playStatus,
              reservedAwayEndsAt: player.stack > 0 && seat.playStatus === "RESERVED_AWAY" ? seat.reservedAwayEndsAt : null,
              stack: player.stack,
              version: { increment: 1 },
            },
            where: { id: seat.id },
          });
          await transaction.tableStackLedgerEntry.create({
            data: {
              gameSessionId,
              handId: input.handState.handId,
              idempotencyKey: `hand-result:${input.handState.handId}:${player.playerId}`,
              requestFingerprint: `hand-result:${input.handState.handId}:${player.playerId}:${player.startingStack}:${player.stack}`,
              metadata: { settlementFingerprint: fingerprint },
              roomId: input.roomId,
              sequence: (lastEntry?.sequence ?? 0) + 1,
              signedAmount: player.stack - player.startingStack,
              stackAfter: player.stack,
              stackBefore: player.startingStack,
              type: "HAND_RESULT",
              userId: player.playerId,
            },
          });
        }

        const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
        const handPlayerIds = new Set(input.handState.players.map((player) => player.playerId));
        const seatsAfterResult = await transaction.tableSeat.findMany({
          orderBy: { userId: "asc" },
          where: { roomId: input.roomId },
        });

        let squidRoundGraceEndsAt = room.squidRoundGraceEndsAt;
        let squidRoundNumber = room.squidRoundNumber;
        let squidSettlementCompleted = false;
        if (room.specialMode === "SHORT_DECK") {
          for (const seat of seatsAfterResult) {
            if (!handPlayerIds.has(seat.userId) || seat.playStatus === "LEAVE_AFTER_HAND") continue;
            const resolution = resolveShortDeckStackLimit(seat.stack, room.minimumBuyIn, room.maximumBuyIn);
            if (!resolution.type) continue;
            const session = await transaction.gameSession.findUniqueOrThrow({ where: { id: seat.gameSessionId } });
            if (resolution.adjustment > 0 && session.totalBuyIn + resolution.adjustment > MAX_POINTS) {
              throw new ApiError(409, "PERSISTENCE_ERROR", "短牌自动补点将超过会话安全上限");
            }
            const cashOutAmount = Math.max(0, -resolution.adjustment);
            if (cashOutAmount > 0 && session.totalCashOut + cashOutAmount > MAX_POINTS) {
              throw new ApiError(409, "PERSISTENCE_ERROR", "短牌自动退点将超过会话安全上限");
            }
            await appendTableStackEntry(transaction, {
              gameSessionId: seat.gameSessionId,
              handId: input.handState.handId,
              idempotencyKey: `short-deck-stack-limit:${input.handState.handId}:${seat.userId}`,
              metadata: {
                handId: input.handState.handId,
                maximumStack: room.maximumBuyIn,
                minimumStack: room.minimumBuyIn,
                reason: resolution.type === "BUY_IN" ? "SHORT_DECK_FLOOR_REPLENISH" : "SHORT_DECK_CAP_RETURN",
              },
              requestFingerprint: `short-deck-stack-limit:${input.handState.handId}:${seat.userId}:${String(seat.stack)}:${String(resolution.finalStack)}`,
              roomId: input.roomId,
              signedAmount: resolution.adjustment,
              stackAfter: resolution.finalStack,
              stackBefore: seat.stack,
              type: resolution.type,
              userId: seat.userId,
            });
            await transaction.tableSeat.update({
              data: { stack: resolution.finalStack, version: { increment: 1 } },
              where: { id: seat.id },
            });
            await transaction.gameSession.update({
              data: resolution.type === "BUY_IN"
                ? { totalBuyIn: { increment: resolution.adjustment } }
                : { totalCashOut: { increment: cashOutAmount } },
              where: { id: seat.gameSessionId },
            });
          }
        }
        if (room.specialMode === "SQUID") {
          if (!room.squidStake || room.squidStake <= 0) {
            throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼模式缺少有效结算额度");
          }
          const resolution = resolveSquidHandEnd({
            forcedSettlementPending: room.squidSettlementPending,
            initialBuyIn: room.initialBuyIn,
            mainPotWinnerUserIds: settlement.pots[0]?.winners ?? [],
            seats: seatsAfterResult.map((seat) => ({
              leavingAfterHand: seat.playStatus === "LEAVE_AFTER_HAND",
              marked: seat.squidMarked,
              participant: seat.squidRoundParticipant,
              seatIndex: seat.seatIndex,
              stack: seat.stack,
              userId: seat.userId,
            })),
            stakePerRecipient: room.squidStake,
          });
          const resolvedByUser = new Map(resolution.seats.map((seat) => [seat.userId, { ...seat }]));
          const autoBuyByUser = new Map<string, number>();
          if (resolution.settlement?.autoBuyInAmount) {
            autoBuyByUser.set(resolution.settlement.payerUserId, resolution.settlement.autoBuyInAmount);
          }
          for (const seat of resolution.seats) {
            const persistedSeat = seatsAfterResult.find((candidate) => candidate.userId === seat.userId);
            if (!persistedSeat) throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼自动补点座位不存在");
            if (seat.stack !== 0 || persistedSeat.playStatus === "LEAVE_AFTER_HAND") continue;
            autoBuyByUser.set(seat.userId, room.initialBuyIn);
            resolvedByUser.set(seat.userId, { ...seat, stack: room.initialBuyIn });
          }
          const totalAutoBuy = [...autoBuyByUser.values()].reduce((sum, amount) => sum + amount, 0);
          const tableTotal = seatsAfterResult.reduce((sum, seat) => sum + seat.stack, 0);
          if (!Number.isSafeInteger(totalAutoBuy) || tableTotal + totalAutoBuy > MAX_POINTS) {
            throw new ApiError(409, "PERSISTENCE_ERROR", "鱿鱼自动补点将超过整桌安全上限");
          }
          for (const [userId, amount] of autoBuyByUser) {
            const seat = seatsAfterResult.find((candidate) => candidate.userId === userId);
            if (!seat) throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼自动补点座位不存在");
            const session = await transaction.gameSession.findUniqueOrThrow({ where: { id: seat.gameSessionId } });
            if (session.totalBuyIn + amount > MAX_POINTS) {
              throw new ApiError(409, "PERSISTENCE_ERROR", "鱿鱼自动补点将超过会话安全上限");
            }
          }

          const recipients = new Set(resolution.settlement?.recipientUserIds ?? []);
          for (const seat of seatsAfterResult) {
            const resolved = resolvedByUser.get(seat.userId);
            if (!resolved) throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼座位结算结果缺失");
            let cursor = seat.stack;
            const isPayer = resolution.settlement?.payerUserId === seat.userId;
            if (isPayer && resolution.settlement) {
              const firstDebit = Math.min(cursor, resolution.settlement.totalPayment);
              if (firstDebit > 0) {
                await appendTableStackEntry(transaction, {
                  gameSessionId: seat.gameSessionId,
                  idempotencyKey: `squid-settlement:${input.handState.handId}:${seat.userId}:debit-1`,
                  metadata: { handId: input.handState.handId, roundNumber: room.squidRoundNumber, stage: "payer-debit" },
                  requestFingerprint: `squid:${input.handState.handId}:${seat.userId}:-${String(firstDebit)}:${String(cursor)}`,
                  roomId: input.roomId,
                  signedAmount: -firstDebit,
                  stackAfter: cursor - firstDebit,
                  stackBefore: cursor,
                  type: "SQUID_SETTLEMENT",
                  userId: seat.userId,
                });
                cursor -= firstDebit;
              }
              const autoBuy = autoBuyByUser.get(seat.userId) ?? 0;
              if (autoBuy > 0) {
                await appendTableStackEntry(transaction, {
                  gameSessionId: seat.gameSessionId,
                  idempotencyKey: `squid-auto-buy:${input.handState.handId}:${seat.userId}`,
                  metadata: { handId: input.handState.handId, reason: "SQUID_REPLENISH", roundNumber: room.squidRoundNumber },
                  requestFingerprint: `squid-auto-buy:${input.handState.handId}:${seat.userId}:${String(autoBuy)}`,
                  roomId: input.roomId,
                  signedAmount: autoBuy,
                  stackAfter: cursor + autoBuy,
                  stackBefore: cursor,
                  type: "BUY_IN",
                  userId: seat.userId,
                });
                await transaction.gameSession.update({ data: { totalBuyIn: { increment: autoBuy } }, where: { id: seat.gameSessionId } });
                cursor += autoBuy;
              }
              const remainingDebit = resolution.settlement.totalPayment - firstDebit;
              if (remainingDebit > 0) {
                await appendTableStackEntry(transaction, {
                  gameSessionId: seat.gameSessionId,
                  idempotencyKey: `squid-settlement:${input.handState.handId}:${seat.userId}:debit-2`,
                  metadata: { handId: input.handState.handId, roundNumber: room.squidRoundNumber, stage: "payer-debit-after-replenish" },
                  requestFingerprint: `squid:${input.handState.handId}:${seat.userId}:-${String(remainingDebit)}:${String(cursor)}`,
                  roomId: input.roomId,
                  signedAmount: -remainingDebit,
                  stackAfter: cursor - remainingDebit,
                  stackBefore: cursor,
                  type: "SQUID_SETTLEMENT",
                  userId: seat.userId,
                });
                cursor -= remainingDebit;
              }
            } else if (resolution.settlement && recipients.has(seat.userId)) {
              await appendTableStackEntry(transaction, {
                gameSessionId: seat.gameSessionId,
                idempotencyKey: `squid-settlement:${input.handState.handId}:${seat.userId}:credit`,
                metadata: { handId: input.handState.handId, payerUserId: resolution.settlement.payerUserId, roundNumber: room.squidRoundNumber, stage: "recipient-credit" },
                requestFingerprint: `squid:${input.handState.handId}:${seat.userId}:+${String(resolution.settlement.stakePerRecipient)}:${String(cursor)}`,
                roomId: input.roomId,
                signedAmount: resolution.settlement.stakePerRecipient,
                stackAfter: cursor + resolution.settlement.stakePerRecipient,
                stackBefore: cursor,
                type: "SQUID_SETTLEMENT",
                userId: seat.userId,
              });
              cursor += resolution.settlement.stakePerRecipient;
            }
            const ordinaryAutoBuy = !isPayer ? autoBuyByUser.get(seat.userId) ?? 0 : 0;
            if (ordinaryAutoBuy > 0) {
              await appendTableStackEntry(transaction, {
                gameSessionId: seat.gameSessionId,
                idempotencyKey: `squid-auto-buy:${input.handState.handId}:${seat.userId}`,
                metadata: { handId: input.handState.handId, reason: "BUSTED_REPLENISH", roundNumber: room.squidRoundNumber },
                requestFingerprint: `squid-auto-buy:${input.handState.handId}:${seat.userId}:${String(ordinaryAutoBuy)}`,
                roomId: input.roomId,
                signedAmount: ordinaryAutoBuy,
                stackAfter: cursor + ordinaryAutoBuy,
                stackBefore: cursor,
                type: "BUY_IN",
                userId: seat.userId,
              });
              await transaction.gameSession.update({ data: { totalBuyIn: { increment: ordinaryAutoBuy } }, where: { id: seat.gameSessionId } });
              cursor += ordinaryAutoBuy;
            }
            if (cursor !== resolved.stack) {
              throw new ApiError(500, "PERSISTENCE_ERROR", "鱿鱼流水与结算后手不一致");
            }
            await transaction.tableSeat.update({
              data: {
                squidMarked: resolved.marked,
                squidRoundParticipant: resolved.participant,
                stack: resolved.stack,
                version: { increment: 1 },
              },
              where: { id: seat.id },
            });
          }
          if (resolution.roundCompleted) {
            squidSettlementCompleted = true;
            squidRoundNumber = room.squidRoundNumber + 1;
            squidRoundGraceEndsAt = new Date(input.finishedAt.getTime() + 10_000);
            reviewEndsAt = squidRoundGraceEndsAt;
            await transaction.room.update({
              data: {
                squidRoundGraceEndsAt,
                squidRoundNumber,
                squidSettlementPending: false,
              },
              where: { id: room.id },
            });
            await transaction.handRecord.update({ data: { reviewEndsAt }, where: { id: input.handState.handId } });
          }
        }

        for (const seat of seatsAfterResult) {
          if (!handPlayerIds.has(seat.userId)) continue;
          if (seat.playStatus === "SIT_OUT_AFTER_HAND") {
            await transaction.tableSeat.update({
              data: { playStatus: "SIT_OUT", version: { increment: 1 } },
              where: { id: seat.id },
            });
          }
        }

        const lifecycleSeats = await transaction.tableSeat.findMany({
          orderBy: { userId: "asc" },
          where: {
            roomId: input.roomId,
            OR: [
              { stack: 0 },
              { playStatus: "LEAVE_AFTER_HAND" },
              { playStatus: "RESERVED_AWAY", reservedAwayEndsAt: { lte: input.finishedAt } },
            ],
          },
        });
        for (const seat of lifecycleSeats) {
          await transaction.gameSession.update({
            data: { detachedStack: seat.stack },
            where: { id: seat.gameSessionId },
          });
          await transaction.tableSeat.delete({ where: { id: seat.id } });
        }

        const remainingSeats = await transaction.tableSeat.findMany({
          orderBy: { seatIndex: "asc" },
          where: { roomId: input.roomId },
        });
        const roomStatus = room.status;
        // CLOSING tables remain durable until the four-second review window ends.
        // Final room-point recording and seat closure is performed by the post-review lifecycle command.
        return {
          reviewEndsAt,
          remainingSeats: remainingSeats.map((seat) => ({
            gameSessionId: seat.gameSessionId,
            nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet,
            nextActionAutopilotArmed: seat.nextActionAutopilotArmed,
            pendingShowCardIndices: seat.pendingShowCardIndices as Array<0 | 1>,
            playStatus: seat.playStatus,
            reservedAwayEndsAt: seat.reservedAwayEndsAt,
            seatId: seat.id,
            seatIndex: seat.seatIndex,
            stack: seat.stack,
            squidMarked: seat.squidMarked,
            squidRoundParticipant: seat.squidRoundParticipant,
            trusteeshipEnabled: seat.trusteeshipEnabled,
            userId: seat.userId,
            version: seat.version,
          })),
          roomStatus,
          squidRoundGraceEndsAt,
          squidRoundNumber,
          squidSettlementCompleted,
        };
  }

  return {
    async closeRoomAfterReviewInTransaction(
      transaction: Prisma.TransactionClient,
      input: { readonly closedAt: Date; readonly reviewHandId: string; readonly roomId: string },
    ): Promise<PersistCompletedHandResult> {
      const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
      if (room.status === "CLOSED") return { remainingSeats: [], roomStatus: "CLOSED" };
      if (room.status !== "CLOSING") throw new ApiError(409, "TABLE_NOT_AVAILABLE", "房间未处于关闭流程");
      await finalizeRoomGameSessions(transaction, {
        closedAt: input.closedAt,
        reason: `room-close:${input.roomId}:${input.reviewHandId}`,
        roomId: input.roomId,
      });
      await transaction.room.update({
        data: { closedAt: input.closedAt, requiresManualStart: true, status: "CLOSED", tableStartedAt: null },
        where: { id: input.roomId },
      });
      return { remainingSeats: [], roomStatus: "CLOSED" };
    },
    persistCompletedHand(input: PersistCompletedHandInput): Promise<PersistCompletedHandResult> {
      return database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${input.roomId} FOR UPDATE
        `;
        const fingerprint = settlementFingerprint(input);
        const existing = await transaction.handRecord.findUnique({ where: { id: input.handState.handId } });
        if (existing) {
          const entries = await transaction.tableStackLedgerEntry.findMany({
            orderBy: { userId: "asc" },
            where: { handId: input.handState.handId, type: "HAND_RESULT" },
          });
          const expectedPlayers = [...input.handState.players].sort((left, right) => left.playerId.localeCompare(right.playerId));
          const exact = existing.roomId === input.roomId
            && existing.handNumber === input.handNumber
            && existing.paidCardRevealCost === input.paidCardRevealCost
            && existing.paidCardRevealEnabled === input.paidCardRevealEnabled
            && entries.length === expectedPlayers.length
            && entries.every((entry, index) => entry.requestFingerprint === `hand-result:${input.handState.handId}:${expectedPlayers[index]!.playerId}:${expectedPlayers[index]!.startingStack}:${expectedPlayers[index]!.stack}`)
            && entries.every((entry) => entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata) && (entry.metadata as Record<string, unknown>).settlementFingerprint === fingerprint);
          if (!exact) throw new ApiError(409, "PERSISTENCE_ERROR", "已存在的牌局结算与当前请求冲突");
          const room = await transaction.room.findUniqueOrThrow({ where: { id: input.roomId } });
          const remainingSeats = await transaction.tableSeat.findMany({ orderBy: { seatIndex: "asc" }, where: { roomId: input.roomId } });
          return {
            reviewEndsAt: existing.reviewEndsAt ?? new Date(input.finishedAt.getTime() + postHandReviewDurationMs(input.handState)),
            remainingSeats: remainingSeats.map((seat) => ({
              gameSessionId: seat.gameSessionId,
              nextActionAutoCallCurrentBet: seat.nextActionAutoCallCurrentBet,
              nextActionAutopilotArmed: seat.nextActionAutopilotArmed,
              pendingShowCardIndices: seat.pendingShowCardIndices as Array<0 | 1>,
              playStatus: seat.playStatus,
              reservedAwayEndsAt: seat.reservedAwayEndsAt,
              seatId: seat.id,
              seatIndex: seat.seatIndex,
              stack: seat.stack,
              squidMarked: seat.squidMarked,
              squidRoundParticipant: seat.squidRoundParticipant,
              trusteeshipEnabled: seat.trusteeshipEnabled,
              userId: seat.userId,
              version: seat.version,
            })),
            roomStatus: room.status,
            squidRoundGraceEndsAt: room.squidRoundGraceEndsAt,
            squidRoundNumber: room.squidRoundNumber,
            squidSettlementCompleted: room.squidRoundGraceEndsAt?.getTime() === existing.reviewEndsAt?.getTime(),
          };
        }
        return persistCompletedHandInTransaction(transaction, input, fingerprint);
      });
    },
    persistCompletedHandInTransaction,
  };
}
