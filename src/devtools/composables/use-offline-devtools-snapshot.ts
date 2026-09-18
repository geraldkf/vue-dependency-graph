import { computed, ref, shallowRef, type ComputedRef, type Ref } from "vue";
import type { GraphDiagnosticSnapshotV1, GraphDiagnosticEvent } from "../../core";
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
import type { DevtoolsExport } from "./use-graph-devtools";

export class InvalidDevtoolsExportError extends Error {
  public constructor(reason: string) {
    super(`Not a valid devtools export: ${reason}`);
    this.name = "InvalidDevtoolsExportError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/**
 * Deliberately shallow: checks the shape this module itself produces
 * (`useGraphDevtools().exportSnapshot()`), not a full schema validator.
 * This is a devtools-only import path for a file the same library wrote,
 * not a public data-interchange format with independent producers - the
 * bar is "give the person a clear error if the file is unrelated or
 * corrupted," not "validate every field of a versioned wire format."
 */
const parseDevtoolsExport = (json: string): DevtoolsExport => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidDevtoolsExportError("not valid JSON");
  }
  if (!isRecord(parsed)) throw new InvalidDevtoolsExportError("not a JSON object");
  if (parsed.schemaVersion !== 1) {
    throw new InvalidDevtoolsExportError(
      `unsupported schemaVersion (got ${JSON.stringify(parsed.schemaVersion)})`
    );
  }
  if (!isRecord(parsed.snapshot) || !Array.isArray(parsed.events)) {
    throw new InvalidDevtoolsExportError("missing snapshot or events");
  }
  return parsed as unknown as DevtoolsExport;
};

export interface UseOfflineDevtoolsSnapshotResult {
  readonly loaded: Ref<DevtoolsExport | undefined>;
  readonly graphView: ComputedRef<InspectorGraphView>;
  readonly timeline: ComputedRef<readonly InspectorTimelineEntry[]>;
  readonly metricsView: ComputedRef<InspectorMetricsView>;
  readonly selectedNodeKey: Ref<string | undefined>;
  readonly selectedNodeDetail: ComputedRef<InspectorNodeDetail | undefined>;
  readonly select: (key: string | undefined) => void;
  /** @throws {InvalidDevtoolsExportError} if `json` isn't a devtools export this version understands. */
  readonly loadFromJson: (json: string) => void;
  readonly clear: () => void;
}

const emptySnapshot: GraphDiagnosticSnapshotV1 = Object.freeze({
  schemaVersion: 1,
  createdAt: 0,
  runtimeId: "",
  topology: [],
  nodes: [],
  scheduler: { isScheduled: false, isRunning: false, error: null },
  subscriptions: [],
  refreshPolicies: [],
  diagnostics: { retainedEventCount: 0, droppedEventCount: 0 },
});

export const useOfflineDevtoolsSnapshot = (): UseOfflineDevtoolsSnapshotResult => {
  const loaded = shallowRef<DevtoolsExport | undefined>(undefined);
  const selectedNodeKey = ref<string | undefined>(undefined);

  const snapshot = computed<GraphDiagnosticSnapshotV1>(
    () => loaded.value?.snapshot ?? emptySnapshot
  );
  const events = computed<readonly GraphDiagnosticEvent[]>(
    () => loaded.value?.events ?? []
  );

  const graphView = computed(() => computeGraphView(snapshot.value));
  const timeline = computed(() => computeTimeline(events.value));
  const metricsView = computed(() => computeMetricsView(snapshot.value.metrics));
  const selectedNodeDetail = computed(() =>
    selectedNodeKey.value === undefined
      ? undefined
      : computeNodeDetail(snapshot.value, selectedNodeKey.value)
  );

  const select = (key: string | undefined): void => {
    selectedNodeKey.value = key;
  };
  const loadFromJson = (json: string): void => {
    loaded.value = parseDevtoolsExport(json);
    selectedNodeKey.value = undefined;
  };
  const clear = (): void => {
    loaded.value = undefined;
    selectedNodeKey.value = undefined;
  };

  return {
    loaded,
    graphView,
    timeline,
    metricsView,
    selectedNodeKey,
    selectedNodeDetail,
    select,
    loadFromJson,
    clear,
  };
};
