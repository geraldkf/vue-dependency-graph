import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  type GraphDiagnosticEvent,
} from "../../src/core";

describe("diagnostic snapshots", () => {
  it("omits values by default and supports explicit inclusion and typed redaction", () => {
    const omitted = defineContextNode({ key: "omitted", initialValue: { secret: "hidden" } });
    const included = defineContextNode({
      key: "included",
      initialValue: { visible: "allowed" },
      diagnostics: { value: "include" },
    });
    const redacted = defineContextNode({
      key: "redacted",
      initialValue: { name: "Gerald", secret: "hidden" },
      diagnostics: { value: value => ({ name: value.name }) },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [omitted, included, redacted] }));

    const snapshot = runtime.createDiagnosticSnapshot();

    expect(snapshot.nodes.map(node => node.value)).toEqual([
      { status: "omitted" },
      { status: "included", data: { visible: "allowed" } },
      { status: "redacted", data: { name: "Gerald" } },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("hidden");
  });

  it("isolates redactor and unsafe serialisation failures", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const included = defineContextNode({
      key: "cyclic",
      initialValue: cyclic,
      diagnostics: { value: "include" },
    });
    const failed = defineContextNode({
      key: "failed",
      initialValue: "secret",
      diagnostics: { value: () => { throw new Error("redactor failed"); } },
    });
    const unsafe = defineContextNode({
      key: "unsafe",
      initialValue: "secret",
      diagnostics: { value: () => cyclic },
    });
    const snapshot = createGraphRuntime(
      createGraph({ nodes: [included, failed, unsafe] }),
    ).createDiagnosticSnapshot();

    expect(snapshot.nodes[0]?.value).toEqual({ status: "omitted" });
    expect(snapshot.nodes[1]?.value).toMatchObject({
      status: "redaction-failed",
      error: { message: "redactor failed" },
    });
    expect(snapshot.nodes[2]?.value).toMatchObject({
      status: "redaction-failed",
      error: { name: "DiagnosticValueSerializationError" },
    });
  });

  it("serialises bounded cyclic error causes", async () => {
    const first = new Error("first");
    const second = new Error("second", { cause: first });
    Object.defineProperty(first, "cause", { value: second });
    const node = defineDataNode({
      key: "failure",
      initialValue: 0,
      load: async () => Promise.reject(first),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));

    await expect(runtime.execute([node])).rejects.toThrow();
    const snapshot = runtime.createDiagnosticSnapshot();

    expect(snapshot.nodes[0]?.error).toMatchObject({
      message: "first",
      cause: { message: "second", cause: { truncated: true } },
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it("includes deterministic runtime, collector, and subscription state without side effects", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 100 });
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const events: GraphDiagnosticEvent[] = [];
    const sink = {
      emit: (event: GraphDiagnosticEvent) => {
        collector.emit(event);
        events.push(event);
      },
      getEvents: collector.getEvents,
      getMetrics: collector.getMetrics,
    };
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }), {
      diagnostics: {
        sink,
        environment: { now: () => 10, createRuntimeId: () => "snapshot-runtime" },
      },
    });
    const subscription = runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    let notifications = 0;
    runtime.onChange(() => { notifications += 1; });
    const eventCount = events.length;

    const snapshot = runtime.createDiagnosticSnapshot();

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      createdAt: 10,
      runtimeId: "snapshot-runtime",
      diagnostics: { retainedEventCount: eventCount, droppedEventCount: 0 },
      scheduler: { isScheduled: false, isRunning: false, error: null },
    });
    expect(snapshot.topology.map(node => node.key)).toEqual(["data", "context"]);
    expect(snapshot.nodes.map(node => node.key)).toEqual(["data", "context"]);
    expect(snapshot.subscriptions).toEqual([
      { key: "data", direct: 1, required: 0, total: 1 },
      { key: "context", direct: 0, required: 1, total: 1 },
    ]);
    expect(snapshot.metrics).toEqual(collector.getMetrics());
    expect(events).toHaveLength(eventCount);
    expect(notifications).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nodes)).toBe(true);
    subscription.unsubscribe();
  });
});
