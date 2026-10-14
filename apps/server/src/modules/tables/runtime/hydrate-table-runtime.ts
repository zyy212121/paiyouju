import type { TableRuntime } from "./table-runtime.js";
import type { RuntimeHand, RuntimePostHandReview, RuntimeRoomConfig, RuntimeSeat, RuntimeStatus } from "./types.js";

export interface TableRuntimeHydrationSnapshot {
  readonly currentHand?: RuntimeHand | null;
  readonly handNumber: number;
  readonly lastButtonSeat: number | null;
  readonly lastCompletedHand?: RuntimeHand | null;
  readonly postHandReview?: RuntimePostHandReview | null;
  readonly room: RuntimeRoomConfig;
  readonly seats: readonly RuntimeSeat[];
  readonly snapshotRevision?: number;
  readonly startCountdownAt?: Date | null;
  readonly stateVersion?: number;
  readonly status?: RuntimeStatus;
}

export async function hydrateTableRuntime(
  runtime: TableRuntime,
  loadSnapshot: () => Promise<TableRuntimeHydrationSnapshot | null>,
): Promise<boolean> {
  return runtime.queue.run(async () => {
    if (runtime.hydrated) return true;
    const snapshot = await loadSnapshot();
    if (!snapshot) return false;

    runtime.room = snapshot.room;
    runtime.seats.clear();
    for (const seat of snapshot.seats) runtime.seats.set(seat.seatIndex, seat);
    runtime.handNumber = snapshot.handNumber;
    runtime.lastButtonSeat = snapshot.lastButtonSeat;
    runtime.lastCompletedHand = snapshot.lastCompletedHand ?? null;
    runtime.postHandReview = snapshot.postHandReview ?? null;
    runtime.currentHand = snapshot.currentHand ?? null;
    runtime.snapshotRevision = snapshot.snapshotRevision ?? 0;
    runtime.startCountdownAt = snapshot.startCountdownAt ?? null;
    runtime.stateVersion = snapshot.stateVersion ?? 0;
    runtime.status = snapshot.status ?? (snapshot.room.status === "CLOSED"
      ? "CLOSED"
      : snapshot.room.status === "CLOSING"
        ? "CLOSING"
        : snapshot.room.nextHandPaused
          ? "PAUSED"
          : "IDLE");
    runtime.hydrated = true;
    return true;
  });
}
