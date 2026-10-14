import {
  applyPlayerAction,
  assertHandStateInvariants,
  getLegalActions,
  resolveRunoutChoice,
  startHand,
  type DomainEvent,
  type PlayerAction,
} from "@paiyouju/poker-core";
import {
  ActionCommandResultSchema,
  RunoutChoiceResultSchema,
  tableDiamondFees,
  type ActionCommandResult,
  type ActionSubmit,
  type PlayerIntent,
  type RunoutChoiceCommand,
  type RunoutChoiceResult,
} from "@paiyouju/shared";
import { createHash } from "node:crypto";

import type { DatabaseClient } from "../../../db/client.js";
import type { HandActionAutomaticReason, HandActionType, Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../../http/api-error.js";
import { createActionReceiptRepository } from "../idempotency/action-receipt-repository.js";
import type {
  CompletedActionInput,
  PersistCompletedHandInput,
  PersistCompletedHandResult,
} from "../hand-persistence.service.js";
import { createHandPersistenceService } from "../hand-persistence.service.js";
import { projectDomainEvent } from "../runtime/project-domain-event.js";
import { advanceRuntimeAuthority, type RuntimeAuthorityState } from "../runtime/runtime-authority-state.js";
import type { RuntimeHand, RuntimeRunoutVote, RuntimeSeat } from "../runtime/types.js";
import { postHandReviewDurationMs } from "../runtime/review-timing.js";
import { createSnapshotRepository } from "../snapshot/snapshot-repository.js";
import type { TableFaultContext } from "../../../testing/fault-injection.js";
import { bombPotBlindAmount, resolveBombPotHandStart } from "../bomb-pot.js";

export interface HandStartCommand {
  readonly connectedUserIds: ReadonlySet<string>;
  readonly deck: Parameters<typeof startHand>[0]["deck"];
  readonly handId: string;
  readonly now: Date;
  readonly participatingSeats: readonly RuntimeSeat[];
}

export interface ActionTransitionCommand {
  readonly connectedUserIds: ReadonlySet<string>;
  readonly input: ActionSubmit;
  readonly now: Date;
  readonly userId: string;
}

export interface TimeoutTransitionCommand {
  readonly actorUserId: string;
  readonly automaticReason: HandActionAutomaticReason;
  readonly connectedUserIds: ReadonlySet<string>;
  readonly deadline: Date;
  readonly handId: string;
  readonly now: Date;
  readonly pokerStateVersion: number;
}

export interface RunoutChoiceTransitionCommand {
  readonly connectedUserIds: ReadonlySet<string>;
  readonly input: RunoutChoiceCommand;
  readonly now: Date;
  readonly userId: string;
}

export interface RunoutVoteTimeoutCommand {
  readonly connectedUserIds: ReadonlySet<string>;
  readonly deadline: Date;
  readonly handId: string;
  readonly now: Date;
  readonly pokerStateVersion: number;
}

export interface PostHandReviewEndCommand {
  readonly connectedUserIds: ReadonlySet<string>;
  readonly endsAt: Date;
  readonly handId: string;
  readonly now: Date;
}

export interface CommittedTransition<T> {
  readonly events: readonly DomainEvent[];
  readonly replayed: boolean;
  readonly result: T;
  readonly state: RuntimeAuthorityState;
}

interface TransitionOptions {
  readonly onAfterSettlementCommit?: (context: TableFaultContext) => void | Promise<void>;
  readonly onAfterSnapshotCommit?: (context: TableFaultContext) => void | Promise<void>;
  readonly onBeforeActionReceiptCommit?: (context: TableFaultContext) => void | Promise<void>;
  readonly onBeforeSettlementCommit?: (context: TableFaultContext) => void | Promise<void>;
  readonly onBeforeSnapshotCommit?: (context: TableFaultContext) => void | Promise<void>;
}

function hashAction(input: ActionSubmit): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function hashRunoutChoice(input: RunoutChoiceCommand): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function runoutChoiceEnabled(state: RuntimeAuthorityState): boolean {
  return state.room.specialMode === "NORMAL" && (state.room.runItTwiceEnabled ?? false);
}

function createRunoutVote(hand: RuntimeHand["state"], now: Date): RuntimeRunoutVote | null {
  if (hand.status !== "runout_choice") return null;
  const eligible = hand.players
    .filter((player) => !player.hasFolded)
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((player) => player.playerId);
  if (eligible.length !== 2) throw new ApiError(500, "PERSISTENCE_ERROR", "发两次协商参与者数量异常");
  return {
    choicesByUser: {},
    deadlineAt: new Date(now.getTime() + 5_000),
    eligibleUserIds: [eligible[0]!, eligible[1]!],
  };
}

function coreAction(userId: string, intent: PlayerIntent): PlayerAction {
  switch (intent.type) {
    case "bet": return { actionType: "bet", amount: intent.amount, playerId: userId };
    case "raiseTo": return { actionType: "raiseTo", amount: intent.raiseTo, playerId: userId };
    default: return { actionType: intent.type, playerId: userId };
  }
}

function actionAmount(hand: RuntimeHand, userId: string, intent: PlayerIntent): number | null {
  const player = hand.state.players.find((candidate) => candidate.playerId === userId);
  if (!player) throw new ApiError(409, "PLAYER_NOT_SEATED", "你不在当前手牌中");
  switch (intent.type) {
    case "fold":
    case "check": return null;
    case "call": return Math.min(player.stack, Math.max(0, hand.state.currentBet - player.committedThisStreet));
    case "bet": return intent.amount - player.committedThisStreet;
    case "raiseTo": return intent.raiseTo - player.committedThisStreet;
    case "allIn": return player.stack;
  }
}

function auditActionType(intent: PlayerIntent): HandActionType {
  if (intent.type === "raiseTo") return "RAISE_TO";
  if (intent.type === "allIn") return "ALL_IN";
  return intent.type.toUpperCase() as HandActionType;
}

function completedAction(
  hand: RuntimeHand,
  userId: string,
  intent: PlayerIntent,
  automatic: boolean,
  automaticReason: HandActionAutomaticReason | null,
  clientActionId: string | null,
  nextPokerStateVersion: number,
  now: Date,
): CompletedActionInput {
  const player = hand.state.players.find((candidate) => candidate.playerId === userId);
  if (!player) throw new ApiError(409, "PLAYER_NOT_SEATED", "你不在当前手牌中");
  const amount = actionAmount(hand, userId, intent);
  const actionType = amount !== null && amount === player.stack
    ? "ALL_IN"
    : auditActionType(intent);
  return {
    actionType,
    amount,
    automatic,
    automaticReason,
    clientActionId,
    createdAt: now,
    raiseTo: actionType === "RAISE_TO" && intent.type === "raiseTo" ? intent.raiseTo : null,
    seatIndex: player.seatIndex,
    sequence: hand.actions.length + 1,
    stateVersion: nextPokerStateVersion,
    street: hand.state.street.toUpperCase() as CompletedActionInput["street"],
    userId,
  };
}

function settlementInput(
  state: RuntimeAuthorityState,
  finishedHand: RuntimeHand,
  now: Date,
  connectedUserIds: ReadonlySet<string>,
): PersistCompletedHandInput {
  return {
    actions: finishedHand.actions,
    connectedUserIds,
    finishedAt: now,
    handNumber: finishedHand.handNumber,
    handState: finishedHand.state,
    paidCardRevealCost: finishedHand.paidCardRevealCost,
    paidCardRevealEnabled: finishedHand.paidCardRevealEnabled,
    runoutChoicesByUser: finishedHand.runoutChoicesByUser ?? {},
    pendingShowCardIndicesByUser: new Map(state.seats.map((seat) => [seat.userId, [...(seat.pendingShowCardIndices ?? [])]])),
    roomId: state.room.roomId,
    seatSessions: new Map(state.seats.map((seat) => [seat.userId, seat.gameSessionId])),
    startedAt: finishedHand.startedAt,
  };
}

function postSettlementState(
  state: RuntimeAuthorityState,
  hand: RuntimeHand,
  persisted: PersistCompletedHandResult,
  finishedAt: Date,
): RuntimeAuthorityState {
  const existingByUser = new Map(state.seats.map((seat) => [seat.userId, seat]));
  const seats = persisted.remainingSeats.flatMap((seat) => {
    const existing = existingByUser.get(seat.userId);
    return existing ? [{ ...existing, ...seat }] : [];
  });
  const room = {
    ...state.room,
    status: persisted.roomStatus,
    squidRoundGraceEndsAt: persisted.squidRoundGraceEndsAt ?? state.room.squidRoundGraceEndsAt ?? null,
    squidRoundNumber: persisted.squidRoundNumber ?? state.room.squidRoundNumber ?? 1,
    ...(persisted.squidSettlementCompleted ? { squidSettlementPending: false } : {}),
  };
  const completedHand = { ...hand, turnDeadlineAt: null };
  const voluntarilyRevealedCardIndicesByUser = Object.fromEntries(
    state.seats
      .filter((seat) => {
        const player = hand.state.players.find((candidate) => candidate.playerId === seat.userId);
        return player?.holeCardsVisibility !== "showdown" && (seat.pendingShowCardIndices?.length ?? 0) > 0;
      })
      .map((seat) => [seat.userId, [...(seat.pendingShowCardIndices ?? [])]]),
  );
  return advanceRuntimeAuthority(state, {
    currentHand: null,
    lastButtonSeat: hand.state.buttonSeat,
    lastCompletedHand: completedHand,
    postHandReview: {
      endsAt: persisted.reviewEndsAt ?? new Date(finishedAt.getTime() + postHandReviewDurationMs(hand.state)),
      hand: completedHand,
      voluntarilyRevealedCardIndicesByUser,
      voluntarilyRevealedUserIds: Object.entries(voluntarilyRevealedCardIndicesByUser)
        .filter(([, indices]) => indices.length === 2)
        .map(([userId]) => userId)
        .sort(),
    },
    room,
    seats,
    startCountdownAt: null,
    status: "POST_HAND_REVIEW",
  });
}

function withNextDeadline(state: RuntimeAuthorityState, now: Date): RuntimeAuthorityState {
  const hand = state.currentHand;
  if (!hand || hand.state.status !== "active" || hand.state.currentActorSeat === null) return state;
  return {
    ...state,
    currentHand: {
      ...hand,
      turnDeadlineAt: new Date(now.getTime() + state.room.actionTimeSeconds * 1_000),
    },
  };
}

export function createTableTransitionService(database: DatabaseClient, options: TransitionOptions = {}) {
  const receipts = createActionReceiptRepository(database);
  const snapshots = createSnapshotRepository(database);
  const persistence = createHandPersistenceService(database);

  async function lockSnapshot(state: RuntimeAuthorityState, transaction: Prisma.TransactionClient): Promise<void> {
    const record = await snapshots.lock(state.room.roomId, transaction);
    assertLockedSnapshot(state, record);
  }

  function assertLockedSnapshot(
    state: RuntimeAuthorityState,
    record: Awaited<ReturnType<typeof snapshots.lock>>,
  ): void {
    if (!record || record.snapshotRevision !== state.snapshotRevision || record.stateVersion !== state.stateVersion) {
      throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌快照已被较新事务更新");
    }
  }

  async function commitCandidate(
    candidate: RuntimeAuthorityState,
    previousRevision: number,
    transaction: Prisma.TransactionClient,
    context: TableFaultContext,
  ): Promise<RuntimeAuthorityState> {
    await options.onBeforeSnapshotCommit?.(context);
    return snapshots.persist(candidate, previousRevision, transaction);
  }

  async function settleIfFinished(
    candidate: RuntimeAuthorityState,
    now: Date,
    connectedUserIds: ReadonlySet<string>,
    transaction: Prisma.TransactionClient,
    context: TableFaultContext,
  ): Promise<RuntimeAuthorityState> {
    const hand = candidate.currentHand;
    if (!hand || hand.state.status !== "finished") return candidate;
    await options.onBeforeSettlementCommit?.(context);
    const persisted = await persistence.persistCompletedHandInTransaction(
      transaction,
      settlementInput(candidate, hand, now, connectedUserIds),
    );
    return postSettlementState(candidate, hand, persisted, now);
  }

  async function afterCommit(
    settled: boolean,
    context: TableFaultContext,
    state: RuntimeAuthorityState,
  ): Promise<void> {
    const committedContext = {
      ...context,
      snapshotRevision: state.snapshotRevision,
      stateVersion: state.stateVersion,
    };
    if (settled) await options.onAfterSettlementCommit?.(committedContext);
    await options.onAfterSnapshotCommit?.(committedContext);
  }

  return {
    async commitRoomExpiry(state: RuntimeAuthorityState, now: Date): Promise<RuntimeAuthorityState | null> {
      const committed = await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${state.room.roomId} FOR UPDATE
        `;
        await lockSnapshot(state, transaction);
        const room = await transaction.room.findUniqueOrThrow({ where: { id: state.room.roomId } });
        if (room.status !== "OPEN" || now.getTime() < room.expiresAt.getTime()) return null;
        const closeImmediately = state.seats.length === 0 && !state.currentHand && !state.postHandReview;
        await transaction.room.update({
          data: {
            ...(closeImmediately ? { closedAt: now } : {}),
            closeRequestedAt: now,
            requiresManualStart: true,
            status: closeImmediately ? "CLOSED" : "CLOSING",
            tableStartedAt: null,
          },
          where: { id: room.id },
        });
        const candidate = advanceRuntimeAuthority(state, {
          room: {
            ...state.room,
            requiresManualStart: true,
            status: closeImmediately ? "CLOSED" : "CLOSING",
            tableStartedAt: null,
          },
          startCountdownAt: null,
          status: closeImmediately ? "CLOSED" : state.postHandReview ? "POST_HAND_REVIEW" : "CLOSING",
        });
        return commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "runtime" });
      });
      if (committed) await afterCommit(false, { transition: "runtime" }, committed);
      return committed;
    },

    async commitRuntimeState(state: RuntimeAuthorityState, candidate: RuntimeAuthorityState): Promise<RuntimeAuthorityState> {
      const committed = await database.$transaction(async (transaction) => {
        await lockSnapshot(state, transaction);
        if (candidate.stateVersion !== state.stateVersion + 1) {
          throw new ApiError(409, "SNAPSHOT_CONFLICT", "牌桌状态版本必须连续递增");
        }
        return commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "runtime" });
      });
      await afterCommit(false, { transition: "runtime" }, committed);
      return committed;
    },

    async commitStart(state: RuntimeAuthorityState, command: HandStartCommand): Promise<CommittedTransition<RuntimeHand>> {
      let settled = false;
      const committed = await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${state.room.roomId} FOR UPDATE
        `;
        await lockSnapshot(state, transaction);
        const room = await transaction.room.findUniqueOrThrow({ where: { id: state.room.roomId } });
        if (room.status !== "OPEN" || room.nextHandPaused || command.now.getTime() >= room.expiresAt.getTime()) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "房间当前不能开始新手牌");
        if (command.participatingSeats.length < 2) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "开局人数不足");
        const latestHand = await transaction.handRecord.findFirst({
          orderBy: { handNumber: "desc" },
          select: { handNumber: true },
          where: { roomId: room.id },
        });
        const handNumber = Math.max(room.nextHandNumber, (latestHand?.handNumber ?? 0) + 1);
        const bombPotResolution = room.specialMode === "BOMB_POT"
          ? resolveBombPotHandStart({
              intervalMinutes: room.bombPotIntervalMinutes!,
              nextAt: room.bombPotNextAt,
              now: command.now,
              tableStartedAt: room.tableStartedAt,
            })
          : null;
        await transaction.room.update({
          data: {
            bombPotNextAt: bombPotResolution?.nextAt ?? null,
            nextHandNumber: handNumber + 1,
            squidRoundGraceEndsAt: null,
          },
          where: { id: room.id },
        });
        const participatingUserIds = new Set(command.participatingSeats.map((seat) => seat.userId));
        const started = startHand({
          config: {
            bigBlind: state.room.bigBlind,
            maxSeats: state.room.maxSeats,
            smallBlind: state.room.smallBlind,
            variant: state.room.specialMode === "SHORT_DECK" ? "SHORT_DECK" : "STANDARD",
          },
          deck: command.deck,
          handId: command.handId,
          ...(bombPotResolution?.bombPot ? { bombPotBlind: bombPotBlindAmount(room.bigBlind, room.bombPotBlindMultiplier!) } : {}),
          previousButtonSeat: state.lastButtonSeat,
          deferHeadsUpAllInRunout: runoutChoiceEnabled(state),
          seats: state.seats.map((seat) => ({ isParticipating: participatingUserIds.has(seat.userId), playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
        });
        assertHandStateInvariants(started.state);
        const handEntryFee = tableDiamondFees().handEntry;
        const participatingSeats = [...command.participatingSeats].sort((left, right) => left.userId.localeCompare(right.userId));
        for (const seat of participatingSeats) {
          await transaction.$queryRaw<Array<{ readonly id: string }>>`
            SELECT "id" FROM "Wallet" WHERE "userId" = ${seat.userId} FOR UPDATE
          `;
        }
        const wallets = await transaction.wallet.findMany({ where: { userId: { in: participatingSeats.map((seat) => seat.userId) } } });
        const walletsByUser = new Map(wallets.map((wallet) => [wallet.userId, wallet]));
        for (const seat of participatingSeats) {
          const wallet = walletsByUser.get(seat.userId);
          if (!wallet) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "参与者钻石账户已更新");
          if (wallet.balance < handEntryFee) {
            throw new ApiError(409, "INSUFFICIENT_WALLET_BALANCE", `钻石不足，每手开局需要 ${handEntryFee} 钻石`);
          }
          const balanceAfter = wallet.balance - handEntryFee;
          const walletVersion = wallet.version + 1;
          await transaction.wallet.update({ data: { balance: balanceAfter, version: walletVersion }, where: { id: wallet.id } });
          await transaction.walletLedgerEntry.create({
            data: {
              balanceAfter,
              balanceBefore: wallet.balance,
              idempotencyKey: `hand-entry:${command.handId}:${seat.userId}`,
              metadata: { handId: command.handId },
              relatedGameSessionId: seat.gameSessionId,
              relatedRoomId: room.id,
              requestFingerprint: `hand-entry:${command.handId}:${seat.userId}:${handEntryFee}`,
              sequence: walletVersion,
              signedAmount: -handEntryFee,
              type: "HAND_ENTRY_FEE",
              userId: seat.userId,
              walletId: wallet.id,
            },
          });
        }
        const hand: RuntimeHand = {
          actions: [],
          handNumber,
          paidCardRevealCost: room.paidCardRevealCost,
          paidCardRevealEnabled: room.paidCardRevealEnabled,
          runoutChoicesByUser: {},
          runoutVote: createRunoutVote(started.state, command.now),
          startedAt: command.now,
          state: started.state,
          turnDeadlineAt: null,
        };
        let candidate = advanceRuntimeAuthority(state, {
          currentHand: hand,
          handNumber,
          lastCompletedHand: null,
          room: { ...state.room, bombPotNextAt: bombPotResolution?.nextAt ?? null, squidRoundGraceEndsAt: null },
          startCountdownAt: null,
          status: state.room.status === "CLOSING" ? "CLOSING" : "PLAYING",
        });
        candidate = await settleIfFinished(candidate, command.now, command.connectedUserIds, transaction, { transition: "start" });
        settled = candidate.postHandReview !== null && candidate.postHandReview !== undefined;
        candidate = withNextDeadline(candidate, command.now);
        const committed = await commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "start" });
        return { events: started.events, replayed: false, result: hand, state: committed };
      });
      await afterCommit(settled, { transition: "start" }, committed.state);
      return committed;
    },

    async commitPlayerAction(state: RuntimeAuthorityState, command: ActionTransitionCommand): Promise<CommittedTransition<ActionCommandResult>> {
      const fingerprint = hashAction(command.input);
      let settled = false;
      const committed = await database.$transaction(async (transaction) => {
        const lockedSnapshot = await snapshots.lock(state.room.roomId, transaction);
        const replay = await receipts.replayOrConflict({ clientActionId: command.input.clientActionId, fingerprint, roomId: command.input.roomId, userId: command.userId }, transaction);
        if (replay) return { events: [], replayed: true, result: replay, state };
        assertLockedSnapshot(state, lockedSnapshot);
        const hand = state.currentHand;
        if (!hand || !["PLAYING", "CLOSING"].includes(state.status)) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "牌桌当前不可行动");
        if (command.input.expectedStateVersion !== state.stateVersion) throw new ApiError(409, "STALE_STATE", "牌桌状态已更新");
        if (command.input.handId !== hand.state.handId) throw new ApiError(409, "HAND_ID_MISMATCH", "手牌已更新");
        if (hand.turnDeadlineAt && command.now.getTime() > hand.turnDeadlineAt.getTime()) throw new ApiError(409, "STALE_STATE", "行动时间已结束，请等待服务器处理超时");
        const applied = applyPlayerAction(hand.state, coreAction(command.userId, command.input.action), {
          deferHeadsUpAllInRunout: runoutChoiceEnabled(state),
        });
        assertHandStateInvariants(applied.state);
        const nextHand: RuntimeHand = {
          ...hand,
          actions: [...hand.actions, completedAction(hand, command.userId, command.input.action, false, null, command.input.clientActionId, applied.state.stateVersion, command.now)],
          state: applied.state,
          runoutVote: createRunoutVote(applied.state, command.now),
          turnDeadlineAt: null,
        };
        const currentBetChanged = hand.state.currentBet !== applied.state.currentBet;
        const clearedSeatIds = new Set(
          state.seats
            .filter((seat) =>
              seat.userId === command.userId && seat.nextActionAutopilotArmed
              || currentBetChanged && seat.nextActionAutoCallCurrentBet !== null && seat.nextActionAutoCallCurrentBet !== undefined
            )
            .map((seat) => seat.seatId),
        );
        if (clearedSeatIds.size > 0) {
          await transaction.tableSeat.updateMany({
            data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false },
            where: { id: { in: [...clearedSeatIds] } },
          });
        }
        let candidate = advanceRuntimeAuthority(state, {
          currentHand: nextHand,
          ...(clearedSeatIds.size > 0 ? { seats: state.seats.map((seat) => clearedSeatIds.has(seat.seatId) ? { ...seat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false } : seat) } : {}),
        });
        candidate = await settleIfFinished(candidate, command.now, command.connectedUserIds, transaction, { transition: "action" });
        settled = candidate.postHandReview !== null && candidate.postHandReview !== undefined;
        candidate = withNextDeadline(candidate, command.now);
        const result: ActionCommandResult = { alreadyProcessed: false, events: applied.events.map(projectDomainEvent), stateVersion: candidate.stateVersion };
        ActionCommandResultSchema.parse(result);
        await options.onBeforeActionReceiptCommit?.({ transition: "action" });
        await receipts.create({ actionType: auditActionType(command.input.action), clientActionId: command.input.clientActionId, fingerprint, handId: command.input.handId, result, roomId: command.input.roomId, userId: command.userId }, transaction);
        const committed = await commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "action" });
        return { events: applied.events, replayed: false, result, state: committed };
      });
      if (!committed.replayed) await afterCommit(settled, { transition: "action" }, committed.state);
      return committed;
    },

    async commitTimeout(state: RuntimeAuthorityState, command: TimeoutTransitionCommand): Promise<CommittedTransition<ActionCommandResult> | null> {
      let settled = false;
      const committed = await database.$transaction(async (transaction) => {
        await lockSnapshot(state, transaction);
        const hand = state.currentHand;
        if (
          !hand
          || hand.state.handId !== command.handId
          || hand.state.stateVersion !== command.pokerStateVersion
          || hand.turnDeadlineAt?.getTime() !== command.deadline.getTime()
          || (command.automaticReason === "TURN_TIMEOUT" && command.now.getTime() < command.deadline.getTime())
        ) return null;
        const actor = hand.state.players.find((player) => player.seatIndex === hand.state.currentActorSeat);
        if (actor?.playerId !== command.actorUserId) return null;
        const runtimeSeat = state.seats.find((seat) => seat.userId === command.actorUserId);
        if (command.automaticReason === "NEXT_DECISION_AUTOPILOT" && !runtimeSeat?.nextActionAutopilotArmed) return null;
        if (
          command.automaticReason === "NEXT_DECISION_AUTO_CALL"
          && (!runtimeSeat?.nextActionAutopilotArmed || runtimeSeat.nextActionAutoCallCurrentBet !== hand.state.currentBet)
        ) return null;
        if (command.automaticReason === "RESERVED_AWAY" && runtimeSeat?.playStatus !== "RESERVED_AWAY") return null;
        if (command.automaticReason === "LEAVE_AFTER_HAND" && runtimeSeat?.playStatus !== "LEAVE_AFTER_HAND") return null;
        if (
          command.automaticReason === "TRUSTEESHIP"
          && !runtimeSeat?.trusteeshipEnabled
          && command.connectedUserIds.has(command.actorUserId)
        ) return null;
        const legal = getLegalActions(hand.state, command.actorUserId);
        if (command.automaticReason === "NEXT_DECISION_AUTO_CALL" && !legal.canCall) return null;
        const intent: PlayerIntent = command.automaticReason === "NEXT_DECISION_AUTO_CALL"
          ? { type: "call" }
          : { type: legal.canCheck ? "check" : "fold" };
        const applied = applyPlayerAction(hand.state, coreAction(command.actorUserId, intent), {
          deferHeadsUpAllInRunout: runoutChoiceEnabled(state),
        });
        assertHandStateInvariants(applied.state);
        const nextHand: RuntimeHand = {
          ...hand,
          actions: [...hand.actions, completedAction(hand, command.actorUserId, intent, true, command.automaticReason, null, applied.state.stateVersion, command.now)],
          state: applied.state,
          runoutVote: createRunoutVote(applied.state, command.now),
          turnDeadlineAt: null,
        };
        const consumesPreAction = command.automaticReason === "NEXT_DECISION_AUTOPILOT" || command.automaticReason === "NEXT_DECISION_AUTO_CALL";
        if (consumesPreAction && runtimeSeat) {
          await transaction.tableSeat.update({ data: { nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false }, where: { id: runtimeSeat.seatId } });
        }
        let candidate = advanceRuntimeAuthority(state, {
          currentHand: nextHand,
          ...(consumesPreAction
            ? { seats: state.seats.map((seat) => seat.userId === command.actorUserId ? { ...seat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false } : seat) }
            : {}),
        });
        candidate = await settleIfFinished(candidate, command.now, command.connectedUserIds, transaction, { transition: "timeout" });
        settled = candidate.postHandReview !== null && candidate.postHandReview !== undefined;
        candidate = withNextDeadline(candidate, command.now);
        const result: ActionCommandResult = { alreadyProcessed: false, events: applied.events.map(projectDomainEvent), stateVersion: candidate.stateVersion };
        const committed = await commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "timeout" });
        return { events: applied.events, replayed: false, result, state: committed };
      });
      if (committed) await afterCommit(settled, { transition: "timeout" }, committed.state);
      return committed;
    },

    async commitRunoutChoice(state: RuntimeAuthorityState, command: RunoutChoiceTransitionCommand): Promise<CommittedTransition<RunoutChoiceResult>> {
      const fingerprint = hashRunoutChoice(command.input);
      let settled = false;
      const committed = await database.$transaction(async (transaction) => {
        const lockedSnapshot = await snapshots.lock(state.room.roomId, transaction);
        const existing = await transaction.requestIdempotency.findUnique({
          where: { scope_actorId_key: { actorId: command.userId, key: command.input.operationId, scope: "TABLE_RUNOUT_CHOICE" } },
        });
        if (existing) {
          if (existing.requestHash !== fingerprint) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "操作 ID 已用于其他发牌选择");
          const parsed = RunoutChoiceResultSchema.safeParse(existing.response);
          if (!parsed.success) throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "发牌选择正在处理");
          return { events: [], replayed: true, result: { ...parsed.data, alreadyProcessed: true }, state };
        }
        assertLockedSnapshot(state, lockedSnapshot);
        if (command.input.expectedStateVersion !== state.stateVersion) throw new ApiError(409, "STALE_STATE", "牌桌状态已更新");
        const hand = state.currentHand;
        const vote = hand?.runoutVote;
        if (!hand || hand.state.handId !== command.input.handId) throw new ApiError(409, "HAND_ID_MISMATCH", "手牌已更新");
        if (!vote || hand.state.status !== "runout_choice" || !vote.eligibleUserIds.includes(command.userId)) {
          throw new ApiError(409, "RUNOUT_CHOICE_NOT_AVAILABLE", "当前不能选择发牌次数");
        }
        if (command.now.getTime() > vote.deadlineAt.getTime()) throw new ApiError(409, "STALE_STATE", "发牌选择时间已结束");
        const choicesByUser = { ...vote.choicesByUser, [command.userId]: command.input.choice };
        const allTwice = vote.eligibleUserIds.every((userId) => choicesByUser[userId] === "TWICE");
        let events: readonly DomainEvent[] = [];
        let nextHand: RuntimeHand = { ...hand, runoutChoicesByUser: choicesByUser, runoutVote: { ...vote, choicesByUser } };
        if (allTwice) {
          const resolved = resolveRunoutChoice(hand.state, true);
          assertHandStateInvariants(resolved.state, hand.state);
          events = resolved.events;
          nextHand = { ...nextHand, runoutVote: null, state: resolved.state };
        }
        let candidate = advanceRuntimeAuthority(state, { currentHand: nextHand });
        candidate = await settleIfFinished(candidate, command.now, command.connectedUserIds, transaction, { transition: "action" });
        settled = candidate.postHandReview !== null && candidate.postHandReview !== undefined;
        const result = RunoutChoiceResultSchema.parse({
          alreadyProcessed: false,
          choice: command.input.choice,
          resolvedRunoutCount: allTwice ? 2 : null,
          stateVersion: candidate.stateVersion,
        });
        await transaction.requestIdempotency.create({
          data: {
            actorId: command.userId,
            key: command.input.operationId,
            requestHash: fingerprint,
            resourceId: command.input.handId,
            response: result as unknown as Prisma.InputJsonValue,
            scope: "TABLE_RUNOUT_CHOICE",
          },
        });
        const persisted = await commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "action" });
        return { events, replayed: false, result, state: persisted };
      });
      if (!committed.replayed) await afterCommit(settled, { transition: "action" }, committed.state);
      return committed;
    },

    async commitRunoutVoteTimeout(state: RuntimeAuthorityState, command: RunoutVoteTimeoutCommand): Promise<CommittedTransition<ActionCommandResult> | null> {
      let settled = false;
      const committed = await database.$transaction(async (transaction) => {
        await lockSnapshot(state, transaction);
        const hand = state.currentHand;
        const vote = hand?.runoutVote;
        if (!hand || !vote
          || hand.state.handId !== command.handId
          || hand.state.stateVersion !== command.pokerStateVersion
          || vote.deadlineAt.getTime() !== command.deadline.getTime()
          || command.now.getTime() < command.deadline.getTime()) return null;
        const allTwice = vote.eligibleUserIds.every((userId) => vote.choicesByUser[userId] === "TWICE");
        const resolved = resolveRunoutChoice(hand.state, allTwice);
        assertHandStateInvariants(resolved.state, hand.state);
        const nextHand: RuntimeHand = { ...hand, runoutChoicesByUser: vote.choicesByUser, runoutVote: null, state: resolved.state, turnDeadlineAt: null };
        let candidate = advanceRuntimeAuthority(state, { currentHand: nextHand });
        candidate = await settleIfFinished(candidate, command.now, command.connectedUserIds, transaction, { transition: "timeout" });
        settled = candidate.postHandReview !== null && candidate.postHandReview !== undefined;
        const result: ActionCommandResult = {
          alreadyProcessed: false,
          events: resolved.events.map(projectDomainEvent),
          stateVersion: candidate.stateVersion,
        };
        const persisted = await commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "timeout" });
        return { events: resolved.events, replayed: false, result, state: persisted };
      });
      if (committed) await afterCommit(settled, { transition: "timeout" }, committed.state);
      return committed;
    },

    async commitPostHandReviewEnd(state: RuntimeAuthorityState, command: PostHandReviewEndCommand): Promise<RuntimeAuthorityState | null> {
      let closed = false;
      const committed = await database.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ readonly id: string }>>`
          SELECT "id" FROM "Room" WHERE "id" = ${state.room.roomId} FOR UPDATE
        `;
        await lockSnapshot(state, transaction);
        const review = state.postHandReview;
        if (
          !review
          || review.hand.state.handId !== command.handId
          || review.endsAt.getTime() !== command.endsAt.getTime()
          || command.now.getTime() < command.endsAt.getTime()
        ) return null;
        let room: RuntimeAuthorityState["room"];
        let seats = state.seats;
        let status: RuntimeAuthorityState["status"];
        if (state.room.status === "CLOSING") {
          await persistence.closeRoomAfterReviewInTransaction(transaction, {
            closedAt: command.now,
            reviewHandId: command.handId,
            roomId: state.room.roomId,
          });
          room = { ...state.room, requiresManualStart: true, status: "CLOSED", tableStartedAt: null };
          seats = [];
          status = "CLOSED";
          closed = true;
        } else {
          const eligible = state.seats.filter((seat) => seat.playStatus === "ACTIVE" && seat.stack > 0);
          const requiresManualStart = state.room.tableStartedAt === null && eligible.length < 2;
          const clearSquidGrace = state.room.squidRoundGraceEndsAt !== null
            && state.room.squidRoundGraceEndsAt !== undefined
            && command.now.getTime() >= state.room.squidRoundGraceEndsAt.getTime();
          if (requiresManualStart !== (state.room.requiresManualStart ?? true) || clearSquidGrace) {
            await transaction.room.update({
              data: { requiresManualStart, ...(clearSquidGrace ? { squidRoundGraceEndsAt: null } : {}) },
              where: { id: state.room.roomId },
            });
          }
          room = {
            ...state.room,
            requiresManualStart,
            ...(clearSquidGrace ? { squidRoundGraceEndsAt: null } : {}),
            tableStartedAt: state.room.tableStartedAt ?? null,
          };
          status = room.nextHandPaused ? "PAUSED" : "IDLE";
        }
        const candidate = advanceRuntimeAuthority(state, { postHandReview: null, room, seats, status });
        return commitCandidate(candidate, state.snapshotRevision, transaction, { transition: "runtime" });
      });
      if (committed) await afterCommit(closed, { transition: "runtime" }, committed);
      return committed;
    },
  };
}
