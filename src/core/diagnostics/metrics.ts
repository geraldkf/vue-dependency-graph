import type {
  GraphDiagnosticEvent,
  GraphDiagnosticOperationKind,
} from "./types";

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

const addDuration = (
  target: MutableDurationMetrics,
  durationMs: number | undefined,
): void => {
  if (durationMs === undefined) return;
  target.count += 1;
  target.totalMs += durationMs;
  target.maximumMs = Math.max(target.maximumMs, durationMs);
};

const snapshotDuration = (
  duration: MutableDurationMetrics,
): GraphDurationMetrics => Object.freeze({ ...duration });

const createOperationCounts = (): Record<GraphDiagnosticOperationKind, number> => ({
  execute: 0,
  prefetch: 0,
  refresh: 0,
  "query-prefetch": 0,
  "query-refresh": 0,
  scheduler: 0,
});

const getAttemptKey = (
  event: GraphDiagnosticEvent & { readonly nodeKey: string },
): string => `${event.runtimeId}:${event.operationId ?? ""}:${event.nodeKey}`;

export const createGraphMetricsReducer = (): GraphMetricsReducer => {
  let eventCount = 0;
  let operationCounts = createOperationCounts();
  let activeLoads = 0;
  let maximumActiveLoads = 0;
  let queuedLoads = 0;
  let queueWaitDuration = createDuration();
  let freshValueSkips = 0;
  let activeAttemptReuses = 0;
  let contextInvalidations = 0;
  let changedResultInvalidations = 0;
  let schedulerRequested = 0;
  let schedulerStarted = 0;
  let schedulerCompleted = 0;
  let schedulerFailed = 0;
  let policyStarted = 0;
  let policyRetries = 0;
  let policyCompleted = 0;
  let policyFailed = 0;
  let policyTimedOut = 0;
  let policyPaused = 0;
  let policyResumed = 0;
  let policyStopped = 0;
  let transactionsStarted = 0;
  let transactionsCommitted = 0;
  let transactionsRolledBack = 0;
  let transactionsConflicted = 0;
  let transactionDuration = createDuration();
  let mutationsStarted = 0;
  let mutationsSucceeded = 0;
  let mutationsRejected = 0;
  let mutationsRollbackConflicted = 0;
  let mutationsUnknown = 0;
  let mutationsReconciliationFailed = 0;
  let mutationDuration = createDuration();
  let directSubscriptions = 0;
  let requiredSubscriptions = 0;
  let nodeAttempts = new Map<string, MutableNodeAttemptMetrics>();
  let queuedAt = new Map<string, number>();
  let activeAttemptKeys = new Set<string>();

  const getNodeAttempt = (nodeKey: string): MutableNodeAttemptMetrics => {
    const existing = nodeAttempts.get(nodeKey);
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
    nodeAttempts.set(nodeKey, created);
    return created;
  };

  const record = (event: GraphDiagnosticEvent): void => {
    eventCount += 1;

    switch (event.type) {
      case "operation.execute.requested":
      case "operation.prefetch.requested":
      case "operation.refresh.requested":
      case "operation.query-prefetch.requested":
      case "operation.query-refresh.requested":
        operationCounts[event.operation] += 1;
        return;
      case "subscription.added":
        directSubscriptions += event.nodeKeys.length;
        requiredSubscriptions += event.requiredNodeKeys.length;
        return;
      case "subscription.removed":
        directSubscriptions = Math.max(0, directSubscriptions - event.nodeKeys.length);
        requiredSubscriptions = Math.max(
          0,
          requiredSubscriptions - event.requiredNodeKeys.length,
        );
        return;
      case "scheduler.requested":
        operationCounts.scheduler += 1;
        schedulerRequested += 1;
        return;
      case "scheduler.started":
        schedulerStarted += 1;
        return;
      case "scheduler.completed":
        schedulerCompleted += 1;
        return;
      case "scheduler.failed":
        schedulerFailed += 1;
        return;
      case "node.invalidated":
        if (event.reason === "context-invalidation") contextInvalidations += 1;
        else changedResultInvalidations += 1;
        return;
      case "node.execution.skipped":
        freshValueSkips += 1;
        return;
      case "node.execution.reused":
        activeAttemptReuses += 1;
        return;
      case "node.execution.blocked":
        getNodeAttempt(event.nodeKey).blocked += 1;
        return;
      case "node.load.queued":
        queuedLoads += 1;
        queuedAt.set(getAttemptKey(event), event.timestamp);
        return;
      case "node.load.started": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.started += 1;
        const key = getAttemptKey(event);
        activeAttemptKeys.add(key);
        activeLoads += 1;
        maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
        const queuedTimestamp = queuedAt.get(key);
        if (queuedTimestamp !== undefined) {
          addDuration(queueWaitDuration, event.timestamp - queuedTimestamp);
          queuedAt.delete(key);
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
          activeAttemptKeys.delete(getAttemptKey(event))
        ) {
          activeLoads = Math.max(0, activeLoads - 1);
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
          activeAttemptKeys.delete(getAttemptKey(event))
        ) {
          activeLoads = Math.max(0, activeLoads - 1);
        }
        return;
      }
      case "node.load.aborted": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.aborted += 1;
        addDuration(attempt.duration, event.durationMs);
        if (activeAttemptKeys.delete(getAttemptKey(event))) {
          activeLoads = Math.max(0, activeLoads - 1);
        }
        queuedAt.delete(getAttemptKey(event));
        return;
      }
      case "node.load.discarded": {
        const attempt = getNodeAttempt(event.nodeKey);
        attempt.discarded += 1;
        addDuration(attempt.duration, event.durationMs);
        if (activeAttemptKeys.delete(getAttemptKey(event))) {
          activeLoads = Math.max(0, activeLoads - 1);
        }
        queuedAt.delete(getAttemptKey(event));
        return;
      }
      case "refresh-policy.started":
        policyStarted += 1;
        return;
      case "refresh-policy.retry-scheduled":
        policyRetries += 1;
        return;
      case "refresh-policy.completed":
        policyCompleted += 1;
        return;
      case "refresh-policy.failed":
        policyFailed += 1;
        return;
      case "refresh-policy.timed-out":
        policyTimedOut += 1;
        return;
      case "refresh-policy.paused":
        policyPaused += 1;
        return;
      case "refresh-policy.resumed":
        policyResumed += 1;
        return;
      case "refresh-policy.stopped":
        policyStopped += 1;
        return;
      case "transaction.started":
        transactionsStarted += 1;
        return;
      case "transaction.committed":
        transactionsCommitted += 1;
        addDuration(transactionDuration, event.durationMs);
        return;
      case "transaction.rolled-back":
        transactionsRolledBack += 1;
        addDuration(transactionDuration, event.durationMs);
        return;
      case "transaction.conflicted":
        transactionsConflicted += 1;
        addDuration(transactionDuration, event.durationMs);
        return;
      case "mutation.started":
        mutationsStarted += 1;
        return;
      case "mutation.completed":
        if (!("mutationKey" in event)) return;
        addDuration(mutationDuration, event.durationMs);
        switch (event.outcome) {
          case "succeeded": mutationsSucceeded += 1; break;
          case "rejected": mutationsRejected += 1; break;
          case "rollback-conflict": mutationsRollbackConflicted += 1; break;
          case "unknown": mutationsUnknown += 1; break;
          case "reconciliation-failed": mutationsReconciliationFailed += 1; break;
        }
        return;
      default:
        return;
    }
  };

  const getSnapshot = (droppedEventCount: number): GraphMetricsSnapshot =>
    Object.freeze({
      eventCount,
      droppedEventCount,
      operationCounts: Object.freeze({ ...operationCounts }),
      nodeAttempts: Object.freeze(
        [...nodeAttempts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([nodeKey, attempt]) => Object.freeze({
            nodeKey,
            started: attempt.started,
            succeeded: attempt.succeeded,
            failed: attempt.failed,
            aborted: attempt.aborted,
            discarded: attempt.discarded,
            blocked: attempt.blocked,
            duration: snapshotDuration(attempt.duration),
          })),
      ),
      activeLoads,
      maximumActiveLoads,
      queuedLoads,
      queueWaitDuration: snapshotDuration(queueWaitDuration),
      freshValueSkips,
      activeAttemptReuses,
      invalidations: Object.freeze({
        context: contextInvalidations,
        changedResult: changedResultInvalidations,
      }),
      scheduler: Object.freeze({
        requested: schedulerRequested,
        started: schedulerStarted,
        completed: schedulerCompleted,
        failed: schedulerFailed,
      }),
      refreshPolicies: Object.freeze({
        started: policyStarted,
        retries: policyRetries,
        completed: policyCompleted,
        failed: policyFailed,
        timedOut: policyTimedOut,
        paused: policyPaused,
        resumed: policyResumed,
        stopped: policyStopped,
      }),
      transactions: Object.freeze({
        started: transactionsStarted,
        committed: transactionsCommitted,
        rolledBack: transactionsRolledBack,
        conflicted: transactionsConflicted,
        duration: snapshotDuration(transactionDuration),
      }),
      mutations: Object.freeze({
        started: mutationsStarted,
        succeeded: mutationsSucceeded,
        rejected: mutationsRejected,
        rollbackConflicted: mutationsRollbackConflicted,
        unknown: mutationsUnknown,
        reconciliationFailed: mutationsReconciliationFailed,
        duration: snapshotDuration(mutationDuration),
      }),
      subscriptions: Object.freeze({
        direct: directSubscriptions,
        required: requiredSubscriptions,
      }),
    });

  const reset = (): void => {
    eventCount = 0;
    operationCounts = createOperationCounts();
    activeLoads = 0;
    maximumActiveLoads = 0;
    queuedLoads = 0;
    queueWaitDuration = createDuration();
    freshValueSkips = 0;
    activeAttemptReuses = 0;
    contextInvalidations = 0;
    changedResultInvalidations = 0;
    schedulerRequested = 0;
    schedulerStarted = 0;
    schedulerCompleted = 0;
    schedulerFailed = 0;
    policyStarted = 0;
    policyRetries = 0;
    policyCompleted = 0;
    policyFailed = 0;
    policyTimedOut = 0;
    policyPaused = 0;
    policyResumed = 0;
    policyStopped = 0;
    transactionsStarted = 0;
    transactionsCommitted = 0;
    transactionsRolledBack = 0;
    transactionsConflicted = 0;
    transactionDuration = createDuration();
    mutationsStarted = 0;
    mutationsSucceeded = 0;
    mutationsRejected = 0;
    mutationsRollbackConflicted = 0;
    mutationsUnknown = 0;
    mutationsReconciliationFailed = 0;
    mutationDuration = createDuration();
    directSubscriptions = 0;
    requiredSubscriptions = 0;
    nodeAttempts = new Map<string, MutableNodeAttemptMetrics>();
    queuedAt = new Map<string, number>();
    activeAttemptKeys = new Set<string>();
  };

  return Object.freeze({ record, getSnapshot, reset });
};
