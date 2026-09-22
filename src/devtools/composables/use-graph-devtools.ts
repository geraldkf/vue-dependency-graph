import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { GraphRuntime, InMemoryGraphDiagnostics, GraphDiagnosticSnapshotV1 } from "../../core";
import { assertActiveEffectScope } from "./scope-guard";
import { computeGraphView } from "../protocol/graph-view";
import { computeNodeDetail } from "../protocol/node-inspector";
import { computeTimeline } from "../protocol/timeline";
import { computeMetricsView } from "../protocol/metrics-panel";
import type {
  InspectorGraphView,
  InspectorMetricsView,
  InspectorNodeDetail,
  InspectorTimelineEntry,
} from "../protocol/types";

export interface UseGraphDevtoolsOptions {
  readonly runtime: GraphRuntime;
  /**
   * The same collector instance passed as `createGraphRuntime`'s
   * `diagnostics.sink` option. Devtools has nothing to show without one -
   * there is no default collector implicitly created here, since that
   * would mean every devtools consumer silently pays the (small, but
   * nonzero) cost of event retention whether or not they asked for it.
   */
  readonly diagnostics: InMemoryGraphDiagnostics;
}

export interface UseGraphDevtoolsResult {
  readonly snapshot: ComputedRef<GraphDiagnosticSnapshotV1>;
  readonly graphView: ComputedRef<InspectorGraphView>;
  readonly timeline: ComputedRef<readonly InspectorTimelineEntry[]>;
  readonly metricsView: ComputedRef<InspectorMetricsView>;
  readonly selectedNodeKey: Ref<string | undefined>;
  readonly selectedNodeDetail: ComputedRef<InspectorNodeDetail | undefined>;
  readonly select: (key: string | undefined) => void;
  /** A pretty-printed JSON export of the current snapshot and retained
   * event log, suitable for saving to a file and reloading later through
   * the offline viewer (see `loadOfflineSnapshot`). */
  readonly exportSnapshot: () => string;
}

export interface DevtoolsExport {
  readonly schemaVersion: 1;
  readonly exportedAt: number;
  readonly snapshot: GraphDiagnosticSnapshotV1;
  readonly events: readonly ReturnType<InMemoryGraphDiagnostics["getEvents"]>[number][];
}

/**
 * Wires a live runtime and its diagnostics collector into reactive
 * devtools state for the lifetime of the calling effect scope. Recomputes
 * are coalesced into one microtask per burst of `runtime.onChange`
 * notifications - the same coalescing idiom the runtime's own scheduler
 * uses internally, applied here so a burst of graph activity doesn't
 * recompute a full snapshot and re-layout once per individual state
 * transition.
 */
export const useGraphDevtools = (options: UseGraphDevtoolsOptions): UseGraphDevtoolsResult => {
  assertActiveEffectScope("useGraphDevtools");
  const { runtime, diagnostics } = options;

  const revision = ref(0);
  let flushScheduled = false;
  const requestFlush = (): void => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      revision.value += 1;
    });
  };

  const stopWatching = runtime.onChange(requestFlush);
  onScopeDispose(stopWatching);

  const snapshot = computed(() => {
    void revision.value;
    return runtime.createDiagnosticSnapshot();
  });
  const graphView = computed(() => computeGraphView(snapshot.value));
  const timeline = computed(() => {
    void revision.value;
    return computeTimeline(diagnostics.getEvents());
  });
  const metricsView = computed(() => {
    void revision.value;
    return computeMetricsView(diagnostics.getMetrics());
  });

  const selectedNodeKey = ref<string | undefined>(undefined);
  const selectedNodeDetail = computed(() =>
    selectedNodeKey.value === undefined
      ? undefined
      : computeNodeDetail(snapshot.value, selectedNodeKey.value),
  );
  const select = (key: string | undefined): void => {
    selectedNodeKey.value = key;
  };

  const exportSnapshot = (): string => {
    const payload: DevtoolsExport = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      snapshot: snapshot.value,
      events: diagnostics.getEvents(),
    };
    return JSON.stringify(payload, null, 2);
  };

  return {
    snapshot,
    graphView,
    timeline,
    metricsView,
    selectedNodeKey,
    selectedNodeDetail,
    select,
    exportSnapshot,
  };
};
