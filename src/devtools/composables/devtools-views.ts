import { computed, ref, type ComputedRef } from "vue";
import type {
  GraphDiagnosticEvent,
  GraphDiagnosticSnapshotV1,
  GraphMetricsSnapshot,
} from "../../core";
import { computeGraphView } from "../protocol/graph-view";
import { computeNodeDetail } from "../protocol/node-inspector";
import { computeTimeline } from "../protocol/timeline";
import { computeMetricsView } from "../protocol/metrics-panel";

/** Pure view derivation and selection shared by live and imported snapshots. */
export const createDevtoolsViews = (
  snapshot: ComputedRef<GraphDiagnosticSnapshotV1>,
  events: ComputedRef<readonly GraphDiagnosticEvent[]>,
  metrics: ComputedRef<GraphMetricsSnapshot | undefined>,
) => {
  const selectedNodeKey = ref<string | undefined>(undefined);
  return {
    graphView: computed(() => computeGraphView(snapshot.value)),
    timeline: computed(() => computeTimeline(events.value)),
    metricsView: computed(() => computeMetricsView(metrics.value)),
    selectedNodeKey,
    selectedNodeDetail: computed(() =>
      selectedNodeKey.value === undefined
        ? undefined
        : computeNodeDetail(snapshot.value, selectedNodeKey.value),
    ),
    select: (key: string | undefined): void => {
      selectedNodeKey.value = key;
    },
  };
};
