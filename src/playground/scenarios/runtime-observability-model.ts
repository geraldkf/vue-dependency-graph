import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineMutation,
  normalizeDiagnosticExport,
  type GraphDiagnosticEvent,
  type GraphDiagnosticExport,
  type GraphMetricsSnapshot,
  type GraphRuntime,
  type NodeSubscription,
} from "../../core";

export interface RuntimeObservabilityScenario {
  readonly runtime: GraphRuntime;
  readonly getEvents: () => readonly GraphDiagnosticEvent[];
  readonly getMetrics: () => GraphMetricsSnapshot;
  readonly getSnapshotPreview: () => string;
  readonly setSelectedCase: (value: string) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly failNextRequest: () => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly runTransactionRollback: () => Promise<void>;
  readonly runMutation: () => Promise<void>;
  readonly dispose: () => void;
  readonly getSelectedCase: () => string;
  readonly getSummary: () => string;
}

export const createRuntimeObservabilityScenario = (): RuntimeObservabilityScenario => {
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 100 });
  let timestamp = 0;
  let failNext = false;
  let subscription: NodeSubscription | undefined;

  const selectedCase = defineContextNode({
    key: "observability.selected-case",
    initialValue: "case-100",
    diagnostics: { value: "include" },
  });
  const protectedToken = defineContextNode({
    key: "observability.protected-token",
    initialValue: "secret-token",
  });
  const summary = defineDataNode({
    key: "observability.summary",
    dependencies: [selectedCase, protectedToken] as const,
    initialValue: "not loaded",
    diagnostics: {
      value: value => ({ summary: value }),
    },
    load: async ({ get }) => {
      if (failNext) {
        failNext = false;
        throw new Error("Demonstration request failed.");
      }
      return `Summary for ${get(selectedCase)}`;
    },
  });
  const mutation = defineMutation({
    key: "observability.save-note",
    execute: async ({ input }: { readonly input: string; readonly signal: AbortSignal }) =>
      `saved:${input}`,
  });
  const runtime = createGraphRuntime(
    createGraph({ nodes: [summary, selectedCase, protectedToken] }),
    {
      diagnostics: {
        sink: diagnostics,
        environment: {
          now: () => ++timestamp,
          createRuntimeId: () => "observability-playground",
        },
      },
    },
  );

  subscription = runtime.subscribeNodes([summary]);

  const createExport = (): GraphDiagnosticExport => ({
    snapshot: runtime.createDiagnosticSnapshot(),
    events: diagnostics.getEvents(),
  });

  const getSnapshotPreview = (): string =>
    JSON.stringify(normalizeDiagnosticExport(createExport()), null, 2);

  const setSelectedCase = async (value: string): Promise<void> => {
    runtime.setContext(selectedCase, value);
    await runtime.whenSettled();
  };

  const refresh = (): Promise<void> => runtime.refresh([summary]);

  const failNextRequest = async (): Promise<void> => {
    failNext = true;
    try {
      await runtime.refresh([summary]);
    } catch {
      // The failed state and diagnostic trace are the observable outcome.
    }
  };

  const recover = (): Promise<void> => runtime.refresh([summary]);

  const runTransactionRollback = async (): Promise<void> => {
    try {
      await runtime.transaction(transaction => {
        transaction.setContext(selectedCase, "rolled-back-case");
        throw new Error("Demonstration transaction rolled back.");
      });
    } catch {
      // The rollback diagnostic is the intended scenario outcome.
    }
  };

  const runMutation = async (): Promise<void> => {
    await runtime.mutate(mutation, "note");
  };

  const dispose = (): void => {
    subscription?.unsubscribe();
    subscription = undefined;
  };

  return Object.freeze({
    runtime,
    getEvents: diagnostics.getEvents,
    getMetrics: diagnostics.getMetrics,
    getSnapshotPreview,
    setSelectedCase,
    refresh,
    failNextRequest,
    recover,
    runTransactionRollback,
    runMutation,
    dispose,
    getSelectedCase: () => runtime.getState(selectedCase).data,
    getSummary: () => runtime.getState(summary).data,
  });
};
