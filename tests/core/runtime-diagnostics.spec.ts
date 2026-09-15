import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineQuery,
  type GraphDiagnosticEvent,
  type GraphDiagnosticSink,
  type GraphDiagnosticsEnvironment,
} from "../../src/core";

const createEnvironment = (
  runtimeId: string,
  timestamps: readonly number[],
): GraphDiagnosticsEnvironment => {
  let timestampIndex = 0;
  return {
    now: () => timestamps[timestampIndex++] ?? -1,
    createRuntimeId: () => runtimeId,
  };
};

const createFixture = () => {
  const context = defineContextNode({ key: "context", initialValue: 1 });
  const data = defineDataNode({
    key: "data",
    dependencies: [context] as const,
    initialValue: "",
    load: async ({ get }) => String(get(context)),
  });
  const query = defineQuery({
    key: "page",
    nodes: { context, data },
  });
  return {
    context,
    data,
    query,
    graph: createGraph({ nodes: [data, context] }),
  };
};

describe("runtime diagnostics foundation", () => {
  it("emits immutable runtime and operation records in sequence order", async () => {
    const fixture = createFixture();
    const events: GraphDiagnosticEvent[] = [];
    const runtime = createGraphRuntime(fixture.graph, {
      diagnostics: {
        sink: { emit: event => events.push(event) },
        environment: createEnvironment("test-runtime", [10, 20, 30, 40, 50, 60]),
      },
    });

    await runtime.execute([]);
    await runtime.prefetch([]);
    await runtime.refresh([]);
    await runtime.prefetchQuery(fixture.query);
    await runtime.refreshQuery(fixture.query);

    const foundationEvents = events.filter((event) =>
      event.type === "runtime.created" || event.type.startsWith("operation."),
    );
    expect(foundationEvents.map(event => event.type)).toEqual([
      "runtime.created",
      "operation.execute.requested",
      "operation.prefetch.requested",
      "operation.refresh.requested",
      "operation.query-prefetch.requested",
      "operation.query-refresh.requested",
    ]);
    expect(foundationEvents.map(event => event.sequence)).toEqual(
      [...foundationEvents.map(event => event.sequence)].sort((left, right) => left - right),
    );
    expect(events.every(event => event.runtimeId === "test-runtime")).toBe(true);
    expect(events.every(Object.isFrozen)).toBe(true);

    const created = events[0];
    expect(created?.type).toBe("runtime.created");
    if (created?.type !== "runtime.created") return;
    expect(created.nodeKeys).toEqual(["data", "context"]);
    expect(Object.isFrozen(created.nodeKeys)).toBe(true);

    const queryPrefetch = foundationEvents[4];
    expect(queryPrefetch?.type).toBe("operation.query-prefetch.requested");
    if (queryPrefetch?.type !== "operation.query-prefetch.requested") return;
    expect(queryPrefetch).toMatchObject({
      operationId: "test-runtime:operation-4",
      operation: "query-prefetch",
      nodeKeys: ["context", "data"],
      queryKey: "page",
    });
    expect(Object.isFrozen(queryPrefetch.nodeKeys)).toBe(true);
  });

  it("keeps sequence and operation counters independent between runtimes", async () => {
    const fixture = createFixture();
    const firstEvents: GraphDiagnosticEvent[] = [];
    const secondEvents: GraphDiagnosticEvent[] = [];
    const first = createGraphRuntime(fixture.graph, {
      diagnostics: {
        sink: { emit: event => firstEvents.push(event) },
        environment: createEnvironment("first", [1, 2]),
      },
    });
    const second = createGraphRuntime(fixture.graph, {
      diagnostics: {
        sink: { emit: event => secondEvents.push(event) },
        environment: createEnvironment("second", [1, 2]),
      },
    });

    await first.execute([]);
    await second.execute([]);

    expect(firstEvents.map(event => event.sequence)).toEqual([1, 2]);
    expect(secondEvents.map(event => event.sequence)).toEqual([1, 2]);
    expect(firstEvents[1]?.operationId).toBe("first:operation-1");
    expect(secondEvents[1]?.operationId).toBe("second:operation-1");
  });

  it("does not report a runtime as created when construction fails", () => {
    const events: GraphDiagnosticEvent[] = [];

    expect(() =>
      createGraphRuntime(createGraph({ nodes: [] }), {
        maxConcurrentLoads: 0,
        diagnostics: {
          sink: { emit: event => events.push(event) },
          environment: createEnvironment("invalid", [1]),
        },
      })
    ).toThrow("maxConcurrent must be at least 1");

    expect(events).toEqual([]);
  });

  it("isolates sink failures from runtime creation and operations", async () => {
    const fixture = createFixture();
    const sink: GraphDiagnosticSink = {
      emit: () => {
        throw new Error("sink failed");
      },
    };

    const runtime = createGraphRuntime(fixture.graph, {
      diagnostics: {
        sink,
        environment: createEnvironment("failing", [1, 2]),
      },
    });

    await expect(runtime.execute([])).resolves.toBeUndefined();
    expect(runtime.getState(fixture.context).data).toBe(1);
  });

  it("does not create a diagnostics environment when no sink is configured", async () => {
    const fixture = createFixture();
    let environmentCalls = 0;
    const runtime = createGraphRuntime(fixture.graph, {
      diagnostics: {
        environment: {
          now: () => {
            environmentCalls += 1;
            return 1;
          },
          createRuntimeId: () => {
            environmentCalls += 1;
            return "unused";
          },
        },
      },
    });

    await runtime.execute([]);

    expect(environmentCalls).toBe(0);
  });
});
