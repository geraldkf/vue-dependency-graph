import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineDataNode,
  type GraphDiagnosticEvent,
} from "../../src/core";
import { createRuntimeDiagnosticEmitter } from "../../src/core/diagnostics/diagnostic-emitter";
import {
  beginExecutionDiagnostics,
  emitExecution,
} from "../../src/core/diagnostics/execution-diagnostics";

const event = (sequence: number, extra: Record<string, unknown> = {}): GraphDiagnosticEvent =>
  ({
    schemaVersion: 1,
    sequence,
    timestamp: sequence,
    runtimeId: "runtime",
    type: "scheduler.requested",
    operation: "scheduler",
    ...extra,
  }) as unknown as GraphDiagnosticEvent;

describe("diagnostic event construction", () => {
  const capture = () => {
    const events: GraphDiagnosticEvent[] = [];
    const emitter = createRuntimeDiagnosticEmitter({
      sink: { emit: (emitted) => events.push(emitted) },
      environment: { now: () => 1234, createRuntimeId: () => "runtime-under-test" },
    });
    return { events, emitter };
  };

  it("puts the envelope first, in order, followed by the input fields", () => {
    const { events, emitter } = capture();

    emitter.emit({ type: "runtime.created", nodeKeys: ["a", "b"] });

    expect(Object.keys(events[0]!)).toEqual([
      "schemaVersion",
      "sequence",
      "timestamp",
      "runtimeId",
      "type",
      "nodeKeys",
    ]);
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 1,
      timestamp: 1234,
      runtimeId: "runtime-under-test",
      type: "runtime.created",
    });
  });

  it("numbers events in sequence", () => {
    const { events, emitter } = capture();

    emitter.emit({ type: "runtime.created", nodeKeys: [] });
    emitter.emit({ type: "runtime.created", nodeKeys: [] });

    expect(events.map((emitted) => emitted.sequence)).toEqual([1, 2]);
  });

  it("freezes events and copies arrays so the caller cannot change them afterwards", () => {
    const { events, emitter } = capture();
    const nodeKeys = ["a", "b"];

    emitter.emit({ type: "runtime.created", nodeKeys });
    nodeKeys.push("c");
    const emitted = events[0] as GraphDiagnosticEvent & { nodeKeys: readonly string[] };

    expect(emitted.nodeKeys).toEqual(["a", "b"]);
    expect(emitted.nodeKeys).not.toBe(nodeKeys);
    expect(Object.isFrozen(emitted)).toBe(true);
    expect(Object.isFrozen(emitted.nodeKeys)).toBe(true);
  });

  it("freezes a nested error object", () => {
    const { events, emitter } = capture();

    emitter.emit({
      type: "runtime.listener-failed",
      error: emitter.toError(new Error("boom")),
    });

    expect(Object.isFrozen((events[0] as { error: object }).error)).toBe(true);
  });

  it("never lets a throwing sink affect the caller", () => {
    const emitter = createRuntimeDiagnosticEmitter({
      sink: {
        emit: () => {
          throw new Error("sink exploded");
        },
      },
    });

    expect(() => emitter.emit({ type: "runtime.created", nodeKeys: [] })).not.toThrow();
  });
});

describe("in-memory retention", () => {
  it("keeps the newest events, in order, across repeated wraparound", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 3 });

    for (let sequence = 1; sequence <= 8; sequence += 1) collector.emit(event(sequence));

    expect(collector.getEvents().map((retained) => retained.sequence)).toEqual([6, 7, 8]);
    expect(collector.getMetrics().droppedEventCount).toBe(5);
  });

  it("returns the right order at every fill level up to and past capacity", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 4 });
    const seen: number[][] = [];

    for (let sequence = 1; sequence <= 10; sequence += 1) {
      collector.emit(event(sequence));
      seen.push(collector.getEvents().map((retained) => retained.sequence));
    }

    expect(seen[0]).toEqual([1]);
    expect(seen[3]).toEqual([1, 2, 3, 4]);
    expect(seen[4]).toEqual([2, 3, 4, 5]);
    expect(seen[9]).toEqual([7, 8, 9, 10]);
  });

  it("works with a capacity of one", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 1 });

    collector.emit(event(1));
    collector.emit(event(2));
    collector.emit(event(3));

    expect(collector.getEvents().map((retained) => retained.sequence)).toEqual([3]);
    expect(collector.getMetrics().droppedEventCount).toBe(2);
  });

  it("returns a snapshot that later events do not change", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 2 });
    collector.emit(event(1));
    collector.emit(event(2));
    const snapshot = collector.getEvents();

    collector.emit(event(3));

    expect(snapshot.map((retained) => retained.sequence)).toEqual([1, 2]);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("starts filling from the beginning again after a reset that follows a wraparound", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 3 });
    for (let sequence = 1; sequence <= 5; sequence += 1) collector.emit(event(sequence));

    collector.reset();
    collector.emit(event(10));
    collector.emit(event(11));

    expect(collector.getEvents().map((retained) => retained.sequence)).toEqual([10, 11]);
    expect(collector.getMetrics().droppedEventCount).toBe(0);
  });

  it("keeps an already-frozen event as it is", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 5 });
    const frozen = Object.freeze({
      ...event(1),
      nodeKeys: Object.freeze(["a"]),
    }) as GraphDiagnosticEvent;

    collector.emit(frozen);

    expect(collector.getEvents()[0]).toBe(frozen);
  });

  it("copies and freezes an event that is not frozen, without touching the original", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 5 });
    const nodeKeys = ["a"];
    const loose = event(1, { nodeKeys });

    collector.emit(loose);
    nodeKeys.push("b");
    const retained = collector.getEvents()[0] as GraphDiagnosticEvent & {
      nodeKeys: readonly string[];
    };

    expect(retained).not.toBe(loose);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(retained.nodeKeys).toEqual(["a"]);
    expect(Object.isFrozen(retained.nodeKeys)).toBe(true);
    expect(Object.isFrozen(loose)).toBe(false);
  });

  it("copies a frozen event whose nested array is not frozen", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 5 });
    const nodeKeys = ["a"];
    const half = Object.freeze(event(1, { nodeKeys }));

    collector.emit(half);
    nodeKeys.push("b");
    const retained = collector.getEvents()[0] as GraphDiagnosticEvent & {
      nodeKeys: readonly string[];
    };

    expect(retained.nodeKeys).toEqual(["a"]);
    expect(Object.isFrozen(retained.nodeKeys)).toBe(true);
  });
});

describe("execution diagnostics when diagnostics are disabled", () => {
  const node = defineDataNode({ key: "n", initialValue: 0, load: async () => 1 });
  const context = { operationId: "op", reason: "subscription" } as const;

  const disabledEmitter = () => {
    const emit = vi.fn();
    const now = vi.fn(() => 0);
    const toError = vi.fn();
    return {
      emitter: { emit, now, toError, isEnabled: false } as unknown as Parameters<
        typeof emitExecution
      >[0],
      emit,
      now,
      toError,
    };
  };

  it("does no timing and emits nothing", () => {
    const { emitter, emit, now } = disabledEmitter();

    const attempt = beginExecutionDiagnostics(emitter, node, 1, "scheduler", context);
    attempt.queued();
    attempt.started();
    attempt.succeeded();
    attempt.failed(new Error("x"));
    attempt.obsolete(true);

    expect(now).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("emitExecution skips building the event", () => {
    const { emitter, emit, toError } = disabledEmitter();

    emitExecution(emitter, "node.load.failed", node, 1, "scheduler", context, {
      error: new Error("x"),
    });

    expect(emit).not.toHaveBeenCalled();
    expect(toError).not.toHaveBeenCalled();
  });

  it("still emits the full lifecycle when diagnostics are enabled", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 100 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      diagnostics: { sink: collector },
    });

    await runtime.execute([node]);

    const types = collector.getEvents().map((retained) => retained.type);
    expect(types).toContain("node.load.started");
    expect(types).toContain("node.load.succeeded");
    runtime.shutdown();
  });
});
