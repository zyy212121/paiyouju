import {
  PokerRuleError,
  applyPlayerAction,
  assertHandStateInvariants,
  getLegalActions,
  resolveRunoutChoice,
  startHand,
  type HandState,
  type PlayerAction,
  type PlayerHandState,
} from "@paiyouju/poker-core";
import type { ActionCommandResult, ActionSubmit, PlayerIntent, RunoutChoiceCommand, RunoutChoiceResult } from "@paiyouju/shared";
import { createHash } from "node:crypto";

import { ApiError } from "../../../http/api-error.js";
import type { CompletedActionInput, PersistCompletedHandResult } from "../hand-persistence.service.js";
import type { HandActionAutomaticReason } from "../../../generated/prisma/client.js";
import type { Clock, ScheduledTask, Scheduler } from "./clock.js";
import type { DeckProvider } from "./deck-provider.js";
import { postHandReviewDurationMs } from "./review-timing.js";
import type { TableRuntime } from "./table-runtime.js";
import type { ProcessedAction, RuntimeRunoutVote, RuntimeSeat, RuntimeStatus } from "./types.js";
import { projectDomainEvent } from "./project-domain-event.js";
import { applyRuntimeAuthority, captureRuntimeAuthority, advanceRuntimeAuthority, type RuntimeAuthorityState } from "./runtime-authority-state.js";
import { bombPotBlindAmount, resolveBombPotHandStart } from "../bomb-pot.js";

interface HandControllerDependencies {
  readonly assertHandCanStart?: (seats: readonly RuntimeSeat[]) => void | Promise<void>;
  readonly clock: Clock;
  readonly deckProvider: DeckProvider;
  readonly idFactory: () => string;
  readonly loadAuthoritativeState?: () => Promise<RuntimeAuthorityState | null>;
  readonly onError?: (error: unknown) => void | Promise<void>;
  readonly onFatalError?: (error: ApiError) => void | Promise<void>;
  readonly onLifecycle?: (event: HandLifecycleEvent) => void | Promise<void>;
  readonly onProbe?: (event: HandStartProbeEvent) => void | Promise<void>;
  readonly persistCompletedHand: (runtime: TableRuntime) => Promise<PersistCompletedHandResult>;
  readonly commitPlayerAction?: (
    state: RuntimeAuthorityState,
    input: { readonly connectedUserIds: ReadonlySet<string>; readonly input: ActionSubmit; readonly now: Date; readonly userId: string },
  ) => Promise<{ readonly events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[]; readonly replayed: boolean; readonly result: ActionCommandResult; readonly state: RuntimeAuthorityState }>;
  readonly commitPostHandReviewEnd?: (
    state: RuntimeAuthorityState,
    input: { readonly connectedUserIds: ReadonlySet<string>; readonly endsAt: Date; readonly handId: string; readonly now: Date },
  ) => Promise<RuntimeAuthorityState | null>;
  readonly commitRunoutChoice?: (
    state: RuntimeAuthorityState,
    input: { readonly connectedUserIds: ReadonlySet<string>; readonly input: RunoutChoiceCommand; readonly now: Date; readonly userId: string },
  ) => Promise<{ readonly events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[]; readonly replayed: boolean; readonly result: RunoutChoiceResult; readonly state: RuntimeAuthorityState }>;
  readonly commitRunoutVoteTimeout?: (
    state: RuntimeAuthorityState,
    input: { readonly connectedUserIds: ReadonlySet<string>; readonly deadline: Date; readonly handId: string; readonly now: Date; readonly pokerStateVersion: number },
  ) => Promise<{ readonly events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[]; readonly result: ActionCommandResult; readonly state: RuntimeAuthorityState } | null>;
  readonly commitRoomExpiry?: (state: RuntimeAuthorityState, now: Date) => Promise<RuntimeAuthorityState | null>;
  readonly commitRuntimeState?: (state: RuntimeAuthorityState, candidate: RuntimeAuthorityState) => Promise<RuntimeAuthorityState>;
  readonly commitStart?: (
    state: RuntimeAuthorityState,
    input: { readonly connectedUserIds: ReadonlySet<string>; readonly deck: ReturnType<DeckProvider["nextDeck"]>; readonly handId: string; readonly now: Date; readonly participatingSeats: readonly RuntimeSeat[] },
  ) => Promise<{ readonly events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[]; readonly state: RuntimeAuthorityState }>;
  readonly commitTimeout?: (
    state: RuntimeAuthorityState,
    input: { readonly actorUserId: string; readonly automaticReason: HandActionAutomaticReason; readonly connectedUserIds: ReadonlySet<string>; readonly deadline: Date; readonly handId: string; readonly now: Date; readonly pokerStateVersion: number },
  ) => Promise<{ readonly events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[]; readonly result: ActionCommandResult; readonly state: RuntimeAuthorityState } | null>;
  readonly prepareHandParticipants?: (seats: readonly RuntimeSeat[]) => readonly RuntimeSeat[] | Promise<readonly RuntimeSeat[]>;
  readonly retainConnectedParticipants?: (seats: readonly RuntimeSeat[]) => readonly RuntimeSeat[];
  readonly scheduler: Scheduler;
  readonly onRoomExpired?: () => void | Promise<void>;
  readonly onStateChanged?: () => void | Promise<void>;
}

export interface HandLifecycleEvent {
  readonly actionType?: PlayerIntent["type"];
  readonly amount?: number;
  readonly handId?: string;
  readonly roomId: string;
  readonly seatIndex?: number;
  readonly stateVersion: number;
  readonly street?: "preflop" | "flop" | "turn" | "river" | "showdown";
  readonly type:
    | "start countdown"
    | "hand started"
    | "automatic action"
    | "street advanced"
    | "hand completed"
    | "hand persistence failed"
    | "state invariant violation";
  readonly userId?: string;
}

export type HandStartGateReason =
  | "ACCOUNTING_REJECTED"
  | "AUTHENTICATED_CONNECTED_PARTICIPANTS_BELOW_TWO"
  | "HAND_ALREADY_ACTIVE"
  | "INSUFFICIENT_ELIGIBLE_SEATS"
  | "INSUFFICIENT_ELIGIBLE_SEATS_DURING_COUNTDOWN"
  | "MANUAL_START_REQUIRED"
  | "OWNER_PAUSED"
  | "OWNER_PAUSED_DURING_COUNTDOWN"
  | "PERSISTENCE_ERROR"
  | "POST_HAND_REVIEW_ACTIVE"
  | "PREPARE_PARTICIPANTS_FAILED"
  | "PREPARED_PARTICIPANTS_BELOW_TWO"
  | "RECOVERY_ERROR"
  | "RETAIN_PARTICIPANTS_FAILED"
  | "ROOM_EXPIRED"
  | "ROOM_NOT_OPEN"
  | "START_COMMIT_REJECTED";

export interface HandStartProbeEvent {
  readonly candidateUserIds: readonly string[];
  readonly connectedSeatCount: number;
  readonly connectedUserIds: readonly string[];
  readonly eligibleSeatCount: number;
  readonly eligibleUserIds: readonly string[];
  readonly failureCode: string | null;
  readonly handId: string | null;
  readonly outcome: "cancelled" | "scheduled" | "started";
  readonly presenceVersion: number;
  readonly reason: HandStartGateReason | null;
  readonly roomId: string;
  readonly runtimeStatus: RuntimeStatus;
  readonly seatCount: number;
  readonly startCountdownAt: string | null;
  readonly stateVersion: number;
  readonly type: "HAND_START_COUNTDOWN" | "HAND_START_GATE";
}

function hashAction(input: ActionSubmit): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function rememberProcessedAction(runtime: TableRuntime, cacheKey: string, action: ProcessedAction): void {
  runtime.actionCache.set(cacheKey, action);
  while (runtime.actionCache.size > 512) {
    const historical = [...runtime.actionCache.entries()].find(([, entry]) => entry.handId !== action.handId);
    if (!historical) break;
    runtime.actionCache.delete(historical[0]);
  }
}

function toCoreAction(userId: string, intent: PlayerIntent): PlayerAction {
  switch (intent.type) {
    case "bet": return { actionType: "bet", amount: intent.amount, playerId: userId };
    case "raiseTo": return { actionType: "raiseTo", amount: intent.raiseTo, playerId: userId };
    default: return { actionType: intent.type, playerId: userId };
  }
}

function actualChipPayment(
  state: HandState,
  player: PlayerHandState,
  intent: PlayerIntent,
): number | null {
  switch (intent.type) {
    case "fold":
    case "check":
      return null;
    case "call":
      return Math.min(player.stack, Math.max(0, state.currentBet - player.committedThisStreet));
    case "bet":
      return intent.amount - player.committedThisStreet;
    case "raiseTo":
      return intent.raiseTo - player.committedThisStreet;
    case "allIn":
      return player.stack;
  }
}

function persistenceAction(
  input: {
    readonly action: PlayerIntent;
    readonly allIn: boolean;
    readonly amount: number | null;
    readonly automatic: boolean;
    readonly automaticReason?: HandActionAutomaticReason | null;
    readonly clientActionId: string | null;
    readonly seatIndex: number;
    readonly stateVersion: number;
    readonly street: "preflop" | "flop" | "turn" | "river" | "showdown";
    readonly userId: string;
  },
  sequence: number,
  createdAt: Date,
): CompletedActionInput {
  const actionType = input.allIn
    ? "ALL_IN"
    : input.action.type === "raiseTo"
    ? "RAISE_TO"
    : input.action.type === "allIn"
      ? "ALL_IN"
      : input.action.type.toUpperCase() as "FOLD" | "CHECK" | "CALL" | "BET";
  const street = input.street.toUpperCase() as CompletedActionInput["street"];
  return {
    actionType,
    amount: input.amount,
    automatic: input.automatic,
    automaticReason: input.automatic ? input.automaticReason ?? "TURN_TIMEOUT" : null,
    clientActionId: input.clientActionId,
    createdAt,
    raiseTo: actionType === "RAISE_TO" && input.action.type === "raiseTo" ? input.action.raiseTo : null,
    seatIndex: input.seatIndex,
    sequence,
    stateVersion: input.stateVersion,
    street,
    userId: input.userId,
  };
}

function mapPokerError(error: unknown): never {
  if (error instanceof PokerRuleError) {
    if (error.code === "NOT_PLAYER_TURN") {
      throw new ApiError(409, "NOT_PLAYER_TURN", "当前不是你的行动回合");
    }
    throw new ApiError(400, "ILLEGAL_ACTION", "该行动在当前状态不可用");
  }
  throw error;
}

function runoutChoiceEnabled(runtime: TableRuntime): boolean {
  return runtime.room.specialMode === "NORMAL" && (runtime.room.runItTwiceEnabled ?? false);
}

function createRunoutVote(state: HandState, now: Date): RuntimeRunoutVote | null {
  if (state.status !== "runout_choice") return null;
  const userIds = state.players.filter((player) => !player.hasFolded).sort((left, right) => left.seatIndex - right.seatIndex).map((player) => player.playerId);
  if (userIds.length !== 2) throw new ApiError(500, "PERSISTENCE_ERROR", "发两次协商参与者数量异常");
  return { choicesByUser: {}, deadlineAt: new Date(now.getTime() + 5_000), eligibleUserIds: [userIds[0]!, userIds[1]!] };
}

export function createHandController(runtime: TableRuntime, dependencies: HandControllerDependencies) {
  let authorityContinuationTask: ScheduledTask | null = null;
  let countdownTask: ScheduledTask | null = null;
  let disposed = false;
  let insufficientPlayersHeartbeatTask: ScheduledTask | null = null;
  let reviewTask: ScheduledTask | null = null;
  let roomExpiryTask: ScheduledTask | null = null;
  let timeoutTask: ScheduledTask | null = null;

  function eligibleSeats() {
    return [...runtime.seats.values()].filter(
      (seat) => seat.playStatus === "ACTIVE" && seat.stack > 0,
    );
  }

  function connectedUserIds(): ReadonlySet<string> {
    return new Set([...runtime.seats.values()].filter((seat) => runtime.isConnected(seat.userId)).map((seat) => seat.userId));
  }

  function emitStartProbe(input: {
    readonly candidateSeats?: readonly RuntimeSeat[];
    readonly failureCode?: string | null;
    readonly handId?: string | null;
    readonly outcome: HandStartProbeEvent["outcome"];
    readonly reason: HandStartGateReason | null;
    readonly type: HandStartProbeEvent["type"];
  }): void {
    if (!dependencies.onProbe) return;
    const seats = [...runtime.seats.values()];
    const connectedSeats = seats.filter((seat) => runtime.isConnected(seat.userId));
    const eligible = eligibleSeats();
    const event: HandStartProbeEvent = {
      candidateUserIds: (input.candidateSeats ?? eligible).map((seat) => seat.userId),
      connectedSeatCount: connectedSeats.length,
      connectedUserIds: connectedSeats.map((seat) => seat.userId),
      eligibleSeatCount: eligible.length,
      eligibleUserIds: eligible.map((seat) => seat.userId),
      failureCode: input.failureCode ?? null,
      handId: input.handId ?? runtime.currentHand?.state.handId ?? null,
      outcome: input.outcome,
      presenceVersion: runtime.presenceVersion,
      reason: input.reason,
      roomId: runtime.room.roomId,
      runtimeStatus: runtime.status,
      seatCount: seats.length,
      startCountdownAt: runtime.startCountdownAt?.toISOString() ?? null,
      stateVersion: runtime.stateVersion,
      type: input.type,
    };
    try {
      const pending = dependencies.onProbe(event);
      if (pending) void pending.catch(() => undefined);
    } catch {
      // Diagnostic probes must never alter authoritative table behavior.
    }
  }

  function scheduledCountdown(): boolean {
    return runtime.status === "START_COUNTDOWN" || runtime.startCountdownAt !== null;
  }

  function initialStartGateReason(seats: readonly RuntimeSeat[]): HandStartGateReason | null {
    if (seats.length < 2) return "INSUFFICIENT_ELIGIBLE_SEATS";
    if (runtime.room.status !== "OPEN") return "ROOM_NOT_OPEN";
    if (runtime.room.nextHandPaused) return "OWNER_PAUSED";
    if (runtime.status === "PERSISTENCE_ERROR") return "PERSISTENCE_ERROR";
    if (runtime.status === "RECOVERY_ERROR") return "RECOVERY_ERROR";
    if (runtime.postHandReview) return "POST_HAND_REVIEW_ACTIVE";
    if (runtime.room.requiresManualStart ?? false) return "MANUAL_START_REQUIRED";
    if (runtime.currentHand) return "HAND_ALREADY_ACTIVE";
    if (dependencies.clock.now().getTime() >= runtime.room.expiresAt.getTime()) return "ROOM_EXPIRED";
    return null;
  }

  function cancelInsufficientPlayersHeartbeat(): void {
    insufficientPlayersHeartbeatTask?.cancel();
    insufficientPlayersHeartbeatTask = null;
  }

  function shouldHeartbeatForPlayers(): boolean {
    return !disposed
      && runtime.currentHand === null
      && runtime.postHandReview === null
      && runtime.room.status === "OPEN"
      && runtime.room.tableStartedAt !== null
      && !runtime.room.nextHandPaused
      && !(runtime.room.requiresManualStart ?? false)
      && eligibleSeats().length < 2;
  }

  function scheduleInsufficientPlayersHeartbeat(): void {
    cancelInsufficientPlayersHeartbeat();
    if (!shouldHeartbeatForPlayers()) return;
    insufficientPlayersHeartbeatTask = dependencies.scheduler.schedule(
      new Date(dependencies.clock.now().getTime() + 30_000),
      async () => {
        insufficientPlayersHeartbeatTask = null;
        if (disposed) return;
        try {
          await evaluateStart();
        } catch (error: unknown) {
          await reportCommandError(error);
          if (shouldHeartbeatForPlayers()) scheduleInsufficientPlayersHeartbeat();
        }
      },
    );
  }

  function cancelAuthorityContinuation(): void {
    authorityContinuationTask?.cancel();
    authorityContinuationTask = null;
  }

  function canAutomaticallyContinue(): boolean {
    return runtime.currentHand === null
      && runtime.postHandReview === null
      && runtime.status === "IDLE"
      && runtime.room.status === "OPEN"
      && !runtime.room.nextHandPaused
      && !(runtime.room.requiresManualStart ?? false)
      && eligibleSeats().length >= 2;
  }

  function scheduleAuthorityContinuation(): void {
    cancelAuthorityContinuation();
    if (disposed || !canAutomaticallyContinue()) return;
    authorityContinuationTask = dependencies.scheduler.schedule(
      new Date(dependencies.clock.now().getTime() + 250),
      async () => {
        authorityContinuationTask = null;
        if (disposed) return;
        try {
          await runtime.queue.run(async () => {
            if (canAutomaticallyContinue()) await startNow();
          });
        } catch (error: unknown) {
          await reportCommandError(error);
        }
      },
    );
  }

  async function commitStatusChange(candidate: RuntimeAuthorityState): Promise<void> {
    const previous = captureRuntimeAuthority(runtime);
    try {
      const committed = dependencies.commitRuntimeState
        ? await dependencies.commitRuntimeState(previous, candidate)
        : candidate;
      applyRuntimeAuthority(runtime, committed);
    } catch (error: unknown) {
      await reloadAfterSnapshotConflict(error);
      throw error;
    }
  }

  function cancelCountdown(): boolean {
    const changed = countdownTask !== null || runtime.startCountdownAt !== null || (runtime.currentHand === null && runtime.status === "START_COUNTDOWN");
    countdownTask?.cancel();
    countdownTask = null;
    runtime.startCountdownAt = null;
    if (runtime.currentHand === null && runtime.status === "START_COUNTDOWN") runtime.status = "IDLE";
    return changed;
  }

  function cancelCountdownTask(): void {
    countdownTask?.cancel();
    countdownTask = null;
  }

  async function clearCountdown(nextStatus: RuntimeStatus = "IDLE"): Promise<boolean> {
    const previous = captureRuntimeAuthority(runtime);
    const changed = countdownTask !== null
      || previous.startCountdownAt !== null
      || (previous.currentHand === null && previous.status === "START_COUNTDOWN")
      || previous.status !== nextStatus;
    if (!changed) return false;
    if (dependencies.commitRuntimeState) {
      await commitStatusChange(advanceRuntimeAuthority(previous, {
        startCountdownAt: null,
        status: nextStatus,
      }));
      cancelCountdownTask();
    } else {
      cancelCountdownTask();
      runtime.startCountdownAt = null;
      runtime.status = nextStatus;
      runtime.incrementStateVersion();
    }
    return true;
  }

  function cancelTimeout(): void {
    timeoutTask?.cancel();
    timeoutTask = null;
  }

  function cancelReview(): void {
    reviewTask?.cancel();
    reviewTask = null;
  }

  function cancelRoomExpiry(): void {
    roomExpiryTask?.cancel();
    roomExpiryTask = null;
  }

  function scheduleRoomExpiry(): void {
    cancelRoomExpiry();
    if (disposed || runtime.room.status !== "OPEN" || !runtime.room.tableStartedAt || !dependencies.commitRoomExpiry) return;
    const expiresAt = runtime.room.expiresAt;
    roomExpiryTask = dependencies.scheduler.schedule(expiresAt, async () => {
      if (disposed) return;
      try {
        let expired = false;
        await runtime.queue.run(async () => {
          if (runtime.room.status !== "OPEN") return;
          if (dependencies.clock.now().getTime() < runtime.room.expiresAt.getTime()) {
            scheduleRoomExpiry();
            return;
          }
          if (dependencies.commitRoomExpiry) {
            const committed = await dependencies.commitRoomExpiry(captureRuntimeAuthority(runtime), dependencies.clock.now());
            if (!committed) return;
            applyRuntimeAuthority(runtime, committed);
          } else {
            runtime.room = { ...runtime.room, requiresManualStart: true, status: "CLOSING", tableStartedAt: null };
            runtime.startCountdownAt = null;
            runtime.status = runtime.postHandReview ? "POST_HAND_REVIEW" : "CLOSING";
            runtime.incrementStateVersion();
          }
          expired = true;
          cancelCountdownTask();
          await dependencies.onStateChanged?.();
        });
        if (expired) await dependencies.onRoomExpired?.();
      } catch (error: unknown) {
        await reportCommandError(error);
        await dependencies.onStateChanged?.();
      }
    });
  }

  function isSnapshotConflict(error: unknown): boolean {
    return error instanceof ApiError && error.code === "SNAPSHOT_CONFLICT"
      || typeof error === "object" && error !== null && "code" in error
        && (error as { readonly code?: unknown }).code === "SNAPSHOT_CONFLICT";
  }

  async function resynchronizeAuthorityInsideQueue(): Promise<void> {
    cancelAuthorityContinuation();
    cancelCountdownTask();
    cancelTimeout();
    try {
      const authoritative = await dependencies.loadAuthoritativeState?.();
      if (!authoritative) throw new Error("authoritative table snapshot is unavailable");
      applyRuntimeAuthority(runtime, authoritative);
      runtime.actionCache.clear();
      if (runtime.currentHand && ["active", "runout_choice"].includes(runtime.currentHand.state.status)) scheduleTurn();
      else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
      else if (runtime.status === "START_COUNTDOWN" && runtime.startCountdownAt) scheduleCountdown(runtime.startCountdownAt);
      else scheduleAuthorityContinuation();
      scheduleRoomExpiry();
      await dependencies.onStateChanged?.();
    } catch (error: unknown) {
      runtime.status = "RECOVERY_ERROR";
      await reportCommandError(error);
      await dependencies.onStateChanged?.();
      throw new ApiError(409, "RECOVERY_ERROR", "牌桌权威状态重新加载失败，已暂停操作");
    }
  }

  async function reloadAfterSnapshotConflict(error: unknown): Promise<boolean> {
    if (!isSnapshotConflict(error)) return false;
    await resynchronizeAuthorityInsideQueue();
    return true;
  }

  async function emitLifecycle(event: Omit<HandLifecycleEvent, "roomId" | "stateVersion">): Promise<void> {
    await dependencies.onLifecycle?.({
      ...event,
      roomId: runtime.room.roomId,
      stateVersion: runtime.stateVersion,
    });
  }

  async function emitStreetTransitions(
    events: readonly { readonly eventType: string; readonly street?: HandLifecycleEvent["street"] }[],
    handId: string,
  ): Promise<void> {
    for (const event of events) {
      if (event.eventType === "STREET_ADVANCED" && event.street) {
        await emitLifecycle({ handId, street: event.street, type: "street advanced" });
      }
    }
  }

  async function reportCommandError(error: unknown): Promise<void> {
    if (error instanceof PokerRuleError && error.code === "STATE_INVARIANT_VIOLATION") {
      await emitLifecycle({
        ...(runtime.currentHand ? { handId: runtime.currentHand.state.handId } : {}),
        type: "state invariant violation",
      });
    }
    await dependencies.onError?.(error);
  }

  async function freezePersistenceFailure(error: unknown): Promise<never> {
    cancelTimeout();
    runtime.status = "PERSISTENCE_ERROR";
    await reportCommandError(error);
    await emitLifecycle({
      ...(runtime.currentHand ? { handId: runtime.currentHand.state.handId } : {}),
      type: "hand persistence failed",
    });
    const failure = error instanceof ApiError && error.code === "PERSISTENCE_ERROR"
      ? error
      : new ApiError(500, "PERSISTENCE_ERROR", "牌桌状态持久化失败");
    await dependencies.onFatalError?.(failure);
    await dependencies.onStateChanged?.();
    throw failure;
  }

  async function finishIfNeeded(): Promise<void> {
    if (!runtime.currentHand || runtime.currentHand.state.status !== "finished") return;
    cancelTimeout();
    let persisted: PersistCompletedHandResult;
    try {
      persisted = await dependencies.persistCompletedHand(runtime);
      const seatsByUser = new Map([...runtime.seats.values()].map((seat) => [seat.userId, seat]));
      runtime.seats.clear();
      for (const seat of persisted.remainingSeats) {
        const existing = seatsByUser.get(seat.userId);
        if (!existing) continue;
        runtime.seats.set(seat.seatIndex, { ...existing, ...seat });
      }
      runtime.room = {
        ...runtime.room,
        status: persisted.roomStatus,
        squidRoundGraceEndsAt: persisted.squidRoundGraceEndsAt ?? runtime.room.squidRoundGraceEndsAt ?? null,
        squidRoundNumber: persisted.squidRoundNumber ?? runtime.room.squidRoundNumber ?? 1,
        ...(persisted.squidSettlementCompleted ? { squidSettlementPending: false } : {}),
      };
    } catch (cause: unknown) {
      runtime.status = "PERSISTENCE_ERROR";
      await reportCommandError(cause);
      await emitLifecycle({ handId: runtime.currentHand.state.handId, type: "hand persistence failed" });
      const error = new ApiError(500, "PERSISTENCE_ERROR", "牌局结算持久化失败");
      await dependencies.onFatalError?.(error);
      throw error;
    }
    const finalState = runtime.currentHand.state;
    const completedHand = { ...runtime.currentHand, turnDeadlineAt: null };
    await emitLifecycle({ handId: finalState.handId, type: "hand completed" });
    runtime.lastButtonSeat = finalState.buttonSeat;
    runtime.lastCompletedHand = completedHand;
    runtime.postHandReview = {
      endsAt: persisted.reviewEndsAt ?? new Date(dependencies.clock.now().getTime() + postHandReviewDurationMs(finalState)),
      hand: completedHand,
      voluntarilyRevealedCardIndicesByUser: {},
      voluntarilyRevealedUserIds: [],
    };
    runtime.currentHand = null;
    runtime.status = "POST_HAND_REVIEW";
    runtime.incrementStateVersion();
    schedulePostHandReview(runtime.postHandReview.endsAt);
  }

  function schedulePostHandReview(endsAt: Date, attemptAt: Date = endsAt): void {
    cancelReview();
    if (disposed) return;
    const identity = { endsAt: endsAt.getTime(), handId: runtime.postHandReview?.hand.state.handId ?? "" };
    reviewTask = dependencies.scheduler.schedule(attemptAt, async () => {
      if (disposed) return;
      try {
        await runtime.queue.run(async () => {
          const review = runtime.postHandReview;
          if (!review || review.hand.state.handId !== identity.handId || review.endsAt.getTime() !== identity.endsAt) return;
          if (dependencies.clock.now().getTime() < identity.endsAt) {
            schedulePostHandReview(review.endsAt);
            return;
          }
          if (dependencies.commitPostHandReviewEnd) {
            const committed = await dependencies.commitPostHandReviewEnd(captureRuntimeAuthority(runtime), {
              connectedUserIds: connectedUserIds(),
              endsAt: review.endsAt,
              handId: review.hand.state.handId,
              now: dependencies.clock.now(),
            });
            if (!committed) return;
            applyRuntimeAuthority(runtime, committed);
          } else {
            const eligible = eligibleSeats();
            runtime.postHandReview = null;
            if (runtime.room.status === "CLOSING") runtime.status = "CLOSING";
            else if (runtime.room.status === "CLOSED") runtime.status = "CLOSED";
            else {
              runtime.room = {
                ...runtime.room,
                requiresManualStart: runtime.room.tableStartedAt === null && eligible.length < 2,
                tableStartedAt: runtime.room.tableStartedAt ?? null,
              };
              runtime.status = runtime.room.nextHandPaused ? "PAUSED" : "IDLE";
            }
            runtime.incrementStateVersion();
          }
          const shouldContinue = runtime.room.status === "OPEN"
            && !runtime.room.nextHandPaused
            && !(runtime.room.requiresManualStart ?? false)
            && eligibleSeats().length >= 2;
          if (shouldContinue) await startNow();
          else {
            scheduleInsufficientPlayersHeartbeat();
            await dependencies.onStateChanged?.();
          }
        });
      } catch (error: unknown) {
        await reportCommandError(error);
        if (isSnapshotConflict(error)) {
          try {
            await runtime.queue.run(resynchronizeAuthorityInsideQueue);
          } catch {
            // Resynchronization already freezes and reports a safe recovery error.
          }
          return;
        }
        await dependencies.onStateChanged?.();
        const review = runtime.postHandReview;
        if (!disposed && review?.hand.state.handId === identity.handId && review.endsAt.getTime() === identity.endsAt) {
          schedulePostHandReview(review.endsAt, new Date(dependencies.clock.now().getTime() + 250));
        }
      }
    });
  }

  function scheduleTurn(): void {
    cancelTimeout();
    if (disposed) return;
    const current = runtime.currentHand;
    if (!current) return;
    if (current.state.status === "runout_choice" && current.runoutVote) {
      const vote = current.runoutVote;
      const identity = { deadline: vote.deadlineAt.getTime(), handId: current.state.handId, pokerVersion: current.state.stateVersion };
      timeoutTask = dependencies.scheduler.schedule(vote.deadlineAt, async () => {
        if (disposed) return;
        try {
          await runtime.queue.run(async () => {
            const latest = runtime.currentHand;
            if (!latest?.runoutVote
              || latest.state.handId !== identity.handId
              || latest.state.stateVersion !== identity.pokerVersion
              || latest.runoutVote.deadlineAt.getTime() !== identity.deadline) return;
            if (dependencies.clock.now().getTime() < identity.deadline) {
              scheduleTurn();
              return;
            }
            if (dependencies.commitRunoutVoteTimeout) {
              const committed = await dependencies.commitRunoutVoteTimeout(captureRuntimeAuthority(runtime), {
                connectedUserIds: connectedUserIds(),
                deadline: latest.runoutVote.deadlineAt,
                handId: identity.handId,
                now: dependencies.clock.now(),
                pokerStateVersion: identity.pokerVersion,
              });
              if (!committed) return;
              applyRuntimeAuthority(runtime, committed.state);
              await emitStreetTransitions(committed.events, identity.handId);
            } else {
              const allTwice = latest.runoutVote.eligibleUserIds.every((userId) => latest.runoutVote!.choicesByUser[userId] === "TWICE");
              const resolved = resolveRunoutChoice(latest.state, allTwice);
              assertHandStateInvariants(resolved.state, latest.state);
              latest.state = resolved.state;
              latest.runoutChoicesByUser = latest.runoutVote.choicesByUser;
              latest.runoutVote = null;
              runtime.incrementStateVersion();
              await emitStreetTransitions(resolved.events, identity.handId);
              await finishIfNeeded();
            }
            if (runtime.currentHand) scheduleTurn();
            else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
            await dependencies.onStateChanged?.();
          });
        } catch (error: unknown) {
          await reportCommandError(error);
          await dependencies.onStateChanged?.();
        }
      });
      return;
    }
    if (current.state.status !== "active" || current.state.currentActorSeat === null) return;
    const actor = current.state.players.find((player) => player.seatIndex === current.state.currentActorSeat);
    if (!actor) return;
    const actorSeat = [...runtime.seats.values()].find((seat) => seat.userId === actor.playerId);
    const autoCallMatchesCurrentBet = actorSeat?.nextActionAutopilotArmed === true
      && actorSeat.nextActionAutoCallCurrentBet !== null
      && actorSeat.nextActionAutoCallCurrentBet !== undefined
      && actorSeat.nextActionAutoCallCurrentBet === current.state.currentBet;
    const automaticReason: HandActionAutomaticReason = actorSeat?.playStatus === "LEAVE_AFTER_HAND"
      ? "LEAVE_AFTER_HAND"
      : actorSeat?.playStatus === "RESERVED_AWAY"
      ? "RESERVED_AWAY"
      : actorSeat?.trusteeshipEnabled || runtime.isDisconnectedTrustee(actor.playerId)
        ? "TRUSTEESHIP"
      : autoCallMatchesCurrentBet
        ? "NEXT_DECISION_AUTO_CALL"
        : actorSeat?.nextActionAutopilotArmed && (actorSeat.nextActionAutoCallCurrentBet ?? null) === null
        ? "NEXT_DECISION_AUTOPILOT"
        : "TURN_TIMEOUT";
    const deadline = current.turnDeadlineAt ?? new Date(dependencies.clock.now().getTime() + runtime.room.actionTimeSeconds * 1_000);
    if (!dependencies.commitTimeout) current.turnDeadlineAt = deadline;
    const identity = { actorId: actor.playerId, automaticReason, deadline: deadline.getTime(), handId: current.state.handId, pokerVersion: current.state.stateVersion };
    const scheduledAt = automaticReason === "TURN_TIMEOUT" ? deadline : dependencies.clock.now();
    timeoutTask = dependencies.scheduler.schedule(scheduledAt, async () => {
      if (disposed) return;
      let handFinished = false;
      try {
        await runtime.queue.run(async () => {
          const latest = runtime.currentHand;
          if (
            !latest
            || latest.state.handId !== identity.handId
            || latest.state.stateVersion !== identity.pokerVersion
            || latest.turnDeadlineAt?.getTime() !== identity.deadline
          ) return;
          if (identity.automaticReason === "TURN_TIMEOUT" && dependencies.clock.now().getTime() < identity.deadline) {
            scheduleTurn();
            return;
          }
          const latestActor = latest.state.players.find((player) => player.seatIndex === latest.state.currentActorSeat);
          if (latestActor?.playerId !== identity.actorId) return;
          if (dependencies.commitTimeout) {
            let committed;
            try {
              committed = await dependencies.commitTimeout(captureRuntimeAuthority(runtime), {
                actorUserId: identity.actorId,
                automaticReason: identity.automaticReason,
                connectedUserIds: connectedUserIds(),
                deadline,
                handId: identity.handId,
                now: dependencies.clock.now(),
                pokerStateVersion: identity.pokerVersion,
              });
            } catch (error: unknown) {
              if (await reloadAfterSnapshotConflict(error)) throw error;
              return freezePersistenceFailure(error);
            }
            if (!committed) {
              scheduleTurn();
              return;
            }
            const automatic = committed.result.events[0];
            applyRuntimeAuthority(runtime, committed.state);
            await emitLifecycle({
              ...(automatic && "amount" in automatic ? { amount: automatic.amount } : {}),
              handId: identity.handId,
              type: "automatic action",
              userId: identity.actorId,
            });
            await emitStreetTransitions(committed.events, identity.handId);
            handFinished = runtime.currentHand === null;
            if (runtime.currentHand) scheduleTurn();
            else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
            await dependencies.onStateChanged?.();
            return;
          }
          const legal = getLegalActions(latest.state, identity.actorId);
          const intent: PlayerIntent = identity.automaticReason === "NEXT_DECISION_AUTO_CALL" && legal.canCall
            ? { type: "call" }
            : { type: legal.canCheck ? "check" : "fold" };
          const action: PlayerAction = toCoreAction(identity.actorId, intent);
          const actingSeat = latestActor.seatIndex;
          const actingStreet = latest.state.street;
          const actionAmount = actualChipPayment(latest.state, latestActor, intent);
          const applied = applyPlayerAction(latest.state, action, { deferHeadsUpAllInRunout: runoutChoiceEnabled(runtime) });
          assertHandStateInvariants(applied.state);
          latest.state = applied.state;
          latest.runoutVote = createRunoutVote(applied.state, dependencies.clock.now());
          latest.actions.push(persistenceAction({
            action: intent,
            allIn: actionAmount !== null && actionAmount === latestActor.stack,
            amount: actionAmount,
            automatic: true,
            automaticReason: identity.automaticReason,
            clientActionId: null,
            seatIndex: actingSeat,
            stateVersion: applied.state.stateVersion,
            street: actingStreet,
            userId: identity.actorId,
          }, latest.actions.length + 1, dependencies.clock.now()));
          if (["NEXT_DECISION_AUTOPILOT", "NEXT_DECISION_AUTO_CALL"].includes(identity.automaticReason) && actorSeat) {
            runtime.seats.set(actorSeat.seatIndex, { ...actorSeat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false });
          }
          runtime.incrementStateVersion();
          await emitLifecycle({
            actionType: intent.type,
            ...(actionAmount === null ? {} : { amount: actionAmount }),
            handId: applied.state.handId,
            seatIndex: actingSeat,
            type: "automatic action",
            userId: identity.actorId,
          });
          await emitStreetTransitions(applied.events, applied.state.handId);
          await finishIfNeeded();
          handFinished = runtime.currentHand === null;
          if (runtime.currentHand) scheduleTurn();
          await dependencies.onStateChanged?.();
        });
        if (handFinished) await evaluateStart();
      } catch (error: unknown) {
        await reportCommandError(error);
        await dependencies.onStateChanged?.();
      }
    });
  }

  function scheduleCountdown(startCountdownAt: Date): void {
    cancelCountdownTask();
    const deadline = startCountdownAt.getTime();
    countdownTask = dependencies.scheduler.schedule(startCountdownAt, async () => {
      if (disposed) return;
      let handFinished = false;
      try {
        await runtime.queue.run(async () => {
          if (runtime.startCountdownAt?.getTime() !== deadline) return;
          if (dependencies.clock.now().getTime() < deadline) {
            scheduleCountdown(startCountdownAt);
            return;
          }
          await startNow();
          handFinished = runtime.currentHand === null;
        });
        if (handFinished) await evaluateStart();
      } catch (error: unknown) {
        await reportCommandError(error);
        await dependencies.onStateChanged?.();
      }
    });
  }

  async function startNow(): Promise<void> {
    cancelInsufficientPlayersHeartbeat();
    let seats: readonly RuntimeSeat[] = eligibleSeats();
    const gateReason = initialStartGateReason(seats);
    if (gateReason !== null) {
      emitStartProbe({ candidateSeats: seats, outcome: "cancelled", reason: gateReason, type: "HAND_START_GATE" });
      const nextStatus = runtime.status === "PERSISTENCE_ERROR" || runtime.status === "RECOVERY_ERROR"
        ? runtime.status
        : runtime.room.status === "CLOSED"
          ? "CLOSED"
          : runtime.room.status === "CLOSING"
            ? "CLOSING"
            : runtime.room.nextHandPaused
              ? "PAUSED"
              : "IDLE";
      await clearCountdown(nextStatus);
      return;
    }
    try {
      seats = await dependencies.prepareHandParticipants?.(seats) ?? seats;
    } catch (error: unknown) {
      const failureCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : error instanceof Error ? error.name : "UNKNOWN";
      emitStartProbe({ candidateSeats: seats, failureCode, outcome: "cancelled", reason: "PREPARE_PARTICIPANTS_FAILED", type: "HAND_START_GATE" });
      throw error;
    }
    if (seats.length < 2) {
      emitStartProbe({ candidateSeats: seats, outcome: "cancelled", reason: "PREPARED_PARTICIPANTS_BELOW_TWO", type: "HAND_START_GATE" });
      await clearCountdown();
      return;
    }
    try {
      await dependencies.assertHandCanStart?.(seats);
    } catch (error: unknown) {
      const failureCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : error instanceof Error ? error.name : "UNKNOWN";
      emitStartProbe({ candidateSeats: seats, failureCode, outcome: "cancelled", reason: "ACCOUNTING_REJECTED", type: "HAND_START_GATE" });
      await clearCountdown();
      throw error;
    }
    try {
      seats = dependencies.retainConnectedParticipants?.(seats) ?? seats;
    } catch (error: unknown) {
      const failureCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : error instanceof Error ? error.name : "UNKNOWN";
      emitStartProbe({ candidateSeats: seats, failureCode, outcome: "cancelled", reason: "RETAIN_PARTICIPANTS_FAILED", type: "HAND_START_GATE" });
      throw error;
    }
    if (seats.length < 2) {
      emitStartProbe({ candidateSeats: seats, outcome: "cancelled", reason: "AUTHENTICATED_CONNECTED_PARTICIPANTS_BELOW_TWO", type: "HAND_START_GATE" });
      await clearCountdown();
      return;
    }
    if (dependencies.commitStart) {
      let committed;
      try {
        committed = await dependencies.commitStart(captureRuntimeAuthority(runtime), {
          connectedUserIds: connectedUserIds(),
          deck: dependencies.deckProvider.nextDeck(runtime.room.specialMode === "SHORT_DECK" ? "SHORT_DECK" : "STANDARD"),
          handId: dependencies.idFactory(),
          now: dependencies.clock.now(),
          participatingSeats: seats,
        });
      } catch (error: unknown) {
        const failureCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
          ? error.code
          : error instanceof Error ? error.name : "UNKNOWN";
        emitStartProbe({ candidateSeats: seats, failureCode, outcome: "cancelled", reason: "START_COMMIT_REJECTED", type: "HAND_START_GATE" });
        if (await reloadAfterSnapshotConflict(error)) throw error;
        if (error instanceof ApiError && error.statusCode < 500) {
          await clearCountdown();
          throw error;
        }
        return freezePersistenceFailure(error);
      }
      cancelCountdownTask();
      applyRuntimeAuthority(runtime, committed.state);
      const handId = committed.state.currentHand?.state.handId ?? committed.state.lastCompletedHand?.state.handId;
      emitStartProbe({ candidateSeats: seats, handId: handId ?? null, outcome: "started", reason: null, type: "HAND_START_GATE" });
      if (handId) await emitLifecycle({ handId, type: "hand started" });
      await emitStreetTransitions(committed.events, handId ?? "");
      if (runtime.currentHand) scheduleTurn();
      else {
        const review = committed.state.postHandReview;
        if (review) schedulePostHandReview(review.endsAt);
      }
      await dependencies.onStateChanged?.();
      return;
    }
    cancelCountdown();
    if (runtime.room.squidRoundGraceEndsAt) runtime.room = { ...runtime.room, squidRoundGraceEndsAt: null };
    const fallbackNow = dependencies.clock.now();
    const bombPotResolution = runtime.room.specialMode === "BOMB_POT"
      ? resolveBombPotHandStart({
          intervalMinutes: runtime.room.bombPotIntervalMinutes!,
          nextAt: runtime.room.bombPotNextAt ?? null,
          now: fallbackNow,
          tableStartedAt: runtime.room.tableStartedAt ?? null,
        })
      : null;
    if (bombPotResolution) runtime.room = { ...runtime.room, bombPotNextAt: bombPotResolution.nextAt };
    const participatingUserIds = new Set(seats.map((seat) => seat.userId));
    runtime.handNumber += 1;
    const result = startHand({
      config: {
        bigBlind: runtime.room.bigBlind,
        maxSeats: runtime.room.maxSeats,
        smallBlind: runtime.room.smallBlind,
        variant: runtime.room.specialMode === "SHORT_DECK" ? "SHORT_DECK" : "STANDARD",
      },
      deck: dependencies.deckProvider.nextDeck(runtime.room.specialMode === "SHORT_DECK" ? "SHORT_DECK" : "STANDARD"),
      handId: dependencies.idFactory(),
      ...(bombPotResolution?.bombPot ? { bombPotBlind: bombPotBlindAmount(runtime.room.bigBlind, runtime.room.bombPotBlindMultiplier!) } : {}),
      previousButtonSeat: runtime.lastButtonSeat,
      deferHeadsUpAllInRunout: runoutChoiceEnabled(runtime),
      seats: [...runtime.seats.values()].map((seat) => ({ isParticipating: participatingUserIds.has(seat.userId), playerId: seat.userId, seatIndex: seat.seatIndex, stack: seat.stack })),
    });
    assertHandStateInvariants(result.state);
    runtime.currentHand = {
      actions: [],
      handNumber: runtime.handNumber,
      paidCardRevealCost: runtime.room.paidCardRevealCost ?? 0,
      paidCardRevealEnabled: runtime.room.paidCardRevealEnabled ?? false,
      runoutChoicesByUser: {},
      runoutVote: createRunoutVote(result.state, dependencies.clock.now()),
      startedAt: fallbackNow,
      state: result.state,
      turnDeadlineAt: null,
    };
    runtime.lastCompletedHand = null;
    runtime.status = "PLAYING";
    runtime.incrementStateVersion();
    emitStartProbe({ candidateSeats: seats, handId: result.state.handId, outcome: "started", reason: null, type: "HAND_START_GATE" });
    await emitLifecycle({ handId: result.state.handId, type: "hand started" });
    if (result.state.status === "finished") await finishIfNeeded();
    else scheduleTurn();
    await dependencies.onStateChanged?.();
  }

  async function evaluateStart(): Promise<void> {
    if (disposed) return;
    return runtime.queue.run(async () => {
        if (disposed) return;
        scheduleRoomExpiry();
        if (runtime.currentHand || runtime.postHandReview) {
          cancelInsufficientPlayersHeartbeat();
          return;
        }
        if (runtime.status === "PERSISTENCE_ERROR" || runtime.status === "RECOVERY_ERROR") {
          if (scheduledCountdown()) emitStartProbe({ outcome: "cancelled", reason: runtime.status, type: "HAND_START_GATE" });
          cancelInsufficientPlayersHeartbeat();
          return;
        }
        if (runtime.room.status === "CLOSED" || runtime.room.status === "CLOSING") {
          if (scheduledCountdown()) emitStartProbe({ outcome: "cancelled", reason: "ROOM_NOT_OPEN", type: "HAND_START_GATE" });
          cancelInsufficientPlayersHeartbeat();
          const changed = await clearCountdown(runtime.room.status);
          if (changed) await dependencies.onStateChanged?.();
          return;
        }
        if ((runtime.room.requiresManualStart ?? false) && runtime.room.tableStartedAt !== null && !runtime.room.nextHandPaused) {
          const previous = captureRuntimeAuthority(runtime);
          const candidate = advanceRuntimeAuthority(previous, { room: { ...previous.room, requiresManualStart: false } });
          if (dependencies.commitRuntimeState) await commitStatusChange(candidate);
          else applyRuntimeAuthority(runtime, candidate);
        }
        if (runtime.room.requiresManualStart ?? false) {
          if (scheduledCountdown()) emitStartProbe({ outcome: "cancelled", reason: "MANUAL_START_REQUIRED", type: "HAND_START_GATE" });
          cancelInsufficientPlayersHeartbeat();
          const changed = await clearCountdown(runtime.room.nextHandPaused ? "PAUSED" : "IDLE");
          if (changed) await dependencies.onStateChanged?.();
          return;
        }
        const currentEligibleSeats = eligibleSeats();
        if (currentEligibleSeats.length < 2 || runtime.room.nextHandPaused) {
          if (scheduledCountdown()) {
            emitStartProbe({
              candidateSeats: currentEligibleSeats,
              outcome: "cancelled",
              reason: runtime.room.nextHandPaused
                ? "OWNER_PAUSED_DURING_COUNTDOWN"
                : "INSUFFICIENT_ELIGIBLE_SEATS_DURING_COUNTDOWN",
              type: "HAND_START_GATE",
            });
          }
          if (runtime.room.nextHandPaused) cancelInsufficientPlayersHeartbeat();
          else scheduleInsufficientPlayersHeartbeat();
          const nextStatus = runtime.room.nextHandPaused ? "PAUSED" : "IDLE";
          const changed = await clearCountdown(nextStatus);
          if (changed) {
            await dependencies.onStateChanged?.();
          }
          return;
        }
        cancelInsufficientPlayersHeartbeat();
        if (runtime.status === "START_COUNTDOWN") return;
        const now = dependencies.clock.now();
        const startCountdownAt = runtime.room.specialMode === "SQUID" && runtime.room.squidRoundGraceEndsAt
          ? new Date(Math.max(now.getTime(), runtime.room.squidRoundGraceEndsAt.getTime()))
          : new Date(now.getTime() + 5_000);
        if (dependencies.commitRuntimeState) {
          const previous = captureRuntimeAuthority(runtime);
          await commitStatusChange(advanceRuntimeAuthority(previous, { startCountdownAt, status: "START_COUNTDOWN" }));
        } else {
          runtime.status = "START_COUNTDOWN";
          runtime.startCountdownAt = startCountdownAt;
          runtime.incrementStateVersion();
        }
        await emitLifecycle({ type: "start countdown" });
        emitStartProbe({ candidateSeats: currentEligibleSeats, outcome: "scheduled", reason: null, type: "HAND_START_COUNTDOWN" });
        scheduleCountdown(startCountdownAt);
        await dependencies.onStateChanged?.();
      });
  }

  return {
    dispose(): void {
      disposed = true;
      cancelAuthorityContinuation();
      cancelCountdown();
      cancelInsufficientPlayersHeartbeat();
      cancelTimeout();
      cancelReview();
      cancelRoomExpiry();
    },

    evaluateStart,

    async refreshTimers(): Promise<void> {
      if (disposed) return;
      await runtime.queue.run(async () => {
        if (runtime.currentHand && ["active", "runout_choice"].includes(runtime.currentHand.state.status)) scheduleTurn();
        else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
        else scheduleInsufficientPlayersHeartbeat();
        scheduleRoomExpiry();
      });
    },

    async resynchronizeAuthority(): Promise<void> {
      if (disposed) return;
      await runtime.queue.run(resynchronizeAuthorityInsideQueue);
    },

    async resumeRecoveredState(): Promise<void> {
      if (disposed) return;
      await runtime.queue.run(async () => {
        if (runtime.status === "START_COUNTDOWN" || runtime.startCountdownAt !== null) {
          const previous = captureRuntimeAuthority(runtime);
          const candidate = advanceRuntimeAuthority(previous, {
            startCountdownAt: null,
            status: runtime.room.status === "CLOSED"
              ? "CLOSED"
              : runtime.room.status === "CLOSING"
                ? "CLOSING"
                : runtime.room.nextHandPaused
                  ? "PAUSED"
                  : "IDLE",
          });
          await commitStatusChange(candidate);
          await dependencies.onStateChanged?.();
          return;
        }
        if (runtime.currentHand && ["active", "runout_choice"].includes(runtime.currentHand.state.status)) scheduleTurn();
        else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
        else scheduleInsufficientPlayersHeartbeat();
        scheduleRoomExpiry();
      });
    },

    async submitAction(userId: string, input: ActionSubmit): Promise<ActionCommandResult> {
      const result = await runtime.queue.run(async () => {
        const fingerprint = hashAction(input);
        const cacheKey = `${userId}:${input.clientActionId}`;
        const cached = runtime.actionCache.get(cacheKey);
        if (cached) {
          if (cached.fingerprint !== fingerprint) throw new ApiError(409, "ACTION_IDEMPOTENCY_CONFLICT", "行动 ID 已用于其他请求");
          return { ...cached.result, alreadyProcessed: true };
        }
        if (dependencies.commitPlayerAction) {
          let committed;
          try {
            committed = await dependencies.commitPlayerAction(captureRuntimeAuthority(runtime), {
              connectedUserIds: connectedUserIds(),
              input,
              now: dependencies.clock.now(),
              userId,
            });
          } catch (error: unknown) {
            if (await reloadAfterSnapshotConflict(error)) throw error;
            if (error instanceof ApiError && ["STALE_STATE", "HAND_ID_MISMATCH", "ACTION_IDEMPOTENCY_CONFLICT", "ILLEGAL_ACTION", "NOT_PLAYER_TURN", "PLAYER_NOT_SEATED", "TABLE_NOT_AVAILABLE", "SNAPSHOT_CONFLICT"].includes(error.code)) {
              throw error;
            }
            return freezePersistenceFailure(error);
          }
          if (!committed.replayed) {
            applyRuntimeAuthority(runtime, committed.state);
            rememberProcessedAction(runtime, cacheKey, { fingerprint, handId: input.handId, result: committed.result });
            await emitStreetTransitions(committed.events, input.handId);
            if (runtime.currentHand) scheduleTurn();
            else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
            await dependencies.onStateChanged?.();
          }
          return committed.result;
        }
        if (input.expectedStateVersion !== runtime.stateVersion) throw new ApiError(409, "STALE_STATE", "牌桌状态已更新");
        const current = runtime.currentHand;
        if (!current || !["PLAYING", "CLOSING"].includes(runtime.status)) throw new ApiError(409, "TABLE_NOT_AVAILABLE", "牌桌当前不可行动");
        if (current.state.handId !== input.handId) throw new ApiError(409, "HAND_ID_MISMATCH", "手牌已更新");
        if (!runtime.seats.size || ![...runtime.seats.values()].some((seat) => seat.userId === userId)) throw new ApiError(409, "PLAYER_NOT_SEATED", "你尚未入座");
        if (
          current.turnDeadlineAt
          && dependencies.clock.now().getTime() > current.turnDeadlineAt.getTime()
        ) {
          throw new ApiError(409, "STALE_STATE", "行动时间已结束，请等待服务器处理超时");
        }
        try {
          const actingPlayer = current.state.players.find((player) => player.playerId === userId)!;
          const actionAmount = actualChipPayment(current.state, actingPlayer, input.action);
          const actingStreet = current.state.street;
          const previousCurrentBet = current.state.currentBet;
          const applied = applyPlayerAction(current.state, toCoreAction(userId, input.action), { deferHeadsUpAllInRunout: runoutChoiceEnabled(runtime) });
          assertHandStateInvariants(applied.state);
          current.state = applied.state;
          current.runoutVote = createRunoutVote(applied.state, dependencies.clock.now());
          current.actions.push(persistenceAction({
            action: input.action,
            allIn: actionAmount !== null && actionAmount === actingPlayer.stack,
            amount: actionAmount,
            automatic: false,
            automaticReason: null,
            clientActionId: input.clientActionId,
            seatIndex: actingPlayer.seatIndex,
            stateVersion: applied.state.stateVersion,
            street: actingStreet,
            userId,
          }, current.actions.length + 1, dependencies.clock.now()));
          current.turnDeadlineAt = null;
          const currentBetChanged = previousCurrentBet !== applied.state.currentBet;
          for (const [seatIndex, seat] of runtime.seats) {
            const clearActingPreAction = seat.userId === userId && seat.nextActionAutopilotArmed === true;
            const clearStaleAutoCall = currentBetChanged && seat.nextActionAutoCallCurrentBet !== null && seat.nextActionAutoCallCurrentBet !== undefined;
            if (clearActingPreAction || clearStaleAutoCall) {
              runtime.seats.set(seatIndex, { ...seat, nextActionAutoCallCurrentBet: null, nextActionAutopilotArmed: false });
            }
          }
          runtime.incrementStateVersion();
          await emitStreetTransitions(applied.events, applied.state.handId);
          await finishIfNeeded();
          if (runtime.currentHand) scheduleTurn();
          const result: ActionCommandResult = {
            alreadyProcessed: false,
            events: applied.events.map(projectDomainEvent),
            stateVersion: runtime.stateVersion,
          };
          rememberProcessedAction(runtime, cacheKey, { fingerprint, handId: input.handId, result });
          await dependencies.onStateChanged?.();
          return result;
        } catch (error: unknown) {
          if (error instanceof PokerRuleError && error.code === "STATE_INVARIANT_VIOLATION") {
            await emitLifecycle({ handId: current.state.handId, type: "state invariant violation" });
          }
          if (runtime.status === "PERSISTENCE_ERROR") await dependencies.onStateChanged?.();
          mapPokerError(error);
        }
      });
      if (runtime.currentHand === null && runtime.status === "IDLE") await evaluateStart();
      return result;
    },

    async submitRunoutChoice(userId: string, input: RunoutChoiceCommand): Promise<RunoutChoiceResult> {
      return runtime.queue.run(async () => {
        if (dependencies.commitRunoutChoice) {
          const committed = await dependencies.commitRunoutChoice(captureRuntimeAuthority(runtime), {
            connectedUserIds: connectedUserIds(),
            input,
            now: dependencies.clock.now(),
            userId,
          });
          if (!committed.replayed) {
            applyRuntimeAuthority(runtime, committed.state);
            await emitStreetTransitions(committed.events, input.handId);
            if (runtime.currentHand) scheduleTurn();
            else if (runtime.postHandReview) schedulePostHandReview(runtime.postHandReview.endsAt);
            await dependencies.onStateChanged?.();
          }
          return committed.result;
        }
        if (input.expectedStateVersion !== runtime.stateVersion) throw new ApiError(409, "STALE_STATE", "牌桌状态已更新");
        const hand = runtime.currentHand;
        const vote = hand?.runoutVote;
        if (!hand || hand.state.handId !== input.handId) throw new ApiError(409, "HAND_ID_MISMATCH", "手牌已更新");
        if (!vote || hand.state.status !== "runout_choice" || !vote.eligibleUserIds.includes(userId)) {
          throw new ApiError(409, "RUNOUT_CHOICE_NOT_AVAILABLE", "当前不能选择发牌次数");
        }
        if (dependencies.clock.now().getTime() > vote.deadlineAt.getTime()) throw new ApiError(409, "STALE_STATE", "发牌选择时间已结束");
        const choicesByUser = { ...vote.choicesByUser, [userId]: input.choice };
        const allTwice = vote.eligibleUserIds.every((eligibleUserId) => choicesByUser[eligibleUserId] === "TWICE");
        hand.runoutVote = { ...vote, choicesByUser };
        hand.runoutChoicesByUser = choicesByUser;
        runtime.incrementStateVersion();
        if (allTwice) {
          const resolved = resolveRunoutChoice(hand.state, true);
          assertHandStateInvariants(resolved.state, hand.state);
          hand.state = resolved.state;
          hand.runoutVote = null;
          await emitStreetTransitions(resolved.events, input.handId);
          await finishIfNeeded();
        } else {
          scheduleTurn();
        }
        await dependencies.onStateChanged?.();
        return { alreadyProcessed: false, choice: input.choice, resolvedRunoutCount: allTwice ? 2 : null, stateVersion: runtime.stateVersion };
      });
    },
  };
}
