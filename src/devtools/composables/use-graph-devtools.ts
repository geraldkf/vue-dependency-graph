import { createDevtoolsViews } from "./devtools-views";
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import type { GraphRuntime, InMemoryGraphDiagnostics, GraphDiagnosticSnapshotV1 } from "../../core";
import { assertActiveEffectScope } from "./scope-guard";
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
  let active = true;
  const requestFlush = (): void => {
    if (!active || flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      if (!active) return;
      revision.value += 1;
    });
  };

  const stopWatching = runtime.onChange(requestFlush);
  const stopDiagnostics = diagnostics.onChange(requestFlush);
  onScopeDispose(() => {
    active = false;
    stopWatching();
    stopDiagnostics();
  });

  const snapshot = computed(() => {
    void revision.value;
    return runtime.createDiagnosticSnapshot();
  });
  const events = computed(() => {
    void revision.value;
    return diagnostics.getEvents();
  });
  const metrics = computed(() => {
    void revision.value;
    return diagnostics.getMetrics();
  });
  const views = createDevtoolsViews(snapshot, events, metrics);

  const exportSnapshot = (): string => {
    const payload: DevtoolsExport = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      snapshot: runtime.createDiagnosticSnapshot(),
      events: diagnostics.getEvents(),
    };
    return JSON.stringify(payload, null, 2);
  };

  return {
    snapshot,
    ...views,
    exportSnapshot,
  };
};
