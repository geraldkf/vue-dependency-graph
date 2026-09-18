import type { GraphDiagnosticSnapshotV1 } from "../../core";
import type {
  InspectorEventNode,
  InspectorGraphEdge,
  InspectorGraphNode,
  InspectorGraphView,
} from "./types";

/**
 * Longest-path-from-a-root depth for every node, memoised. The topology is
 * guaranteed acyclic by graph validation, so plain recursion is safe - no
 * cycle guard needed here that graph.ts hasn't already enforced.
 */
const computeDepths = (
  topology: GraphDiagnosticSnapshotV1["topology"]
): ReadonlyMap<string, number> => {
  const byKey = new Map(topology.map(node => [node.key, node]));
  const depths = new Map<string, number>();

  const depthOf = (key: string): number => {
    const cached = depths.get(key);
    if (cached !== undefined) return cached;
    const node = byKey.get(key);
    const dependencyKeys = node?.dependencyKeys ?? [];
    const depth =
      dependencyKeys.length === 0
        ? 0
        : 1 + Math.max(...dependencyKeys.map(depthOf));
    depths.set(key, depth);
    return depth;
  };

  for (const node of topology) depthOf(node.key);
  return depths;
};

/**
 * Turns a diagnostic snapshot's topology and per-node state into a
 * positioned graph: nodes laid out in columns by dependency depth (column
 * 0 = no dependencies), rows assigned alphabetically within a column for
 * a stable, deterministic layout - the same snapshot always produces the
 * same positions, so this is unit-testable without a rendering engine and
 * without tolerating force-layout jitter between runs.
 *
 * Events get their own column, to the left of column 0 (column -1),
 * positioned alphabetically by event key, with edges to every node that
 * declares them in `invalidatedBy`. They are not part of the dependency
 * depth computation - they have no dependencies of their own.
 */
export const computeGraphView = (
  snapshot: GraphDiagnosticSnapshotV1
): InspectorGraphView => {
  const depths = computeDepths(snapshot.topology);
  const stateByKey = new Map(snapshot.nodes.map(state => [state.key, state]));
  const subscriptionByKey = new Map(
    snapshot.subscriptions.map(subscription => [subscription.key, subscription])
  );
  const refreshPolicyKeys = new Set(
    snapshot.refreshPolicies.map(policy => policy.key)
  );

  const columns = new Map<number, string[]>();
  for (const node of snapshot.topology) {
    const depth = depths.get(node.key) ?? 0;
    const column = columns.get(depth) ?? [];
    column.push(node.key);
    columns.set(depth, column);
  }
  for (const keys of columns.values()) keys.sort();

  const rowByKey = new Map<string, number>();
  for (const keys of columns.values()) {
    keys.forEach((key, row) => rowByKey.set(key, row));
  }

  const nodes: InspectorGraphNode[] = snapshot.topology.map(topologyNode => {
    const state = stateByKey.get(topologyNode.key);
    const subscription = subscriptionByKey.get(topologyNode.key);
    return {
      key: topologyNode.key,
      kind: topologyNode.kind,
      status: state?.status ?? "idle",
      freshness: state?.freshness ?? "stale",
      hasSuccessfulValue: state?.hasSuccessfulValue ?? false,
      hasError: state?.error !== null && state?.error !== undefined,
      subscriberCount: subscription?.total ?? 0,
      hasRefreshPolicy: refreshPolicyKeys.has(topologyNode.key),
      column: depths.get(topologyNode.key) ?? 0,
      row: rowByKey.get(topologyNode.key) ?? 0,
    };
  });

  const eventKeys = [
    ...new Set(snapshot.topology.flatMap(node => node.eventKeys)),
  ].sort();
  const events: InspectorEventNode[] = eventKeys.map((key, row) => ({
    key,
    column: -1,
    row,
  }));

  const dependencyEdges: InspectorGraphEdge[] = snapshot.topology.flatMap(
    node =>
      node.dependencyKeys.map(
        (dependencyKey): InspectorGraphEdge => ({
          kind: "dependency",
          from: dependencyKey,
          to: node.key,
        })
      )
  );
  const eventEdges: InspectorGraphEdge[] = snapshot.topology.flatMap(node =>
    node.eventKeys.map(
      (eventKey): InspectorGraphEdge => ({
        kind: "event",
        from: eventKey,
        to: node.key,
      })
    )
  );

  const columnCount = columns.size === 0 ? 0 : Math.max(...columns.keys()) + 1;
  const maxRowCount = Math.max(
    events.length,
    ...[...columns.values()].map(keys => keys.length),
    0
  );

  return {
    nodes,
    events,
    edges: [...dependencyEdges, ...eventEdges],
    columnCount,
    maxRowCount,
  };
};
