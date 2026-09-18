import { coreLayerName } from "../core";

/** Identifies the devtools layer during repository bootstrap. */
export const devtoolsLayerName = `devtools:${coreLayerName}` as const;

// Protocol: pure, framework-agnostic transforms from a diagnostic
// snapshot/event stream into inspector-ready view models. The Vue
// components below are one consumer of this; it's exported directly so a
// different renderer (a future browser-extension integration, a
// third-party tool) can build on the same stable data contract without
// depending on Vue at all.
export { computeGraphView } from "./protocol/graph-view";
export { computeNodeDetail } from "./protocol/node-inspector";
export { computeTimeline } from "./protocol/timeline";
export { computeMetricsView } from "./protocol/metrics-panel";
export type {
  InspectorNodeStatus,
  InspectorNodeFreshness,
  InspectorGraphNode,
  InspectorEventNode,
  InspectorGraphEdgeKind,
  InspectorGraphEdge,
  InspectorGraphView,
  InspectorNodeDependency,
  InspectorRefreshPolicyDetail,
  InspectorNodeDetail,
  InspectorMetricRow,
  InspectorMetricGroup,
  InspectorMetricsView,
  InspectorTimelineCategory,
  InspectorTimelineEntry,
} from "./protocol/types";

// Composables
export { useGraphDevtools } from "./composables/use-graph-devtools";
export type {
  UseGraphDevtoolsOptions,
  UseGraphDevtoolsResult,
  DevtoolsExport,
} from "./composables/use-graph-devtools";
export {
  useOfflineDevtoolsSnapshot,
  InvalidDevtoolsExportError,
} from "./composables/use-offline-devtools-snapshot";
export type { UseOfflineDevtoolsSnapshotResult } from "./composables/use-offline-devtools-snapshot";

// Components
export { default as GraphDevtoolsPanel } from "./components/GraphDevtoolsPanel.vue";
export { default as GraphView } from "./components/GraphView.vue";
export { default as NodeInspector } from "./components/NodeInspector.vue";
export { default as Timeline } from "./components/Timeline.vue";
export { default as MetricsPanel } from "./components/MetricsPanel.vue";
