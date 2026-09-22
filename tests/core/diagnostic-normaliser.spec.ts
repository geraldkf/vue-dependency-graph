import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  normalizeDiagnosticEvents,
  normalizeDiagnosticExport,
  normalizeDiagnosticSnapshot,
  type GraphDiagnosticEvent,
  type GraphDiagnosticExport,
} from "../../src/core";

const createScenario = async (
  runtimeId: string,
  timeOffset: number,
): Promise<GraphDiagnosticExport> => {
  const collector = createInMemoryGraphDiagnostics({ capacity: 100 });
  let now = timeOffset;
  const context = defineContextNode({
    key: "context",
    initialValue: 2,
    diagnostics: { value: "include" },
  });
  const data = defineDataNode({
    key: "data",
    dependencies: [context] as const,
    initialValue: 0,
    load: async ({ get }) => get(context) * 2,
  });
  const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }), {
    diagnostics: {
      sink: collector,
      environment: {
        now: () => ++now,
        createRuntimeId: () => runtimeId,
      },
    },
  });

  await runtime.execute([data]);

  return {
    snapshot: runtime.createDiagnosticSnapshot(),
    events: collector.getEvents(),
  };
};

describe("diagnostic normalisation", () => {
  it("normalises equivalent runtime exports identically", async () => {
    const first = await createScenario("first-runtime", 10);
    const second = await createScenario("second-runtime", 10_000);

    expect(normalizeDiagnosticExport(first)).toEqual(normalizeDiagnosticExport(second));
  });

  it("preserves meaningful state, outcome, and ordering differences", async () => {
    const baseline = await createScenario("baseline", 10);
    const changed = await createScenario("changed", 20);
    const context = defineContextNode({
      key: "context",
      initialValue: 3,
      diagnostics: { value: "include" },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const changedState = runtime.createDiagnosticSnapshot();

    expect(normalizeDiagnosticSnapshot(baseline.snapshot)).not.toEqual(
      normalizeDiagnosticSnapshot(changedState),
    );

    const reversed = {
      ...changed,
      events: [...changed.events].reverse(),
    };
    expect(normalizeDiagnosticExport(baseline)).not.toEqual(normalizeDiagnosticExport(reversed));
  });

  it("aliases operation and cause identifiers while preserving causal links", () => {
    const events: readonly GraphDiagnosticEvent[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        timestamp: 123,
        runtimeId: "runtime-a",
        type: "subscription.added",
        operationId: "runtime-a:operation-8",
        nodeKeys: ["data"],
        requiredNodeKeys: [],
      },
      {
        schemaVersion: 1,
        sequence: 2,
        timestamp: 456,
        runtimeId: "runtime-a",
        type: "scheduler.requested",
        operationId: "runtime-a:operation-9",
        causeId: "runtime-a:operation-8",
        reason: "subscription",
        nodeKeys: [],
      },
      {
        schemaVersion: 1,
        sequence: 3,
        timestamp: 789,
        runtimeId: "runtime-a",
        type: "node.load.succeeded",
        operationId: "runtime-a:operation-9",
        causeId: "runtime-a:operation-8",
        nodeKey: "data",
        nodeKind: "data",
        generation: 0,
        origin: "scheduler",
        reason: "subscription",
        durationMs: 37,
      },
    ];

    const normalized = normalizeDiagnosticEvents(events);

    expect(normalized).toMatchObject([
      { operationId: "operation-1", timestamp: 0, runtimeId: "runtime" },
      {
        operationId: "operation-2",
        causeId: "operation-1",
        timestamp: 0,
      },
      {
        operationId: "operation-2",
        causeId: "operation-1",
        durationMs: 0,
      },
    ]);
    expect(normalized.map((event) => event.type)).toEqual(events.map((event) => event.type));
  });

  it("does not mutate the source and is idempotent", async () => {
    const source = await createScenario("source-runtime", 500);
    const sourceJson = JSON.stringify(source);
    const normalized = normalizeDiagnosticExport(source);

    expect(JSON.stringify(source)).toBe(sourceJson);
    expect(Object.isFrozen(source.snapshot)).toBe(true);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.snapshot)).toBe(true);
    expect(Object.isFrozen(normalized.events)).toBe(true);
    expect(normalizeDiagnosticExport(normalized)).toEqual(normalized);
  });
});
