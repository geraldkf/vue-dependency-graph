import type { GraphMetricsSnapshot } from "./metrics";
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
  Graph,
  NodeKind,
} from "../graph/types";
import type { MutableNodeRuntimeState } from "../state/state";
import type { SchedulerState } from "../scheduling/types";
import type { NodeSubscriptionState } from "../subscriptions/types";

export type GraphDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | readonly GraphDiagnosticValue[]
  | Readonly<{ readonly [key: string]: GraphDiagnosticValue }>;

export interface GraphSerializedError {
  readonly name: string;
  readonly message: string;
  readonly cause?: GraphSerializedError;
  readonly truncated?: true;
}

export interface GraphDiagnosticNodeDefinitionSnapshot {
  readonly key: string;
  readonly kind: NodeKind;
  readonly dependencyKeys: readonly string[];
  readonly childKeys: readonly string[];
  readonly eventKeys: readonly string[];
  readonly refreshPolicyKind?: "stale-after" | "interval" | "poll-until";
}

export interface GraphDiagnosticNodeStateSnapshot {
  readonly key: string;
  readonly status: MutableNodeRuntimeState["status"];
  readonly freshness: MutableNodeRuntimeState["freshness"];
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
  readonly error: GraphSerializedError | null;
  readonly value: Readonly<{
    readonly status: "omitted" | "included" | "redacted" | "redaction-failed";
    readonly data?: GraphDiagnosticValue;
    readonly error?: GraphSerializedError;
  }>;
}

export interface GraphDiagnosticSubscriptionSnapshot {
  readonly key: string;
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

export interface GraphDiagnosticRefreshPolicySnapshot {
  readonly key: string;
  readonly kind: "stale-after" | "interval" | "poll-until";
  readonly refreshing: boolean;
  readonly terminal: boolean;
  readonly retryCount: number;
  readonly timerPurpose?: "refresh" | "retry";
  readonly timerDueAt?: number;
  readonly remainingDelayMs?: number;
}

export interface GraphDiagnosticSnapshotV1 {
  readonly schemaVersion: 1;
  readonly createdAt: number;
  readonly runtimeId: string;
  readonly topology: readonly GraphDiagnosticNodeDefinitionSnapshot[];
  readonly nodes: readonly GraphDiagnosticNodeStateSnapshot[];
  readonly scheduler: Readonly<{
    readonly isScheduled: boolean;
    readonly isRunning: boolean;
    readonly error: GraphSerializedError | null;
  }>;
  readonly subscriptions: readonly GraphDiagnosticSubscriptionSnapshot[];
  readonly refreshPolicies: readonly GraphDiagnosticRefreshPolicySnapshot[];
  readonly metrics?: GraphMetricsSnapshot;
  readonly diagnostics: Readonly<{
    readonly retainedEventCount: number;
    readonly droppedEventCount: number;
  }>;
}

export interface DiagnosticCollectorInspection {
  readonly getEvents?: () => readonly unknown[];
  readonly getMetrics?: () => GraphMetricsSnapshot;
}

export interface CreateDiagnosticSnapshotDependencies {
  readonly graph: Graph;
  readonly runtimeId: string;
  readonly now: () => number;
  readonly getMutableState: (key: string) => MutableNodeRuntimeState;
  readonly getSchedulerState: () => SchedulerState;
  readonly getSubscriptionState: (node: AnyNodeDefinition) => NodeSubscriptionState;
  readonly getRefreshPolicySnapshot: () => readonly GraphDiagnosticRefreshPolicySnapshot[];
  readonly collector?: DiagnosticCollectorInspection;
}

const deepFreeze = <TValue>(value: TValue): TValue => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
};

const toDiagnosticValue = (
  value: unknown,
  seen = new WeakSet<object>(),
): GraphDiagnosticValue | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const result: GraphDiagnosticValue[] = [];
    for (const item of value) {
      const serialised = toDiagnosticValue(item, seen);
      if (serialised === undefined) return undefined;
      result.push(serialised);
    }
    return deepFreeze(result);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const result: Record<string, GraphDiagnosticValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const serialised = toDiagnosticValue(item, seen);
    if (serialised === undefined) return undefined;
    result[key] = serialised;
  }
  return deepFreeze(result);
};

export const serialiseDiagnosticError = (
  error: Error,
  maximumCauseDepth = 3,
  seen = new WeakSet<object>(),
): GraphSerializedError => {
  if (seen.has(error) || maximumCauseDepth === 0) {
    return Object.freeze({
      name: error.name,
      message: error.message,
      truncated: true,
    });
  }
  seen.add(error);
  const cause = error.cause;
  return Object.freeze({
    name: error.name,
    message: error.message,
    ...(cause instanceof Error
      ? { cause: serialiseDiagnosticError(cause, maximumCauseDepth - 1, seen) }
      : {}),
  });
};

const createValueSnapshot = (
  node: AnyNodeDefinition,
  value: unknown,
): GraphDiagnosticNodeStateSnapshot["value"] => {
  const policy = node.diagnostics?.value ?? "omit";
  if (policy === "omit") return Object.freeze({ status: "omitted" });

  try {
    const candidate = policy === "include" ? value : policy(value as never);
    const serialised = toDiagnosticValue(candidate);
    if (serialised === undefined) {
      return Object.freeze({
        status: policy === "include" ? "omitted" : "redaction-failed",
        ...(policy === "include"
          ? {}
          : {
              error: Object.freeze({
                name: "DiagnosticValueSerializationError",
                message: "Redacted value is not safely serialisable.",
              }),
            }),
      });
    }
    return Object.freeze({
      status: policy === "include" ? "included" : "redacted",
      data: serialised,
    });
  } catch (error) {
    const normalised = error instanceof Error ? error : new Error(String(error));
    return Object.freeze({
      status: "redaction-failed",
      error: serialiseDiagnosticError(normalised),
    });
  }
};

export const createDiagnosticSnapshot = ({
  graph,
  runtimeId,
  now,
  getMutableState,
  getSchedulerState,
  getSubscriptionState,
  getRefreshPolicySnapshot,
  collector,
}: CreateDiagnosticSnapshotDependencies): GraphDiagnosticSnapshotV1 => {
  const nodes = graph.getNodes();
  const metrics = collector?.getMetrics?.();
  const retainedEventCount = collector?.getEvents?.().length ?? 0;
  const droppedEventCount = metrics?.droppedEventCount ?? 0;

  return deepFreeze({
    schemaVersion: 1,
    createdAt: now(),
    runtimeId,
    topology: nodes.map((node): GraphDiagnosticNodeDefinitionSnapshot => {
      const observableNode = node as AnyNodeDefinition & {
        readonly invalidatedBy?: readonly unknown[];
        readonly refresh?: {
          readonly kind: "stale-after" | "interval" | "poll-until";
        };
      };
      const refreshPolicyKind = observableNode.refresh?.kind;
      return {
        key: node.key,
        kind: node.kind,
        dependencyKeys: graph.getParents(node).map(parent => parent.key),
        childKeys: graph.getChildren(node).map(child => child.key),
        eventKeys: (observableNode.invalidatedBy ?? []).flatMap(item => {
          if (typeof item !== "object" || item === null) return [];
          if ("event" in item) {
            const event = item.event;
            return typeof event === "object" && event !== null &&
              "key" in event && typeof event.key === "string"
              ? [event.key]
              : [];
          }
          return "key" in item && typeof item.key === "string" ? [item.key] : [];
        }),
        ...(refreshPolicyKind === undefined ? {} : { refreshPolicyKind }),
      };
    }),
    nodes: nodes.map(node => {
      const state = getMutableState(node.key);
      return {
        key: node.key,
        status: state.status,
        freshness: state.freshness,
        generation: state.generation,
        hasSuccessfulValue: state.hasSuccessfulValue,
        error: state.error ? serialiseDiagnosticError(state.error) : null,
        value: createValueSnapshot(node, state.data),
      };
    }),
    scheduler: (() => {
      const scheduler = getSchedulerState();
      return {
        isScheduled: scheduler.isScheduled,
        isRunning: scheduler.isRunning,
        error: scheduler.error ? serialiseDiagnosticError(scheduler.error) : null,
      };
    })(),
    subscriptions: nodes.map(node => ({
      key: node.key,
      ...getSubscriptionState(node),
    })),
    refreshPolicies: [...getRefreshPolicySnapshot()],
    ...(metrics === undefined ? {} : { metrics }),
    diagnostics: {
      retainedEventCount,
      droppedEventCount,
    },
  });
};
