import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineEvent,
  GraphTransactionConflictError,
  normalizeDiagnosticEvents,
} from "../../src/core";
import { deferred } from "./test-helpers";

type CompletionOrder = "first" | "second";

interface ObserverSnapshot {
  readonly shared: number;
  readonly firstOnly: number;
  readonly secondOnly: number;
  readonly firstTargetGeneration: number;
  readonly secondTargetGeneration: number;
}

interface OverlapScenario {
  readonly releaseFirst: ReturnType<typeof deferred<void>>;
  readonly releaseSecond: ReturnType<typeof deferred<void>>;
  readonly firstTransaction: Promise<void>;
  readonly secondTransaction: Promise<void>;
  readonly diagnostics: ReturnType<typeof createInMemoryGraphDiagnostics>;
  readonly observerSnapshots: readonly ObserverSnapshot[];
  readonly getValues: () => Readonly<{
    shared: number;
    firstOnly: number;
    secondOnly: number;
  }>;
  readonly getTargetGenerations: () => Readonly<{
    first: number;
    second: number;
  }>;
}

const createOverlapScenario = async (): Promise<OverlapScenario> => {
  const shared = defineContextNode({ key: "overlap-shared", initialValue: 1 });
  const firstOnly = defineContextNode({ key: "overlap-first-only", initialValue: 10 });
  const secondOnly = defineContextNode({ key: "overlap-second-only", initialValue: 100 });
  const firstEvent = defineEvent<void>("overlap-first-event");
  const secondEvent = defineEvent<void>("overlap-second-event");
  const firstTarget = defineDataNode({
    key: "overlap-first-target",
    invalidatedBy: [firstEvent] as const,
    initialValue: 0,
    load: async () => 1,
  });
  const secondTarget = defineDataNode({
    key: "overlap-second-target",
    invalidatedBy: [secondEvent] as const,
    initialValue: 0,
    load: async () => 1,
  });
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
  let now = 0;
  const runtime = createGraphRuntime(
    createGraph({
      nodes: [
        shared,
        firstOnly,
        secondOnly,
        firstTarget,
        secondTarget,
      ],
    }),
    {
      diagnostics: {
        sink: diagnostics,
        environment: {
          now: () => ++now,
          createRuntimeId: () => "overlap-conflict-runtime",
        },
      },
    },
  );
  const observerSnapshots: ObserverSnapshot[] = [];
  runtime.onChange(() => {
    observerSnapshots.push({
      shared: runtime.getState(shared).data,
      firstOnly: runtime.getState(firstOnly).data,
      secondOnly: runtime.getState(secondOnly).data,
      firstTargetGeneration: runtime.getState(firstTarget).generation,
      secondTargetGeneration: runtime.getState(secondTarget).generation,
    });
  });
  const releaseFirst = deferred<void>();
  const releaseSecond = deferred<void>();

  const firstTransaction = runtime.transaction(async transaction => {
    transaction.setContext(shared, 2);
    transaction.setContext(firstOnly, 20);
    transaction.publish(firstEvent, undefined);
    await releaseFirst.promise;
  });
  const secondTransaction = runtime.transaction(async transaction => {
    transaction.setContext(shared, 3);
    transaction.setContext(secondOnly, 200);
    transaction.publish(secondEvent, undefined);
    await releaseSecond.promise;
  });
  await Promise.resolve();

  return {
    releaseFirst,
    releaseSecond,
    firstTransaction,
    secondTransaction,
    diagnostics,
    observerSnapshots,
    getValues: () => Object.freeze({
      shared: runtime.getState(shared).data,
      firstOnly: runtime.getState(firstOnly).data,
      secondOnly: runtime.getState(secondOnly).data,
    }),
    getTargetGenerations: () => Object.freeze({
      first: runtime.getState(firstTarget).generation,
      second: runtime.getState(secondTarget).generation,
    }),
  };
};

const verifyCompletionOrder = async (winner: CompletionOrder): Promise<void> => {
  const scenario = await createOverlapScenario();
  const winnerRelease = winner === "first"
    ? scenario.releaseFirst
    : scenario.releaseSecond;
  const loserRelease = winner === "first"
    ? scenario.releaseSecond
    : scenario.releaseFirst;
  const winnerTransaction = winner === "first"
    ? scenario.firstTransaction
    : scenario.secondTransaction;
  const loserTransaction = winner === "first"
    ? scenario.secondTransaction
    : scenario.firstTransaction;

  winnerRelease.resolve();
  await winnerTransaction;
  loserRelease.resolve();

  let conflict: GraphTransactionConflictError | undefined;
  try {
    await loserTransaction;
  } catch (error) {
    expect(error).toBeInstanceOf(GraphTransactionConflictError);
    conflict = error as GraphTransactionConflictError;
  }

  expect(conflict?.contextKeys).toEqual(["overlap-shared"]);
  expect(Object.isFrozen(conflict?.contextKeys)).toBe(true);
  expect(scenario.getValues()).toEqual({
    shared: winner === "first" ? 2 : 3,
    firstOnly: winner === "first" ? 20 : 10,
    secondOnly: winner === "second" ? 200 : 100,
  });
  expect(scenario.getTargetGenerations()).toEqual({
    first: winner === "first" ? 1 : 0,
    second: winner === "second" ? 1 : 0,
  });
  expect(scenario.observerSnapshots.every(snapshot =>
    winner === "first"
      ? snapshot.secondOnly === 100 && snapshot.secondTargetGeneration === 0
      : snapshot.firstOnly === 10 && snapshot.firstTargetGeneration === 0
  )).toBe(true);

  const events = normalizeDiagnosticEvents(scenario.diagnostics.getEvents());
  const started = events.filter(event => event.type === "transaction.started");
  const firstOperationId = started[0]?.operationId;
  const secondOperationId = started[1]?.operationId;
  const winningOperationId = winner === "first" ? firstOperationId : secondOperationId;
  const losingOperationId = winner === "first" ? secondOperationId : firstOperationId;

  expect(events.find(event =>
    event.type === "transaction.committed" &&
    event.operationId === winningOperationId
  )).toBeDefined();
  expect(events.find(event =>
    event.type === "transaction.conflicted" &&
    event.operationId === losingOperationId
  )).toMatchObject({ conflictKeys: ["overlap-shared"] });
  expect(events.some(event =>
    event.type === "context.changed" &&
    event.operationId === losingOperationId
  )).toBe(false);
  expect(events.some(event =>
    event.type === "event.published" &&
    event.operationId === losingOperationId
  )).toBe(false);
};

describe("overlapping transaction conflicts", () => {
  it("commits the first session to finish and rejects the later first-started session atomically", async () => {
    await verifyCompletionOrder("second");
  });

  it("commits the first session to finish and rejects the later second-started session atomically", async () => {
    await verifyCompletionOrder("first");
  });

  it("keeps conflict keys unique, sorted, and immutable for a genuine overlap", async () => {
    const first = defineContextNode({ key: "conflict-z", initialValue: 1 });
    const second = defineContextNode({ key: "conflict-a", initialValue: 10 });
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();

    const firstTransaction = runtime.transaction(async transaction => {
      transaction.setContext(first, 2);
      transaction.setContext(second, 20);
      transaction.setContext(first, 3);
      await releaseFirst.promise;
    });
    const secondTransaction = runtime.transaction(async transaction => {
      transaction.setContext(second, 30);
      transaction.setContext(first, 4);
      await releaseSecond.promise;
    });

    releaseFirst.resolve();
    await firstTransaction;
    releaseSecond.resolve();

    let conflict: GraphTransactionConflictError | undefined;
    try {
      await secondTransaction;
    } catch (error) {
      conflict = error as GraphTransactionConflictError;
    }

    expect(conflict).toBeInstanceOf(GraphTransactionConflictError);
    expect(conflict?.contextKeys).toEqual(["conflict-a", "conflict-z"]);
    expect(Object.isFrozen(conflict?.contextKeys)).toBe(true);
  });
});
