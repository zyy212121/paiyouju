import { SerializedQueue } from "./serialized-queue.js";
import type { ProcessedAction, RuntimeHand, RuntimePostHandReview, RuntimeRoomConfig, RuntimeSeat, RuntimeStatus } from "./types.js";

export class TableRuntime {
  readonly actionCache = new Map<string, ProcessedAction>();
  currentHand: RuntimeHand | null = null;
  handNumber = 0;
  hydrated = false;
  lastButtonSeat: number | null = null;
  lastCompletedHand: RuntimeHand | null = null;
  presenceVersion = 0;
  postHandReview: RuntimePostHandReview | null = null;
  readonly queue = new SerializedQueue();
  readonly seats = new Map<number, RuntimeSeat>();
  snapshotRevision = 0;
  startCountdownAt: Date | null = null;
  stateVersion = 0;
  status: RuntimeStatus = "IDLE";

  private readonly disconnectedTrusteeship = new Set<string>();
  private readonly presence = new Map<string, Set<string>>();

  constructor(public room: RuntimeRoomConfig) {}

  addPresence(userId: string, socketId: string): void {
    this.disconnectedTrusteeship.delete(userId);
    const sockets = this.presence.get(userId) ?? new Set<string>();
    const before = sockets.size;
    sockets.add(socketId);
    this.presence.set(userId, sockets);
    if (sockets.size !== before) this.presenceVersion += 1;
  }

  incrementStateVersion(): number {
    this.stateVersion += 1;
    return this.stateVersion;
  }

  markPresentationChanged(): void {
    this.presenceVersion += 1;
  }

  isConnected(userId: string): boolean {
    return (this.presence.get(userId)?.size ?? 0) > 0;
  }

  isDisconnectedTrustee(userId: string): boolean {
    return this.disconnectedTrusteeship.has(userId);
  }

  presenceEntries(): ReadonlyArray<readonly [string, boolean]> {
    return [...this.presence.keys()].map((userId) => [userId, this.isConnected(userId)] as const);
  }

  removePresence(userId: string, socketId: string): void {
    const sockets = this.presence.get(userId);
    if (!sockets?.delete(socketId)) return;
    this.presenceVersion += 1;
    if (sockets.size === 0) {
      this.presence.delete(userId);
      this.disconnectedTrusteeship.add(userId);
    }
  }

  hasPresence(): boolean {
    return this.presence.size > 0;
  }

  hasTransientTimer(): boolean {
    return this.startCountdownAt !== null
      || this.postHandReview !== null
      || (this.currentHand !== null && (this.currentHand.turnDeadlineAt !== null || this.currentHand.runoutVote != null));
  }

  clearTransientState(): void {
    this.actionCache.clear();
    this.disconnectedTrusteeship.clear();
    this.presence.clear();
  }
}
