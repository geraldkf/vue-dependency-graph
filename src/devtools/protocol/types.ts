import type { NodeKind, GraphDiagnosticNodeStateSnapshot, GraphSerializedError } from "../../core";

export type InspectorNodeStatus = GraphDiagnosticNodeStateSnapshot["status"];
export type InspectorNodeFreshness = GraphDiagnosticNodeStateSnapshot["freshness"];

/**
 * One node's position and at-a-glance state in the graph view. Layout is
 * computed once per snapshot by `computeGraphView` - deterministically, so
 * the same snapshot always produces the same positions and tests don't
 * need to tolerate a non-deterministic force layout.
 */
export interface InspectorGraphNode {
  readonly key: string;
  readonly kind: NodeKind;
  readonly status: InspectorNodeStatus;
  readonly freshness: InspectorNodeFreshness;
  readonly hasSuccessfulValue: boolean;
  readonly hasError: boolean;
  readonly subscriberCount: number;
  readonly hasRefreshPolicy: boolean;
  /** Column/row position in an abstract unit grid, not pixels. Multiply by
   * the layout constants (see `layout.ts`) to render, so the protocol
   * layer stays free of any rendering-unit decision. */
  readonly column: number;
  readonly row: number;
}

/**
 * A pseudo-node representing a typed event, positioned in its own lane to
 * the left of the dependency graph proper. Events are not graph nodes -
 * they have no dependencies, no execution state - but the roadmap calls
 * for showing event-invalidation edges, and giving each distinct event a
 * position lets that be a normal edge instead of a special case bolted
 * onto whichever node happens to declare it first.
 */
export interface InspectorEventNode {
  readonly key: string;
  readonly column: number;
  readonly row: number;
}

export type InspectorGraphEdgeKind = "dependency" | "event";

export interface InspectorGraphEdge {
  readonly kind: InspectorGraphEdgeKind;
  readonly from: string;
  readonly to: string;
}

export interface InspectorGraphView {
  readonly nodes: readonly InspectorGraphNode[];
  readonly events: readonly InspectorEventNode[];
  readonly edges: readonly InspectorGraphEdge[];
  readonly columnCount: number;
  readonly maxRowCount: number;
}

export interface InspectorNodeDependency {
  readonly key: string;
  readonly status: InspectorNodeStatus;
}

export interface InspectorRefreshPolicyDetail {
  readonly kind: "stale-after" | "interval" | "poll-until";
  readonly refreshing: boolean;
  readonly terminal: boolean;
  readonly retryCount: number;
  readonly timerPurpose?: "refresh" | "retry";
  readonly timerDueAt?: number;
  readonly remainingDelayMs?: number;
}

export interface InspectorNodeDetail {
  readonly key: string;
  readonly kind: NodeKind;
  readonly status: InspectorNodeStatus;
  readonly freshness: InspectorNodeFreshness;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
  readonly value: GraphDiagnosticNodeStateSnapshot["value"];
  readonly error: GraphSerializedError | null;
  readonly dependencies: readonly InspectorNodeDependency[];
  readonly descendants: readonly InspectorNodeDependency[];
  readonly invalidatedByEvents: readonly string[];
  readonly subscribers: Readonly<{
    direct: number;
    required: number;
    total: number;
  }>;
  readonly refreshPolicy: InspectorRefreshPolicyDetail | null;
  readonly attemptMetrics: Readonly<{
    started: number;
    succeeded: number;
    failed: number;
    aborted: number;
    discarded: number;
    blocked: number;
    meanDurationMs: number | null;
    maxDurationMs: number | null;
  }> | null;
}

export interface InspectorMetricRow {
  readonly label: string;
  readonly value: string;
}

export interface InspectorMetricGroup {
  readonly title: string;
  readonly rows: readonly InspectorMetricRow[];
}

export interface InspectorMetricsView {
  readonly groups: readonly InspectorMetricGroup[];
}
export type InspectorTimelineCategory =
  | "operation"
  | "subscription"
  | "scheduler"
  | "context"
  | "invalidation"
  | "execution"
  | "event"
  | "transaction"
  | "refresh-policy"
  | "release"
  | "mutation";

export interface InspectorTimelineEntry {
  readonly sequence: number;
  readonly timestamp: number;
  readonly type: string;
  readonly category: InspectorTimelineCategory;
  readonly operationId?: string;
  readonly causeId?: string;
  readonly nodeKey?: string;
  readonly label: string;
  readonly isFailure: boolean;
}
