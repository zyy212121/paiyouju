import { TableRuntime } from "./table-runtime.js";
import type { RuntimeRoomConfig } from "./types.js";

export class TableRuntimeManager {
  private readonly listeners = new Set<(roomId: string) => void | Promise<void>>();
  private readonly runtimes = new Map<string, TableRuntime>();

  get size(): number {
    return this.runtimes.size;
  }

  cleanup(roomId: string): boolean {
    const runtime = this.runtimes.get(roomId);
    if (
      !runtime
      || runtime.status !== "CLOSED"
      || runtime.currentHand !== null
      || runtime.seats.size > 0
      || runtime.hasTransientTimer()
      || runtime.hasPresence()
    ) return false;
    runtime.clearTransientState();
    return this.runtimes.delete(roomId);
  }

  entries(): ReadonlyArray<readonly [string, TableRuntime]> {
    return [...this.runtimes.entries()];
  }

  evictEligible(): readonly string[] {
    const evicted: string[] = [];
    for (const [roomId, runtime] of this.runtimes) {
      const emptyOpen = runtime.room.status === "OPEN"
        && runtime.currentHand === null
        && runtime.seats.size === 0
        && runtime.startCountdownAt === null
        && !runtime.hasTransientTimer()
        && runtime.status !== "PERSISTENCE_ERROR"
        && runtime.status !== "RECOVERY_ERROR"
        && !runtime.hasPresence();
      if (emptyOpen) {
        runtime.clearTransientState();
        this.runtimes.delete(roomId);
        evicted.push(roomId);
      } else if (this.cleanup(roomId)) evicted.push(roomId);
    }
    return evicted;
  }

  close(): void {
    for (const runtime of this.runtimes.values()) runtime.clearTransientState();
    this.runtimes.clear();
    this.listeners.clear();
  }

  async whenIdle(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.queue.whenIdle()));
  }

  get(roomId: string): TableRuntime | undefined {
    return this.runtimes.get(roomId);
  }

  removeClosed(roomId: string): boolean {
    const runtime = this.runtimes.get(roomId);
    if (!runtime) return true;
    if (runtime.status !== "CLOSED" || runtime.currentHand !== null || runtime.seats.size > 0) return false;
    runtime.clearTransientState();
    return this.runtimes.delete(roomId);
  }

  async notify(roomId: string): Promise<void> {
    await Promise.all([...this.listeners].map(async (listener) => listener(roomId)));
  }

  onChange(listener: (roomId: string) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getOrCreate(room: RuntimeRoomConfig): Promise<TableRuntime> {
    const existing = this.runtimes.get(room.roomId);
    if (existing) return existing;
    const created = new TableRuntime(room);
    const raced = this.runtimes.get(room.roomId);
    if (raced) return raced;
    this.runtimes.set(room.roomId, created);
    return created;
  }
}
