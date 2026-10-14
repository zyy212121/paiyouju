export interface PendingDurableOperation<TIntent> {
  readonly expectedStateVersion: number;
  readonly intent: TIntent;
  readonly operationId: string;
}

export class PendingDurableOperationConflict extends Error {
  constructor() {
    super("上一个持久化操作的结果仍未确认，请重试原操作或等待牌桌状态刷新");
    this.name = "PendingDurableOperationConflict";
  }
}

/**
 * Keeps one uncertain durable command stable across a manual retry.
 * Poker actions deliberately do not use this tracker.
 */
export class DurableOperationTracker<TIntent> {
  private pending: PendingDurableOperation<TIntent> | null = null;

  acquire(
    intent: TIntent,
    expectedStateVersion: number,
    createOperationId: () => string,
  ): PendingDurableOperation<TIntent> {
    if (this.pending) {
      if (JSON.stringify(this.pending.intent) !== JSON.stringify(intent)) {
        throw new PendingDurableOperationConflict();
      }
      return this.pending;
    }
    this.pending = { expectedStateVersion, intent, operationId: createOperationId() };
    return this.pending;
  }

  clear(): void {
    this.pending = null;
  }

  clearIf(predicate: (pending: PendingDurableOperation<TIntent>) => boolean): void {
    if (this.pending && predicate(this.pending)) this.pending = null;
  }

  current(): PendingDurableOperation<TIntent> | null {
    return this.pending;
  }
}
