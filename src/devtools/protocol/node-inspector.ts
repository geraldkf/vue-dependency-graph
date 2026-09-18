import type { GraphDiagnosticSnapshotV1, GraphDurationMetrics } from "../../core";
import type { InspectorNodeDependency, InspectorNodeDetail } from "./types";

const meanOf = (duration: GraphDurationMetrics): number | null =>
  duration.count === 0 ? null : duration.totalMs / duration.count;

/**
 * Builds the full detail view for one node. Returns `undefined` if the key
 * doesn't exist in this snapshot's topology, rather than throwing - the
 * selected node in a live devtools panel can legitimately disappear
 * between snapshots (unlikely for a node, since the graph is immutable
 * after creation, but the same function is reused for offline snapshot
 * viewing where a stale selection from a previous session is a real
 * case to handle gracefully).
 */
export const computeNodeDetail = (
  snapshot: GraphDiagnosticSnapshotV1,
  nodeKey: string
): InspectorNodeDetail | undefined => {
  const topologyNode = snapshot.topology.find(node => node.key === nodeKey);
  if (!topologyNode) return undefined;

  const stateByKey = new Map(snapshot.nodes.map(state => [state.key, state]));
  const state = stateByKey.get(nodeKey);

  const toDependency = (key: string): InspectorNodeDependency => ({
    key,
    status: stateByKey.get(key)?.status ?? "idle",
  });

  const subscription = snapshot.subscriptions.find(
    entry => entry.key === nodeKey
  );
  const refreshPolicy = snapshot.refreshPolicies.find(
    policy => policy.key === nodeKey
  );
  const attempt = snapshot.metrics?.nodeAttempts.find(
    entry => entry.nodeKey === nodeKey
  );

  return {
    key: nodeKey,
    kind: topologyNode.kind,
    status: state?.status ?? "idle",
    freshness: state?.freshness ?? "stale",
    generation: state?.generation ?? 0,
    hasSuccessfulValue: state?.hasSuccessfulValue ?? false,
    value: state?.value ?? { status: "omitted" },
    error: state?.error ?? null,
    dependencies: topologyNode.dependencyKeys.map(toDependency),
    descendants: topologyNode.childKeys.map(toDependency),
    invalidatedByEvents: topologyNode.eventKeys,
    subscribers: {
      direct: subscription?.direct ?? 0,
      required: subscription?.required ?? 0,
      total: subscription?.total ?? 0,
    },
    refreshPolicy: refreshPolicy
      ? {
          kind: refreshPolicy.kind,
          refreshing: refreshPolicy.refreshing,
          terminal: refreshPolicy.terminal,
          retryCount: refreshPolicy.retryCount,
          ...(refreshPolicy.timerPurpose === undefined
            ? {}
            : { timerPurpose: refreshPolicy.timerPurpose }),
          ...(refreshPolicy.timerDueAt === undefined
            ? {}
            : { timerDueAt: refreshPolicy.timerDueAt }),
          ...(refreshPolicy.remainingDelayMs === undefined
            ? {}
            : { remainingDelayMs: refreshPolicy.remainingDelayMs }),
        }
      : null,
    attemptMetrics: attempt
      ? {
          started: attempt.started,
          succeeded: attempt.succeeded,
          failed: attempt.failed,
          aborted: attempt.aborted,
          discarded: attempt.discarded,
          blocked: attempt.blocked,
          meanDurationMs: meanOf(attempt.duration),
          maxDurationMs: attempt.duration.count === 0 ? null : attempt.duration.maximumMs,
        }
      : null,
  };
};
