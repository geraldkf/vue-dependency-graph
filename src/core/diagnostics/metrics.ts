import type { GraphDiagnosticEvent, GraphDiagnosticOperationKind } from "./types";

export interface GraphDurationMetrics {
  readonly count: number;
  readonly totalMs: number;
  readonly maximumMs: number;
}

export interface GraphNodeAttemptMetrics {
  readonly nodeKey: string;
  readonly started: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly aborted: number;
  readonly discarded: number;
  readonly blocked: number;
  readonly duration: GraphDurationMetrics;
}

export interface GraphMetricsSnapshot {
  readonly eventCount: number;
  readonly droppedEventCount: number;
  readonly operationCounts: Readonly<Record<GraphDiagnosticOperationKind, number>>;
  readonly nodeAttempts: readonly GraphNodeAttemptMetrics[];
  readonly activeLoads: number;
  readonly maximumActiveLoads: number;
  readonly queuedLoads: number;
  readonly queueWaitDuration: GraphDurationMetrics;
  readonly freshValueSkips: number;
  readonly activeAttemptReuses: number;
  readonly invalidations: Readonly<{
    context: number;
    changedResult: number;
  }>;
  readonly scheduler: Readonly<{
    requested: number;
    started: number;
    completed: number;
    failed: number;
  }>;
  readonly refreshPolicies: Readonly<{
    started: number;
    retries: number;
    completed: number;
    failed: number;
    timedOut: number;
    paused: number;
    resumed: number;
    stopped: number;
  }>;
  readonly transactions: Readonly<{
    started: number;
    committed: number;
    rolledBack: number;
    conflicted: number;
    duration: GraphDurationMetrics;
  }>;
  readonly mutations: Readonly<{
    started: number;
    succeeded: number;
    rejected: number;
    rollbackConflicted: number;
    unknown: number;
    reconciliationFailed: number;
    duration: GraphDurationMetrics;
  }>;
  readonly subscriptions: Readonly<{
    direct: number;
    required: number;
  }>;
}

interface MutableDurationMetrics {
  count: number;
  totalMs: number;
  maximumMs: number;
}

interface MutableNodeAttemptMetrics {
  started: number;
  succeeded: number;
  failed: number;
  aborted: number;
  discarded: number;
  blocked: number;
  duration: MutableDurationMetrics;
}

export interface GraphMetricsReducer {
  readonly record: (event: GraphDiagnosticEvent) => void;
  readonly getSnapshot: (droppedEventCount: number) => GraphMetricsSnapshot;
  readonly reset: () => void;
}

const createDuration = (): MutableDurationMetrics => ({
  count: 0,
  totalMs: 0,
  maximumMs: 0,
});

const addDuration = (target: MutableDurationMetrics, durationMs: number | undefined): void => {
  if (durationMs === undefined) return;
  target.count += 1;
  target.totalMs += durationMs;
  target.maximumMs = Math.max(target.maximumMs, durationMs);
};

const snapshotDuration = (duration: MutableDurationMetrics): GraphDurationMetrics =>
  Object.freeze({ ...duration });

const createOperationCounts = (): Record<GraphDiagnosticOperationKind, number> => ({
  execute: 0,
  prefetch: 0,
  refresh: 0,
  "query-prefetch": 0,
  "query-refresh": 0,
  scheduler: 0,
});

const getAttemptKey = (event: GraphDiagnosticEvent & { readonly nodeKey: string }): string =>
  `${event.runtimeId}:${event.operationId ?? ""}:${event.nodeKey}`;

/** One initialization path serves construction and reset, checked against the public snapshot. */
const createMetricsState = () =>
  ({
    eventCount: 0,
    operationCounts: createOperationCounts(),
    activeLoads: 0,
    maximumActiveLoads: 0,
    queuedLoads: 0,
    queueWaitDuration: createDuration(),
    freshValueSkips: 0,
    activeAttemptReuses: 0,
    invalidations: { context: 0, changedResult: 0 },
    scheduler: { requested: 0, started: 0, completed: 0, failed: 0 },
    refreshPolicies: {
      started: 0,
      retries: 0,
      completed: 0,
      failed: 0,
      timedOut: 0,
      paused: 0,
      resumed: 0,
      stopped: 0,
    },
    transactions: {
      started: 0,
      committed: 0,
      rolledBack: 0,
      conflicted: 0,
      duration: createDuration(),
    },
    mutations: {
      started: 0,
      succeeded: 0,
      rejected: 0,
      rollbackConflicted: 0,
      unknown: 0,
      reconciliationFailed: 0,
      duration: createDuration(),
    },
    subscriptions: { direct: 0, required: 0 },
    nodeAttempts: new Map<string, MutableNodeAttemptMetrics>(),
    queuedAt: new Map<string, number>(),
    activeAttemptKeys: new Set<string>(),
  }) satisfies Omit<GraphMetricsSnapshot, "droppedEventCount" | "nodeAttempts"> & {
    nodeAttempts: Map<string, MutableNodeAttemptMetrics>;
    queuedAt: Map<string, number>;
    activeAttemptKeys: Set<string>;
  };

export const createGraphMetricsReducer = (): GraphMetricsReducer => {
  let state = createMetricsState();

  const getNodeAttempt = (nodeKey: string): MutableNodeAttemptMetrics => {
    const existing = state.nodeAttempts.get(nodeKey);
    if (existing) return existing;
    const created: MutableNodeAttemptMetrics = {
      started: 0,
      succeeded: 0,
      failed: 0,
      aborted: 0,
      discarded: 0,
      blocked: 0,
      duration: createDuration(),
    };
    state.nodeAttempts.set(nodeKey, created);
    return created;
  };

  const record = (event: GraphDiagnosticEvent): void => {
    state.eventCount += 1;

    switch (event.type) {
      case "operation.execute.requested":
      case "operation.prefetch.requested":
      case "operation.refresh.requested":
      case "operation.query-prefetch.requested":
      case "operation.query-refresh.requested":
        state.operationCounts[event.operation] += 1;
        return;
      case "subscription.added":
        state.subscriptions.direct += event.nodeKeys.length;
        state.subscriptions.required += event.requiredNodeKeys.length;
        return;
      case "subscription.removed":
        state.subscriptions.direct = Math.max(
          0,
          state.subscriptions.direct - event.nodeKeys.length,
        );
        state.subscriptions.required = Math.max(
          0,
          state.subscriptions.required - event.requiredNodeKeys.length,
        );
        return;
      case "scheduler.requested":
        state.operationCounts.scheduler += 1;
        state.scheduler.requested += 1;
        return;
      case "scheduler.started":
        state.scheduler.started += 1;
        return;
      case "scheduler.completed":
        state.scheduler.completed += 1;
        return;
      case "scheduler.failed":
        state.scheduler.failed += 1;
        return;
      case "node.invalidated":
        if (event.reason === "context-invalidation") state.invalidations.context += 1;
        else state.invalidations.changedResult += 1;
        return;
      case "node.execution.skipped":
        state.freshValueSkips += 1;
        return;
      case "node.execution.reused":
        state.activeAttemptReuses += 1;
        return;
      case "node.execution.blocked":
        getNodeAttempt(event.nodeKey).blocked += 1;
        return;
      case "node.load.queued":
        state.queuedLoads += 1;
        state.queuedAt.set(getAttemptKey(event), event.timestamp);
        return;
      case "node.load.started": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.started += 1;
        const key = getAttemptKey(event);
        state.activeAttemptKeys.add(key);
        state.activeLoads += 1;
        state.maximumActiveLoads = Math.max(state.maximumActiveLoads, state.activeLoads);
        const queuedTimestamp = state.queuedAt.get(key);
        if (queuedTimestamp !== undefined) {
          addDuration(state.queueWaitDuration, event.timestamp - queuedTimestamp);
          state.queuedAt.delete(key);
        }
        return;
      }
      case "node.derive.started":
        getNodeAttempt(event.nodeKey).started += 1;
        return;
      case "node.load.succeeded":
      case "node.derive.succeeded": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.succeeded += 1;
        addDuration(attempt.duration, event.durationMs);
        if (
          event.type === "node.load.succeeded" &&
          state.activeAttemptKeys.delete(getAttemptKey(event))
        ) {
          state.activeLoads = Math.max(0, state.activeLoads - 1);
        }
        return;
      }
      case "node.load.failed":
      case "node.derive.failed": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.failed += 1;
        addDuration(attempt.duration, event.durationMs);
        if (
          event.type === "node.load.failed" &&
          state.activeAttemptKeys.delete(getAttemptKey(event))
        ) {
          state.activeLoads = Math.max(0, state.activeLoads - 1);
        }
        return;
      }
      case "node.load.aborted": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.aborted += 1;
        addDuration(attempt.duration, event.durationMs);
        if (state.activeAttemptKeys.delete(getAttemptKey(event))) {
          state.activeLoads = Math.max(0, state.activeLoads - 1);
        }
        state.queuedAt.delete(getAttemptKey(event));
        return;
      }
      case "node.load.discarded": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.discarded += 1;
        addDuration(attempt.duration, event.durationMs);
        if (state.activeAttemptKeys.delete(getAttemptKey(event))) {
          state.activeLoads = Math.max(0, state.activeLoads - 1);
        }
        state.queuedAt.delete(getAttemptKey(event));
        return;
      }
      case "refresh-policy.started":
        state.refreshPolicies.started += 1;
        return;
      case "refresh-policy.retry-scheduled":
        state.refreshPolicies.retries += 1;
        return;
      case "refresh-policy.completed":
        state.refreshPolicies.completed += 1;
        return;
      case "refresh-policy.failed":
        state.refreshPolicies.failed += 1;
        return;
      case "refresh-policy.timed-out":
        state.refreshPolicies.timedOut += 1;
        return;
      case "refresh-policy.paused":
        state.refreshPolicies.paused += 1;
        return;
      case "refresh-policy.resumed":
        state.refreshPolicies.resumed += 1;
        return;
      case "refresh-policy.stopped":
        state.refreshPolicies.stopped += 1;
        return;
      case "transaction.started":
        state.transactions.started += 1;
        return;
      case "transaction.committed":
        state.transactions.committed += 1;
        addDuration(state.transactions.duration, event.durationMs);
        return;
      case "transaction.rolled-back":
        state.transactions.rolledBack += 1;
        addDuration(state.transactions.duration, event.durationMs);
        return;
      case "transaction.conflicted":
        state.transactions.conflicted += 1;
        addDuration(state.transactions.duration, event.durationMs);
        return;
      case "mutation.started":
        state.mutations.started += 1;
        return;
      case "mutation.completed":
        if (!("mutationKey" in event)) return;
        addDuration(state.mutations.duration, event.durationMs);
        switch (event.outcome) {
          case "succeeded":
            state.mutations.succeeded += 1;
            break;
          case "rejected":
            state.mutations.rejected += 1;
            break;
          case "rollback-conflict":
            state.mutations.rollbackConflicted += 1;
            break;
          case "unknown":
            state.mutations.unknown += 1;
            break;
          case "reconciliation-failed":
            state.mutations.reconciliationFailed += 1;
            break;
        }
        return;
      default:
        return;
    }
  };

  const getSnapshot = (droppedEventCount: number): GraphMetricsSnapshot => {
    const {
      nodeAttempts,
      queuedAt: _queuedAt,
      activeAttemptKeys: _activeAttemptKeys,
      ...counters
    } = state;
    return Object.freeze({
      ...counters,
      droppedEventCount,
      operationCounts: Object.freeze({ ...state.operationCounts }),
      nodeAttempts: Object.freeze(
        [...nodeAttempts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([nodeKey, attempt]) =>
            Object.freeze({ nodeKey, ...attempt, duration: snapshotDuration(attempt.duration) }),
          ),
      ),
      queueWaitDuration: snapshotDuration(state.queueWaitDuration),
      invalidations: Object.freeze({ ...state.invalidations }),
      scheduler: Object.freeze({ ...state.scheduler }),
      refreshPolicies: Object.freeze({ ...state.refreshPolicies }),
      transactions: Object.freeze({
        ...state.transactions,
        duration: snapshotDuration(state.transactions.duration),
      }),
      mutations: Object.freeze({
        ...state.mutations,
        duration: snapshotDuration(state.mutations.duration),
      }),
      subscriptions: Object.freeze({ ...state.subscriptions }),
    });
  };

  const reset = (): void => {
    state = createMetricsState();
  };

  return Object.freeze({ record, getSnapshot, reset });
};
