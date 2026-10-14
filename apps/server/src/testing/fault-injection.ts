export const TABLE_FAULT_POINTS = [
  "afterSettlementCommitBeforeRuntimeUpdate",
  "afterSettlementCommitBeforeBroadcast",
  "afterSnapshotCommitBeforeRuntimeUpdate",
  "afterActionCommitBeforeBroadcast",
  "beforeActionReceiptCommit",
  "beforeSettlementCommit",
  "beforeSnapshotCommit",
] as const;

export type TableFaultPoint = typeof TABLE_FAULT_POINTS[number];

export type TableFaultTransition = "action" | "runtime" | "start" | "timeout";

export interface TableFaultContext {
  readonly snapshotRevision?: number;
  readonly stateVersion?: number;
  readonly transition: TableFaultTransition;
}

export interface TableFaultInjector {
  hit(point: TableFaultPoint, context: TableFaultContext): void | Promise<void>;
}

export function assertFaultInjectionAllowed(
  nodeEnvironment: "development" | "test" | "production",
  injector: TableFaultInjector | undefined,
): void {
  if (injector && nodeEnvironment !== "test") {
    throw new Error("table fault injection is allowed only when NODE_ENV=test");
  }
}
