import { createHash } from "node:crypto";

import { tableDiamondFees, type ActionTimeExtensionResult, type BuyTimeExtensionCommand, type LifecycleCommandResult, type NextActionAutopilotCommand, type SeatAccountingResult, type TrusteeshipSetCommand } from "@paiyouju/shared";

import type { DatabaseClient } from "../../../db/client.js";
import type { IdempotencyScope, Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../../http/api-error.js";
import { advanceRuntimeAuthority, type RuntimeAuthorityState } from "../runtime/runtime-authority-state.js";
import { RESERVED_AWAY_DURATION_MS } from "../runtime/constants.js";
import { createSnapshotRepository } from "../snapshot/snapshot-repository.js";
import { resolveBombPotHandStart } from "../bomb-pot.js";

interface OperationEnvelope {
  readonly expectedStateVersion: number;
  readonly operationId: string;
  readonly roomId: string;
}

interface LifecycleCommit<T> {
  readonly alreadyProcessed: boolean;
  readonly data: T;
  readonly state: RuntimeAuthorityState | null;
  readonly stateVersion: number;
}

interface Mutation<T> {
  readonly data: T;
  readonly resourceId?: string;
  readonly update: Partial<Omit<RuntimeAuthorityState, "snapshotRevision" | "stateVersion">>;
}

function fingerprint(scope: IdempotencyScope, actorId: string, input: OperationEnvelope): string {
  return createHash("sha256").update(JSON.stringify({ actorId, input, scope })).digest("hex");
}

function storedStateVersion(value: Prisma.JsonValue | null): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stateVersion = (value as Prisma.JsonObject).stateVersion;
  return typeof stateVersion === "number" && Number.isSafeInteger(stateVersion) ? stateVersion : null;
}

function storedResponse<T extends object>(value: Prisma.JsonValue | null): T | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : null;
}

function assertMutable(state: RuntimeAuthorityState, input: OperationEnvelope): void {
  if (input.roomId !== state.room.roomId) throw new ApiError(403, "ROOM_ACCESS_DENIED", "无权操作该牌桌");
  if (state.status === "PERSISTENCE_ERROR") throw new ApiError(409, "PERSISTENCE_ERROR", "牌桌结算异常，已冻结状态变更");
  if (state.status === "RECOVERY_ERROR") throw new ApiError(409, "RECOVERY_ERROR", "牌桌恢复失败，已暂停操作");
  if (input.expectedStateVersion !== state.stateVersion) throw new ApiError(409, "STALE_STATE", "牌桌状态已更新");
}

export function createTableLifecycleCommandService(database: DatabaseClient) {
  const snapshots = createSnapshotRepository(database);

  async function commit<T extends object>(
    state: RuntimeAuthorityState,
    actorId: string,
    scope: IdempotencyScope,
    input: OperationEnvelope,
    mutate: (transaction: Prisma.TransactionClient) => Promise<Mutation<T>>,
  ): Promise<LifecycleCommit<T>> {
    const requestHash = fingerprint(scope, actorId, input);
    const replay = await database.requestIdempotency.findUnique({
      where: { scope_actorId_key: { actorId, key: input.operationId, scope } },
    });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求");
      const stateVersion = storedStateVersion(replay.response);
      const data = storedResponse<T>(replay.response);
      if (stateVersion === null || !data) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "操作正在处理中");
      return { alreadyProcessed: true, data, state: null, stateVersion };
    }
    assertMutable(state, input);
    return database.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ readonly id: string }>>`
        SELECT "id" FROM "Room" WHERE "id" = ${state.room.roomId} FOR UPDATE
      `;
      const transactionalReplay = await transaction.requestIdempotency.findUnique({
        where: { scope_actorId_key: { actorId, key: input.operationId, scope } },
      });
      if (transactionalReplay) {
        if (transactionalReplay.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他请求");
        const stateVersion = storedStateVersion(transactionalReplay.response);
        const data = storedResponse<T>(transactionalReplay.response);
        if (stateVersion === null || !data) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "操作正在处理中");
        return { alreadyProcessed: true, data, state: null, stateVersion };
      }
      const locked = await snapshots.lock(state.room.roomId, transaction);
      if (!locked || locked.snapshotRevision !== state.snapshotRevision || locked.stateVersion !== state.stateVersion) {
        throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌快照已被较新事务更新");
      }
      assertMutable(state, input);
      const mutation = await mutate(transaction);
      const candidate = advanceRuntimeAuthority(state, mutation.update);
      const committed = await snapshots.persist(candidate, state.snapshotRevision, transaction);
      const response = { ...mutation.data, stateVersion: committed.stateVersion } as T;
      await transaction.requestIdempotency.create({
        data: {
          actorId,
          key: input.operationId,
          requestHash,
          ...(mutation.resourceId ? { resourceId: mutation.resourceId } : {}),
          response: response as unknown as Prisma.InputJsonValue,
          scope,
        },
      });
      return { alreadyProcessed: false, data: response, state: committed, stateVersion: committed.stateVersion };
    });
  }

  return {
    buyTimeExtension(
      state: RuntimeAuthorityState,
      actorId: string,
      input: BuyTimeExtensionCommand,
      now: Date,
    ): Promise<LifecycleCommit<ActionTimeExtensionResult>> {
      return commit(state, actorId, "TABLE_ACTION_TIME_EXTENSION", input, async (transaction) => {
        const hand = state.currentHand;
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        const actor = hand?.state.players.find((player) => player.seatIndex === hand.state.currentActorSeat);
        const deadline = hand?.turnDeadlineAt ?? null;
        const remainingMs = deadline ? deadline.getTime() - now.getTime() : Number.POSITIVE_INFINITY;
        if (
          !hand
          || hand.state.handId !== input.handId
          || hand.state.status !== "active"
          || !seat
          || actor?.playerId !== actorId
          || !deadline
          || remainingMs < 0
          || remainingMs > 3_000
        ) {
          throw new ApiError(409, "TIME_EXTENSION_NOT_AVAILABLE", "当前不能加时");
        }
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Wallet" WHERE "userId" = ${actorId} FOR UPDATE
        `;
        const wallet = await transaction.wallet.findUnique({ where: { userId: actorId } });
        if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "钻石账户不存在");
        const cost = tableDiamondFees().actionTimeExtension;
        const balanceAfter = wallet.balance - cost;
        if (balanceAfter < 0) throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", "钻石不足");
        const addedSeconds = state.room.actionTimeSeconds / 2;
        const nextDeadline = new Date(deadline.getTime() + addedSeconds * 1_000);
        const walletVersion = wallet.version + 1;
        await transaction.wallet.update({
          data: { balance: balanceAfter, version: walletVersion },
          where: { id: wallet.id },
        });
        const walletEntry = await transaction.walletLedgerEntry.create({
          data: {
            balanceAfter,
            balanceBefore: wallet.balance,
            idempotencyKey: `action-time-extension:${input.operationId}`,
            metadata: {
              addedSeconds,
              handId: hand.state.handId,
              previousDeadlineAt: deadline.toISOString(),
            },
            relatedGameSessionId: seat.gameSessionId,
            relatedRoomId: state.room.roomId,
            requestFingerprint: fingerprint("TABLE_ACTION_TIME_EXTENSION", actorId, input),
            sequence: walletVersion,
            signedAmount: -cost,
            type: "ACTION_TIME_EXTENSION",
            userId: actorId,
            walletId: wallet.id,
          },
        });
        return {
          data: {
            alreadyProcessed: false,
            cost,
            stateVersion: state.stateVersion + 1,
            turnDeadlineAt: nextDeadline.toISOString(),
            walletBalance: balanceAfter,
          },
          resourceId: walletEntry.id,
          update: { currentHand: { ...hand, turnDeadlineAt: nextDeadline } },
        };
      });
    },

    armNextAction(
      state: RuntimeAuthorityState,
      actorId: string,
      input: NextActionAutopilotCommand,
    ): Promise<LifecycleCommit<LifecycleCommandResult>> {
      return commit(state, actorId, "TABLE_AUTOPILOT_ARM", input, async (transaction) => {
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        const hand = state.currentHand?.state;
        const player = hand?.players.find((candidate) => candidate.playerId === actorId);
        if (!seat || !hand || hand.status !== "active" || !player || player.hasFolded || player.isAllIn) {
          throw new ApiError(409, "AUTOPILOT_NOT_AVAILABLE", "当前没有可托管的下一次行动");
        }
        if (seat.playStatus !== "ACTIVE") throw new ApiError(409, "AUTOPILOT_NOT_AVAILABLE", "当前座位状态不能托管");
        const nextActionAutoCallCurrentBet = input.mode === "CALL" ? hand.currentBet : null;
        if (input.mode === "CALL" && (nextActionAutoCallCurrentBet === null || nextActionAutoCallCurrentBet <= player.committedThisStreet)) {
          throw new ApiError(409, "AUTOPILOT_NOT_AVAILABLE", "当前没有需要自动跟注的筹码");
        }
        const updated = await transaction.tableSeat.update({
          data: { nextActionAutoCallCurrentBet, nextActionAutopilotArmed: true },
          where: { id: seat.seatId },
        });
        return {
          data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
          resourceId: seat.seatId,
          update: {
            seats: state.seats.map((candidate) => candidate.userId === actorId
              ? { ...candidate, nextActionAutoCallCurrentBet, nextActionAutopilotArmed: true, version: updated.version }
              : candidate),
          },
        };
      });
    },

    cancelNextAction(
      state: RuntimeAuthorityState,
      actorId: string,
      input: OperationEnvelope,
    ): Promise<LifecycleCommit<LifecycleCommandResult>> {
      return commit(state, actorId, "TABLE_AUTOPILOT_CANCEL", input, async (transaction) => {
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未入座");
        const updated = await transaction.tableSeat.update({
          data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false },
          where: { id: seat.seatId },
        });
        return {
          data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
          resourceId: seat.seatId,
          update: {
            seats: state.seats.map((candidate) => candidate.userId === actorId
              ? { ...candidate, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, version: updated.version }
              : candidate),
          },
        };
      });
    },

    setTrusteeship(
      state: RuntimeAuthorityState,
      actorId: string,
      input: TrusteeshipSetCommand,
    ): Promise<LifecycleCommit<LifecycleCommandResult>> {
      return commit(state, actorId, "TABLE_TRUSTEESHIP_SET", input, async (transaction) => {
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未入座");
        const updated = await transaction.tableSeat.update({
          data: {
            nextActionAutoCallCurrentBet: null,
            nextActionAutopilotArmed: false,
            trusteeshipEnabled: input.enabled,
            version: { increment: 1 },
          },
          where: { id: seat.seatId },
        });
        return {
          data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
          resourceId: seat.seatId,
          update: {
            seats: state.seats.map((candidate) => candidate.userId === actorId
              ? {
                ...candidate,
                nextActionAutoCallCurrentBet: null,
                nextActionAutopilotArmed: false,
                trusteeshipEnabled: input.enabled,
                version: updated.version,
              }
              : candidate),
          },
        };
      });
    },

    reserveAway(
      state: RuntimeAuthorityState,
      actorId: string,
      input: OperationEnvelope,
      now: Date,
    ): Promise<LifecycleCommit<SeatAccountingResult>> {
      return commit(state, actorId, "TABLE_RESERVE_AWAY", input, async (transaction) => {
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        if (!seat) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未入座");
        if (state.room.specialMode === "SQUID") {
          throw new ApiError(409, "SQUID_RESERVED_AWAY_DISABLED", "鱿鱼模式不能保位离桌");
        }
        if (state.room.status !== "OPEN" || seat.stack <= 0 || !["ACTIVE", "SIT_OUT"].includes(seat.playStatus)) {
          throw new ApiError(409, "RESERVED_AWAY_NOT_AVAILABLE", "当前座位状态不能保留离座");
        }
        const reservedAwayEndsAt = new Date(now.getTime() + RESERVED_AWAY_DURATION_MS);
        const updated = await transaction.tableSeat.update({
          data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false, playStatus: "RESERVED_AWAY", reservedAwayEndsAt, version: { increment: 1 } },
          where: { id: seat.seatId },
        });
        const wallet = await transaction.wallet.findUniqueOrThrow({ where: { userId: actorId } });
        return {
          data: {
            gameSessionId: seat.gameSessionId,
            playStatus: updated.playStatus,
            roomId: state.room.roomId,
            seatId: seat.seatId,
            seatIndex: seat.seatIndex,
            stack: seat.stack,
            version: updated.version,
            walletBalance: wallet.balance,
          },
          resourceId: seat.seatId,
          update: {
            seats: state.seats.map((candidate) => candidate.userId === actorId ? {
              ...candidate,
              nextActionAutoCallCurrentBet: null,
              nextActionAutopilotArmed: false,
              playStatus: "RESERVED_AWAY",
              reservedAwayEndsAt,
              version: updated.version,
            } : candidate),
          },
        };
      });
    },

    revealOwnCards(
      state: RuntimeAuthorityState,
      actorId: string,
      input: OperationEnvelope & { readonly cardIndex: 0 | 1; readonly handId: string },
    ): Promise<LifecycleCommit<LifecycleCommandResult>> {
      return commit(state, actorId, "TABLE_REVEAL_OWN_CARDS", input, async (transaction) => {
        const hand = state.currentHand;
        const review = state.postHandReview;
        const relevantHand = hand ?? review?.hand ?? null;
        if (!relevantHand || relevantHand.state.handId !== input.handId) {
          throw new ApiError(409, "HAND_REVIEW_CLOSED", "当前不能更改亮牌状态");
        }
        const player = relevantHand.state.players.find((candidate) => candidate.playerId === actorId);
        const seat = state.seats.find((candidate) => candidate.userId === actorId);
        if (!player || !seat) throw new ApiError(403, "ROOM_ACCESS_DENIED", "只有本手参与者可以设置亮牌");
        if (review) {
          if (player.holeCardsVisibility === "showdown") {
            throw new ApiError(409, "SHOWDOWN_CARDS_ALREADY_PUBLIC", "摊牌底牌已按规则公开，无需设置亮牌");
          }
          const existingIndices = [...(review.voluntarilyRevealedCardIndicesByUser[actorId] ?? [])];
          const nextIndices = existingIndices.includes(input.cardIndex)
            ? existingIndices.filter((index) => index !== input.cardIndex)
            : [...existingIndices, input.cardIndex];
          nextIndices.sort();
          const handPlayer = await transaction.handPlayerRecord.findUnique({
            where: { handId_userId: { handId: input.handId, userId: actorId } },
          });
          if (!handPlayer) throw new ApiError(409, "HAND_REVIEW_CLOSED", "结算记录尚不可用");
          await transaction.handPlayerRecord.update({
            data: {
              holeCardsPublic: nextIndices.length === 2,
              holeCardsPublicReason: nextIndices.length > 0 ? "VOLUNTARY" : null,
              voluntarilyRevealedAt: nextIndices.length > 0 ? new Date() : null,
              voluntarilyRevealedCardIndices: nextIndices,
            },
            where: { id: handPlayer.id },
          });
          const nextByUser = { ...review.voluntarilyRevealedCardIndicesByUser };
          if (nextIndices.length > 0) nextByUser[actorId] = nextIndices as Array<0 | 1>;
          else delete nextByUser[actorId];
          const fullyRevealedUserIds = Object.entries(nextByUser)
            .filter(([, indices]) => indices.length === 2)
            .map(([userId]) => userId)
            .sort();
          return {
            data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
            resourceId: handPlayer.id,
            update: {
              postHandReview: {
                ...review,
                voluntarilyRevealedCardIndicesByUser: nextByUser,
                voluntarilyRevealedUserIds: fullyRevealedUserIds,
              },
            },
          };
        }
        if (!hand || hand.state.status !== "active") throw new ApiError(409, "HAND_REVIEW_CLOSED", "当前不能更改亮牌状态");
        const existingIndices = [...(seat.pendingShowCardIndices ?? [])];
        const nextIndices = existingIndices.includes(input.cardIndex)
          ? existingIndices.filter((index) => index !== input.cardIndex)
          : [...existingIndices, input.cardIndex];
        nextIndices.sort();
        const updated = await transaction.tableSeat.update({
          data: { pendingShowCardIndices: nextIndices },
          where: { id: seat.seatId },
        });
        return {
          data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
          resourceId: seat.seatId,
          update: {
            seats: state.seats.map((candidate) => candidate.userId === actorId
              ? { ...candidate, pendingShowCardIndices: nextIndices as Array<0 | 1>, version: updated.version }
              : candidate),
          },
        };
      });
    },

    startTable(
      state: RuntimeAuthorityState,
      actorId: string,
      input: OperationEnvelope,
      _connectedUserIds: ReadonlySet<string>,
      now: Date,
    ): Promise<LifecycleCommit<LifecycleCommandResult>> {
      return commit(state, actorId, "TABLE_START", input, async (transaction) => {
        if (state.room.ownerId !== actorId) throw new ApiError(403, "ROOM_OWNER_REQUIRED", "只有房主可以开始牌桌");
        const eligible = state.seats.filter((seat) => seat.playStatus === "ACTIVE" && seat.stack > 0);
        if (
          state.room.status !== "OPEN"
          || (state.room.tableStartedAt !== null && state.room.tableStartedAt !== undefined && now.getTime() >= state.room.expiresAt.getTime())
          || state.room.nextHandPaused
          || !(state.room.requiresManualStart ?? true)
          || state.currentHand
          || state.postHandReview
          || eligible.length < 2
        ) {
          throw new ApiError(409, "TABLE_START_NOT_ALLOWED", "当前不能开始牌桌");
        }
        const tableStartedAt = state.room.tableStartedAt ?? now;
        const expiresAt = state.room.tableStartedAt
          ? state.room.expiresAt
          : new Date(now.getTime() + state.room.durationMinutes * 60_000);
        const squidRoundGraceEndsAt = state.room.specialMode === "SQUID"
          ? new Date(now.getTime() + 10_000)
          : null;
        const bombPotNextAt = state.room.specialMode === "BOMB_POT"
          ? state.room.bombPotNextAt ?? resolveBombPotHandStart({
              intervalMinutes: state.room.bombPotIntervalMinutes!,
              nextAt: null,
              now,
              tableStartedAt: null,
            }).nextAt
          : null;
        await transaction.room.update({
          data: { bombPotNextAt, expiresAt, requiresManualStart: false, squidRoundGraceEndsAt, tableStartedAt },
          where: { id: state.room.roomId },
        });
        return {
          data: { alreadyProcessed: false, stateVersion: state.stateVersion + 1 },
          resourceId: state.room.roomId,
          update: { room: { ...state.room, bombPotNextAt, expiresAt, requiresManualStart: false, squidRoundGraceEndsAt, tableStartedAt }, status: "IDLE" },
        };
      });
    },
  };
}
