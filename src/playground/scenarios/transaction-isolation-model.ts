import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  GraphTransactionConflictError,
  type GraphDiagnosticEvent,
  type GraphRuntime,
  type NodeSubscription,
} from "../../core";

export type TransactionIsolationPhase =
  | "idle"
  | "open"
  | "committed"
  | "rolled-back"
  | "conflicted";

export type TransactionIsolationMode = "independent" | "conflict";
export type TransactionIsolationDecision = "commit" | "rollback";

export interface TransactionIsolationSnapshot {
  readonly mode: TransactionIsolationMode;
  readonly operationA: {
    readonly phase: TransactionIsolationPhase;
    readonly committedValue: number;
    readonly requestCount: number;
  };
  readonly operationB: {
    readonly phase: TransactionIsolationPhase;
    readonly committedValue: number;
    readonly requestCount: number;
  };
  readonly sharedValue: number;
  readonly schedulerStatus: "idle" | "scheduled" | "running";
  readonly conflictKeys: readonly string[];
  readonly timeline: readonly GraphDiagnosticEvent[];
}

export interface TransactionIsolationScenario {
  readonly runtime: GraphRuntime;
  readonly initialize: () => Promise<void>;
  readonly startIndependent: () => Promise<void>;
  readonly startConflict: () => Promise<void>;
  readonly completeA: (decision: TransactionIsolationDecision) => Promise<void>;
  readonly completeB: (decision: TransactionIsolationDecision) => Promise<void>;
  readonly reset: () => Promise<void>;
  readonly dispose: () => void;
  readonly getSnapshot: () => TransactionIsolationSnapshot;
}

interface PendingDecision {
  readonly promise: Promise<TransactionIsolationDecision>;
  readonly resolve: (decision: TransactionIsolationDecision) => void;
}

const createPendingDecision = (): PendingDecision => {
  let resolve!: (decision: TransactionIsolationDecision) => void;
  const promise = new Promise<TransactionIsolationDecision>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
};

export const createTransactionIsolationScenario = (): TransactionIsolationScenario => {
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 120 });
  let timestamp = 0;
  let operationAPhase: TransactionIsolationPhase = "idle";
  let operationBPhase: TransactionIsolationPhase = "idle";
  let mode: TransactionIsolationMode = "independent";
  let operationARequests = 0;
  let operationBRequests = 0;
  let conflictKeys: readonly string[] = Object.freeze([]);
  let decisionA: PendingDecision | undefined;
  let decisionB: PendingDecision | undefined;
  let transactionA: Promise<void> | undefined;
  let transactionB: Promise<void> | undefined;
  let subscription: NodeSubscription | undefined;
  let initialization: Promise<void> | undefined;
  let disposed = false;

  const operationAContext = defineContextNode({
    key: "transaction-isolation.operation-a",
    initialValue: 1,
  });
  const operationBContext = defineContextNode({
    key: "transaction-isolation.operation-b",
    initialValue: 10,
  });
  const sharedContext = defineContextNode({
    key: "transaction-isolation.shared",
    initialValue: 100,
  });
  const operationAResult = defineDataNode({
    key: "transaction-isolation.operation-a-result",
    dependencies: [operationAContext, sharedContext] as const,
    initialValue: "not loaded",
    load: async ({ get }) => {
      operationARequests += 1;
      return `A ${get(operationAContext)} / shared ${get(sharedContext)}`;
    },
  });
  const operationBResult = defineDataNode({
    key: "transaction-isolation.operation-b-result",
    dependencies: [operationBContext, sharedContext] as const,
    initialValue: "not loaded",
    load: async ({ get }) => {
      operationBRequests += 1;
      return `B ${get(operationBContext)} / shared ${get(sharedContext)}`;
    },
  });

  const runtime = createGraphRuntime(
    createGraph({
      nodes: [
        operationAResult,
        operationBResult,
        operationAContext,
        operationBContext,
        sharedContext,
      ],
    }),
    {
      diagnostics: {
        sink: diagnostics,
        environment: {
          now: () => ++timestamp,
          createRuntimeId: () => "transaction-isolation-runtime",
        },
      },
    },
  );

  const initialize = (): Promise<void> => {
    initialization ??= (async () => {
      subscription = runtime.subscribeNodes([operationAResult, operationBResult]);
      await runtime.whenSettled();
      operationARequests = 0;
      operationBRequests = 0;
      diagnostics.reset();
    })();
    return initialization;
  };

  const requireIdle = (): void => {
    if (operationAPhase === "open" || operationBPhase === "open") {
      throw new Error("Complete both open transactions before starting again.");
    }
  };

  const runOperation = (
    operation: "A" | "B",
    decision: PendingDecision,
  ): Promise<void> => runtime.transaction(async transaction => {
    if (mode === "independent") {
      if (operation === "A") transaction.setContext(operationAContext, 2);
      else transaction.setContext(operationBContext, 20);
    } else {
      transaction.setContext(sharedContext, operation === "A" ? 200 : 300);
      if (operation === "A") transaction.setContext(operationAContext, 2);
      else transaction.setContext(operationBContext, 20);
    }

    const outcome = await decision.promise;
    if (outcome === "rollback") {
      throw new Error(`Operation ${operation} rolled back.`);
    }
  });

  const start = async (nextMode: TransactionIsolationMode): Promise<void> => {
    await initialize();
    requireIdle();
    mode = nextMode;
    operationAPhase = "open";
    operationBPhase = "open";
    conflictKeys = Object.freeze([]);
    diagnostics.reset();
    decisionA = createPendingDecision();
    decisionB = createPendingDecision();
    transactionA = runOperation("A", decisionA);
    transactionB = runOperation("B", decisionB);
    await Promise.resolve();
  };

  const complete = async (
    operation: "A" | "B",
    decision: TransactionIsolationDecision,
  ): Promise<void> => {
    const pendingDecision = operation === "A" ? decisionA : decisionB;
    const pendingTransaction = operation === "A" ? transactionA : transactionB;
    const phase = operation === "A" ? operationAPhase : operationBPhase;
    if (pendingDecision === undefined || pendingTransaction === undefined || phase !== "open") {
      return;
    }

    pendingDecision.resolve(decision);
    try {
      await pendingTransaction;
      if (operation === "A") operationAPhase = "committed";
      else operationBPhase = "committed";
      await runtime.whenSettled();
    } catch (error) {
      if (error instanceof GraphTransactionConflictError) {
        conflictKeys = error.contextKeys;
        if (operation === "A") operationAPhase = "conflicted";
        else operationBPhase = "conflicted";
      } else {
        if (operation === "A") operationAPhase = "rolled-back";
        else operationBPhase = "rolled-back";
      }
    }
  };

  const reset = async (): Promise<void> => {
    if (operationAPhase === "open") await complete("A", "rollback");
    if (operationBPhase === "open") await complete("B", "rollback");
    await runtime.transaction(transaction => {
      transaction.setContext(operationAContext, 1);
      transaction.setContext(operationBContext, 10);
      transaction.setContext(sharedContext, 100);
    });
    await runtime.whenSettled();
    mode = "independent";
    operationAPhase = "idle";
    operationBPhase = "idle";
    operationARequests = 0;
    operationBRequests = 0;
    conflictKeys = Object.freeze([]);
    decisionA = undefined;
    decisionB = undefined;
    transactionA = undefined;
    transactionB = undefined;
    diagnostics.reset();
  };

  const getSnapshot = (): TransactionIsolationSnapshot => {
    const scheduler = runtime.getSchedulerState();
    return Object.freeze({
      mode,
      operationA: Object.freeze({
        phase: operationAPhase,
        committedValue: runtime.getState(operationAContext).data,
        requestCount: operationARequests,
      }),
      operationB: Object.freeze({
        phase: operationBPhase,
        committedValue: runtime.getState(operationBContext).data,
        requestCount: operationBRequests,
      }),
      sharedValue: runtime.getState(sharedContext).data,
      schedulerStatus: scheduler.isRunning
        ? "running"
        : scheduler.isScheduled
          ? "scheduled"
          : "idle",
      conflictKeys,
      timeline: diagnostics.getEvents(),
    });
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    decisionA?.resolve("rollback");
    decisionB?.resolve("rollback");
    void transactionA?.catch(() => undefined);
    void transactionB?.catch(() => undefined);
    subscription?.unsubscribe();
    subscription = undefined;
  };

  return Object.freeze({
    runtime,
    initialize,
    startIndependent: () => start("independent"),
    startConflict: () => start("conflict"),
    completeA: (decision: TransactionIsolationDecision) => complete("A", decision),
    completeB: (decision: TransactionIsolationDecision) => complete("B", decision),
    reset,
    dispose,
    getSnapshot,
  });
};
