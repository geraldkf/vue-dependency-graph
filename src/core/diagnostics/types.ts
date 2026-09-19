export type GraphDiagnosticEventType =
  | "runtime.created"
  | "operation.execute.requested"
  | "operation.prefetch.requested"
  | "operation.refresh.requested"
  | "operation.query-prefetch.requested"
  | "operation.query-refresh.requested"
  | "subscription.added"
  | "subscription.removed"
  | "scheduler.requested"
  | "scheduler.started"
  | "scheduler.completed"
  | "scheduler.failed"
  | "context.changed"
  | "node.invalidated"
  | "node.execution.skipped"
  | "node.execution.reused"
  | "node.execution.blocked"
  | "node.load.queued"
  | "node.load.started"
  | "node.load.succeeded"
  | "node.load.failed"
  | "node.load.aborted"
  | "node.load.discarded"
  | "node.derive.started"
  | "node.derive.succeeded"
  | "node.derive.failed"
  | "event.published"
  | "event.matched"
  | "transaction.started"
  | "transaction.committed"
  | "transaction.rolled-back"
  | "transaction.conflicted"
  | "refresh-policy.scheduled"
  | "refresh-policy.started"
  | "refresh-policy.retry-scheduled"
  | "refresh-policy.paused"
  | "refresh-policy.resumed"
  | "refresh-policy.completed"
  | "refresh-policy.failed"
  | "refresh-policy.timed-out"
  | "refresh-policy.stopped"
  | "node.value-released"
  | "mutation.started"
  | "mutation.optimistic-committed"
  | "mutation.remote-started"
  | "mutation.remote-succeeded"
  | "mutation.remote-failed"
  | "mutation.success-committed"
  | "mutation.rolled-back"
  | "mutation.rollback-conflicted"
  | "mutation.outcome-unknown"
  | "mutation.reconciliation-failed"
  | "mutation.completed";

export interface GraphDiagnosticEventBase {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly timestamp: number;
  readonly runtimeId: string;
  readonly type: GraphDiagnosticEventType;
  readonly operationId?: string;
  readonly causeId?: string;
}

export type GraphDiagnosticOperationKind =
  | "execute"
  | "prefetch"
  | "refresh"
  | "query-prefetch"
  | "query-refresh"
  | "scheduler";

export type GraphExecutionReason =
  | "explicit"
  | "subscription"
  | "prefetch"
  | "refresh"
  | "query-prefetch"
  | "query-refresh"
  | "context-invalidation"
  | "changed-result"
  | "refresh-policy"
  | "dependency";

export interface GraphDiagnosticError {
  readonly name: string;
  readonly message: string;
}

export interface GraphRuntimeCreatedDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type: "runtime.created";
  readonly nodeKeys: readonly string[];
}

export interface GraphOperationRequestedDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type:
    | "operation.execute.requested"
    | "operation.prefetch.requested"
    | "operation.refresh.requested"
    | "operation.query-prefetch.requested"
    | "operation.query-refresh.requested";
  readonly operationId: string;
  readonly operation: Exclude<GraphDiagnosticOperationKind, "scheduler">;
  readonly nodeKeys: readonly string[];
  readonly queryKey?: string;
}

export interface GraphSubscriptionDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type: "subscription.added" | "subscription.removed";
  readonly operationId: string;
  readonly nodeKeys: readonly string[];
  readonly requiredNodeKeys: readonly string[];
}

export interface GraphSchedulerDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type:
    | "scheduler.requested"
    | "scheduler.started"
    | "scheduler.completed"
    | "scheduler.failed";
  readonly operationId: string;
  readonly reason: GraphExecutionReason;
  readonly nodeKeys: readonly string[];
  readonly error?: GraphDiagnosticError;
}

export interface GraphContextChangedDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type: "context.changed";
  readonly operationId: string;
  readonly contextKeys: readonly string[];
  readonly affectedNodeKeys: readonly string[];
}

export interface GraphNodeInvalidatedDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type: "node.invalidated";
  readonly operationId: string;
  readonly reason: "context-invalidation" | "changed-result";
  readonly rootNodeKeys: readonly string[];
  readonly affectedNodeKeys: readonly string[];
  readonly scheduled: boolean;
}

export interface GraphNodeExecutionDiagnosticEvent
  extends GraphDiagnosticEventBase {
  readonly type:
    | "node.execution.skipped"
    | "node.execution.reused"
    | "node.execution.blocked"
    | "node.load.queued"
    | "node.load.started"
    | "node.load.succeeded"
    | "node.load.failed"
    | "node.load.aborted"
    | "node.load.discarded"
    | "node.derive.started"
    | "node.derive.succeeded"
    | "node.derive.failed";
  readonly operationId: string;
  readonly nodeKey: string;
  readonly nodeKind: "context" | "data" | "derived";
  readonly generation: number;
  readonly origin: "explicit" | "scheduler" | "prefetch" | "refresh" | "refresh-policy";
  readonly reason: GraphExecutionReason;
  readonly durationMs?: number;
  readonly blockedBy?: readonly string[];
  readonly error?: GraphDiagnosticError;
}


export interface GraphEventDiagnosticEvent extends GraphDiagnosticEventBase {
  readonly type: "event.published" | "event.matched";
  readonly operationId: string;
  readonly eventKey: string;
  readonly transactionOwned: boolean;
  readonly matchedNodeKeys?: readonly string[];
}

export interface GraphTransactionDiagnosticEvent extends GraphDiagnosticEventBase {
  readonly type:
    | "transaction.started"
    | "transaction.committed"
    | "transaction.rolled-back"
    | "transaction.conflicted";
  readonly operationId: string;
  readonly contextKeys?: readonly string[];
  readonly publicationCount?: number;
  readonly affectedNodeKeys?: readonly string[];
  readonly conflictKeys?: readonly string[];
  readonly durationMs?: number;
  readonly error?: GraphDiagnosticError;
}

export interface GraphRefreshPolicyDiagnosticEvent extends GraphDiagnosticEventBase {
  readonly type:
    | "refresh-policy.scheduled"
    | "refresh-policy.started"
    | "refresh-policy.retry-scheduled"
    | "refresh-policy.paused"
    | "refresh-policy.resumed"
    | "refresh-policy.completed"
    | "refresh-policy.failed"
    | "refresh-policy.timed-out"
    | "refresh-policy.stopped";
  readonly operationId: string;
  readonly nodeKey?: string;
  readonly policyKind?: "stale-after" | "interval" | "poll-until";
  readonly attempt?: number;
  readonly delayMs?: number;
  readonly reason?: string;
  readonly error?: GraphDiagnosticError;
}

export interface GraphNodeValueReleasedDiagnosticEvent extends GraphDiagnosticEventBase {
  readonly type: "node.value-released";
  readonly operationId: string;
  readonly nodeKey: string;
  readonly idleMs: number;
}

export interface GraphMutationDiagnosticEvent extends GraphDiagnosticEventBase {
  readonly type:
    | "mutation.started"
    | "mutation.optimistic-committed"
    | "mutation.remote-started"
    | "mutation.remote-succeeded"
    | "mutation.remote-failed"
    | "mutation.success-committed"
    | "mutation.rolled-back"
    | "mutation.rollback-conflicted"
    | "mutation.outcome-unknown"
    | "mutation.reconciliation-failed"
    | "mutation.completed";
  readonly operationId: string;
  readonly mutationKey: string;
  readonly affectedNodeKeys?: readonly string[];
  readonly outcome?: "succeeded" | "rejected" | "rollback-conflict" | "unknown" | "reconciliation-failed";
  readonly durationMs?: number;
  readonly error?: GraphDiagnosticError;
}

export type GraphDiagnosticEvent =
  | GraphRuntimeCreatedDiagnosticEvent
  | GraphOperationRequestedDiagnosticEvent
  | GraphSubscriptionDiagnosticEvent
  | GraphSchedulerDiagnosticEvent
  | GraphContextChangedDiagnosticEvent
  | GraphNodeInvalidatedDiagnosticEvent
  | GraphNodeExecutionDiagnosticEvent
  | GraphEventDiagnosticEvent
  | GraphTransactionDiagnosticEvent
  | GraphRefreshPolicyDiagnosticEvent
  | GraphNodeValueReleasedDiagnosticEvent
  | GraphMutationDiagnosticEvent;

export interface GraphDiagnosticSink {
  readonly emit: (event: GraphDiagnosticEvent) => void;
}

export interface GraphDiagnosticsEnvironment {
  readonly now: () => number;
  readonly createRuntimeId: () => string;
}

export interface GraphDiagnosticsOptions {
  readonly sink?: GraphDiagnosticSink;
  readonly environment?: GraphDiagnosticsEnvironment;
}
