import type { GraphDiagnosticEvent } from "./types";
import type {
  GraphDiagnosticSnapshotV1,
  GraphDiagnosticValue,
  GraphSerializedError,
} from "./snapshot";
import type {
  GraphDurationMetrics,
  GraphMetricsSnapshot,
} from "./metrics";

export interface GraphDiagnosticExport {
  readonly snapshot: GraphDiagnosticSnapshotV1;
  readonly events: readonly GraphDiagnosticEvent[];
}

const NORMALIZED_RUNTIME_ID = "runtime";

const deepFreeze = <TValue>(value: TValue): TValue => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
};

const cloneDiagnosticValue = (
  value: GraphDiagnosticValue,
): GraphDiagnosticValue => {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneDiagnosticValue));
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneDiagnosticValue(item),
      ]),
    ));
  }
  return value;
};

const cloneError = (
  error: GraphSerializedError | null | undefined,
): GraphSerializedError | null | undefined => {
  if (error === null || error === undefined) return error;
  return Object.freeze({
    name: error.name,
    message: error.message,
    ...(error.cause === undefined ? {} : { cause: cloneError(error.cause)! }),
    ...(error.truncated === undefined ? {} : { truncated: true as const }),
  });
};

const normalizeDuration = (
  duration: GraphDurationMetrics,
): GraphDurationMetrics => Object.freeze({
  count: duration.count,
  totalMs: 0,
  maximumMs: 0,
});

const normalizeMetrics = (
  metrics: GraphMetricsSnapshot,
): GraphMetricsSnapshot => deepFreeze({
  ...metrics,
  operationCounts: { ...metrics.operationCounts },
  nodeAttempts: metrics.nodeAttempts.map(attempt => ({
    ...attempt,
    duration: normalizeDuration(attempt.duration),
  })),
  queueWaitDuration: normalizeDuration(metrics.queueWaitDuration),
  invalidations: { ...metrics.invalidations },
  scheduler: { ...metrics.scheduler },
  refreshPolicies: { ...metrics.refreshPolicies },
  transactions: {
    ...metrics.transactions,
    duration: normalizeDuration(metrics.transactions.duration),
  },
  mutations: {
    ...metrics.mutations,
    duration: normalizeDuration(metrics.mutations.duration),
  },
  subscriptions: { ...metrics.subscriptions },
});

export const normalizeDiagnosticSnapshot = (
  snapshot: GraphDiagnosticSnapshotV1,
): GraphDiagnosticSnapshotV1 => deepFreeze({
  schemaVersion: snapshot.schemaVersion,
  createdAt: 0,
  runtimeId: NORMALIZED_RUNTIME_ID,
  topology: snapshot.topology.map(node => ({
    ...node,
    dependencyKeys: [...node.dependencyKeys],
    childKeys: [...node.childKeys],
    eventKeys: [...node.eventKeys],
  })),
  nodes: snapshot.nodes.map(node => ({
    ...node,
    error: cloneError(node.error) ?? null,
    value: {
      ...node.value,
      ...(node.value.data === undefined
        ? {}
        : { data: cloneDiagnosticValue(node.value.data) }),
      ...(node.value.error === undefined
        ? {}
        : { error: cloneError(node.value.error)! }),
    },
  })),
  scheduler: {
    ...snapshot.scheduler,
    error: cloneError(snapshot.scheduler.error) ?? null,
  },
  subscriptions: snapshot.subscriptions.map(subscription => ({
    ...subscription,
  })),
  refreshPolicies: snapshot.refreshPolicies.map(policy => ({
    ...policy,
    ...(policy.timerDueAt === undefined ? {} : { timerDueAt: 0 }),
  })),
  ...(snapshot.metrics === undefined
    ? {}
    : { metrics: normalizeMetrics(snapshot.metrics) }),
  diagnostics: { ...snapshot.diagnostics },
});

interface IdentifierNormaliser {
  readonly normalize: (identifier: string | undefined) => string | undefined;
}

const createIdentifierNormaliser = (): IdentifierNormaliser => {
  const identifiers = new Map<string, string>();

  const normalize = (identifier: string | undefined): string | undefined => {
    if (identifier === undefined) return undefined;
    if (/^operation-\d+$/.test(identifier)) return identifier;
    const existing = identifiers.get(identifier);
    if (existing) return existing;
    const normalized = `operation-${identifiers.size + 1}`;
    identifiers.set(identifier, normalized);
    return normalized;
  };

  return Object.freeze({ normalize });
};

const normalizeEvent = (
  event: GraphDiagnosticEvent,
  identifiers: IdentifierNormaliser,
): GraphDiagnosticEvent => {
  const operationId = identifiers.normalize(event.operationId);
  const causeId = identifiers.normalize(event.causeId);
  const normalized = {
    ...event,
    timestamp: 0,
    runtimeId: NORMALIZED_RUNTIME_ID,
    ...(operationId === undefined ? {} : { operationId }),
    ...(causeId === undefined ? {} : { causeId }),
    ...("durationMs" in event && event.durationMs !== undefined
      ? { durationMs: 0 }
      : {}),
    ...("nodeKeys" in event ? { nodeKeys: [...event.nodeKeys] } : {}),
    ...("requiredNodeKeys" in event
      ? { requiredNodeKeys: [...event.requiredNodeKeys] }
      : {}),
    ...("affectedNodeKeys" in event && event.affectedNodeKeys !== undefined
      ? { affectedNodeKeys: [...event.affectedNodeKeys] }
      : {}),
    ...("rootNodeKeys" in event ? { rootNodeKeys: [...event.rootNodeKeys] } : {}),
    ...("blockedBy" in event && event.blockedBy !== undefined
      ? { blockedBy: [...event.blockedBy] }
      : {}),
    ...("matchedNodeKeys" in event && event.matchedNodeKeys !== undefined
      ? { matchedNodeKeys: [...event.matchedNodeKeys] }
      : {}),
    ...("conflictKeys" in event && event.conflictKeys !== undefined
      ? { conflictKeys: [...event.conflictKeys] }
      : {}),
  };
  return deepFreeze(normalized) as GraphDiagnosticEvent;
};

export const normalizeDiagnosticEvents = (
  events: readonly GraphDiagnosticEvent[],
): readonly GraphDiagnosticEvent[] => {
  const identifiers = createIdentifierNormaliser();
  return Object.freeze(events.map(event => normalizeEvent(event, identifiers)));
};

export const normalizeDiagnosticExport = (
  diagnosticExport: GraphDiagnosticExport,
): GraphDiagnosticExport => {
  const identifiers = createIdentifierNormaliser();
  return deepFreeze({
    snapshot: normalizeDiagnosticSnapshot(diagnosticExport.snapshot),
    events: diagnosticExport.events.map(event => normalizeEvent(event, identifiers)),
  });
};
