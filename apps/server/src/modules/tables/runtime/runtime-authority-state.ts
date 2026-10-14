import type { TableRuntime } from "./table-runtime.js";
import type { RuntimeHand, RuntimePostHandReview, RuntimeRoomConfig, RuntimeSeat, RuntimeStatus } from "./types.js";

export interface RuntimeAuthorityState {
  readonly currentHand: RuntimeHand | null;
  readonly handNumber: number;
  readonly lastButtonSeat: number | null;
  readonly lastCompletedHand: RuntimeHand | null;
  /** Undefined is accepted only for pre-Step-6.5 in-memory fixtures. */
  readonly postHandReview?: RuntimePostHandReview | null;
  readonly room: RuntimeRoomConfig;
  readonly seats: readonly RuntimeSeat[];
  readonly snapshotRevision: number;
  readonly startCountdownAt: Date | null;
  readonly stateVersion: number;
  readonly status: RuntimeStatus;
}

export function captureRuntimeAuthority(runtime: TableRuntime): RuntimeAuthorityState {
  return structuredClone({
    currentHand: runtime.currentHand,
    handNumber: runtime.handNumber,
    lastButtonSeat: runtime.lastButtonSeat,
    lastCompletedHand: runtime.lastCompletedHand,
    postHandReview: runtime.postHandReview,
    room: runtime.room,
    seats: [...runtime.seats.values()].sort((left, right) => left.seatIndex - right.seatIndex),
    snapshotRevision: runtime.snapshotRevision,
    startCountdownAt: runtime.startCountdownAt,
    stateVersion: runtime.stateVersion,
    status: runtime.status,
  });
}

export function applyRuntimeAuthority(runtime: TableRuntime, state: RuntimeAuthorityState): void {
  runtime.currentHand = state.currentHand;
  runtime.handNumber = state.handNumber;
  runtime.lastButtonSeat = state.lastButtonSeat;
  runtime.lastCompletedHand = state.lastCompletedHand;
  runtime.postHandReview = state.postHandReview ?? null;
  runtime.room = state.room;
  runtime.seats.clear();
  for (const seat of state.seats) runtime.seats.set(seat.seatIndex, seat);
  runtime.snapshotRevision = state.snapshotRevision;
  runtime.startCountdownAt = state.startCountdownAt;
  runtime.stateVersion = state.stateVersion;
  runtime.status = state.status;
}

export function advanceRuntimeAuthority(
  current: RuntimeAuthorityState,
  update: Partial<Omit<RuntimeAuthorityState, "snapshotRevision" | "stateVersion">>,
): RuntimeAuthorityState {
  return {
    ...current,
    ...structuredClone(update),
    snapshotRevision: current.snapshotRevision,
    stateVersion: current.stateVersion + 1,
  };
}
