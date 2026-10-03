import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineDataNode,
  type GraphDiagnosticEvent,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const event = (
  sequence: number,
  input: Readonly<Record<string, unknown>> & {
    readonly type: GraphDiagnosticEvent["type"];
  },
): GraphDiagnosticEvent =>
  ({
    schemaVersion: 1,
    sequence,
    timestamp: sequence * 10,
    runtimeId: "runtime",
    ...input,
  }) as GraphDiagnosticEvent;

describe("in-memory graph diagnostics", () => {
  it("isolates observer failures and supports idempotent cleanup", () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 1 });
    let calls = 0;
    diagnostics.onChange(() => {
      throw new Error("listener");
    });
    const stop = diagnostics.onChange(() => {
      calls += 1;
    });
    diagnostics.emit(event(1, { type: "runtime.created", nodeKeys: [] }));
    diagnostics.reset();
    expect(calls).toBe(2);
    stop();
    stop();
    diagnostics.reset();
    expect(calls).toBe(2);
  });
  it.each([0, -1, 1.5, Number.NaN])("rejects invalid capacity %s", (capacity: number) => {
    expect(() => createInMemoryGraphDiagnostics({ capacity })).toThrow(
      "Diagnostic capacity must be a positive integer.",
    );
  });

  it("retains the newest events and reports dropped records", () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 2 });

    diagnostics.emit(event(1, { type: "runtime.created", nodeKeys: [] }));
    diagnostics.emit(
      event(2, {
        type: "operation.execute.requested",
        operationId: "operation-1",
        operation: "execute",
        nodeKeys: [],
      }),
    );
    diagnostics.emit(
      event(3, {
        type: "operation.prefetch.requested",
        operationId: "operation-2",
        operation: "prefetch",
        nodeKeys: [],
      }),
    );

    expect(diagnostics.getEvents().map((item) => item.sequence)).toEqual([2, 3]);
    expect(Object.isFrozen(diagnostics.getEvents())).toBe(true);
    expect(Object.isFrozen(diagnostics.getEvents()[0])).toBe(true);
    expect(diagnostics.getMetrics()).toMatchObject({
      eventCount: 3,
      droppedEventCount: 1,
      operationCounts: { execute: 1, prefetch: 1 },
    });
  });

  it("keeps cumulative metrics after retained events are evicted", () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 1 });

    diagnostics.emit(
      event(1, {
        type: "transaction.started",
        operationId: "transaction-1",
      }),
    );
    diagnostics.emit(
      event(2, {
        type: "transaction.committed",
        operationId: "transaction-1",
        durationMs: 25,
      }),
    );
    diagnostics.emit(
      event(3, {
        type: "mutation.started",
        operationId: "mutation-1",
        mutationKey: "save",
      }),
    );
    diagnostics.emit(
      event(4, {
        type: "mutation.completed",
        operationId: "mutation-1",
        mutationKey: "save",
        outcome: "succeeded",
        durationMs: 40,
      }),
    );

    expect(diagnostics.getEvents()).toHaveLength(1);
    expect(diagnostics.getMetrics()).toMatchObject({
      eventCount: 4,
      droppedEventCount: 3,
      transactions: {
        started: 1,
        committed: 1,
        duration: { count: 1, totalMs: 25, maximumMs: 25 },
      },
      mutations: {
        started: 1,
        succeeded: 1,
        duration: { count: 1, totalMs: 40, maximumMs: 40 },
      },
    });
  });

  it("tracks queue wait, active load maximum, outcomes, and node durations", () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 20 });

    diagnostics.emit(
      event(1, {
        type: "node.load.queued",
        operationId: "operation-1",
        nodeKey: "first",
        nodeKind: "data",
        generation: 0,
        origin: "explicit",
        reason: "explicit",
      }),
    );
    diagnostics.emit(
      event(2, {
        type: "node.load.started",
        operationId: "operation-1",
        nodeKey: "first",
        nodeKind: "data",
        generation: 0,
        origin: "explicit",
        reason: "explicit",
      }),
    );
    diagnostics.emit(
      event(3, {
        type: "node.load.started",
        operationId: "operation-1",
        nodeKey: "second",
        nodeKind: "data",
        generation: 0,
        origin: "explicit",
        reason: "explicit",
      }),
    );
    diagnostics.emit(
      event(4, {
        type: "node.load.succeeded",
        operationId: "operation-1",
        nodeKey: "first",
        nodeKind: "data",
        generation: 0,
        origin: "explicit",
        reason: "explicit",
        durationMs: 30,
      }),
    );
    diagnostics.emit(
      event(5, {
        type: "node.load.failed",
        operationId: "operation-1",
        nodeKey: "second",
        nodeKind: "data",
        generation: 0,
        origin: "explicit",
        reason: "explicit",
        durationMs: 20,
        error: { name: "Error", message: "failed" },
      }),
    );

    const metrics = diagnostics.getMetrics();
    expect(metrics).toMatchObject({
      activeLoads: 0,
      maximumActiveLoads: 2,
      queuedLoads: 1,
      queueWaitDuration: { count: 1, totalMs: 10, maximumMs: 10 },
    });
    expect(metrics.nodeAttempts).toEqual([
      expect.objectContaining({
        nodeKey: "first",
        started: 1,
        succeeded: 1,
        duration: { count: 1, totalMs: 30, maximumMs: 30 },
      }),
      expect.objectContaining({
        nodeKey: "second",
        started: 1,
        failed: 1,
        duration: { count: 1, totalMs: 20, maximumMs: 20 },
      }),
    ]);
    expect(Object.isFrozen(metrics)).toBe(true);
    expect(Object.isFrozen(metrics.nodeAttempts)).toBe(true);
    expect(Object.isFrozen(metrics.nodeAttempts[0])).toBe(true);
  });

  it("resets collector state without affecting its runtime", async () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 20 });
    const node = defineDataNode({
      key: "reset-node",
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      diagnostics: { sink: diagnostics },
    });

    await runtime.execute([node]);
    expect(runtime.getState(node).data).toBe(1);
    expect(diagnostics.getEvents().length).toBeGreaterThan(0);

    diagnostics.reset();

    expect(diagnostics.getEvents()).toEqual([]);
    expect(diagnostics.getMetrics()).toMatchObject({
      eventCount: 0,
      droppedEventCount: 0,
      activeLoads: 0,
      maximumActiveLoads: 0,
    });
    expect(runtime.getState(node).data).toBe(1);
  });

  it("can deliberately collect independent runtime streams", async () => {
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 20 });
    const gate = deferred<number>();
    const firstNode = defineDataNode({
      key: "first-runtime-node",
      initialValue: 0,
      load: () => gate.promise,
    });
    const secondNode = defineDataNode({
      key: "second-runtime-node",
      initialValue: 0,
      load: async () => 2,
    });
    const first = createGraphRuntime(createGraph({ nodes: [firstNode] }), {
      diagnostics: { sink: diagnostics },
    });
    const second = createGraphRuntime(createGraph({ nodes: [secondNode] }), {
      diagnostics: { sink: diagnostics },
    });

    const firstWork = first.execute([firstNode]);
    await waitForCondition(
      () => diagnostics.getMetrics().activeLoads === 1,
      "first runtime load to become active",
    );
    await second.execute([secondNode]);
    gate.resolve(1);
    await firstWork;

    const runtimeIds = new Set(
      diagnostics
        .getEvents()
        .filter((item) => item.type === "runtime.created")
        .map((item) => item.runtimeId),
    );
    expect(runtimeIds.size).toBe(2);
    expect(diagnostics.getMetrics()).toMatchObject({
      maximumActiveLoads: 2,
      activeLoads: 0,
    });
  });
});
