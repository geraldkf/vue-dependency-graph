import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  type GraphDiagnosticEvent,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const createDiagnostics = () => {
  const events: GraphDiagnosticEvent[] = [];
  let now = 0;
  return {
    events,
    options: {
      sink: { emit: (event: GraphDiagnosticEvent) => events.push(event) },
      environment: {
        now: () => ++now,
        createRuntimeId: () => "trace",
      },
    },
  };
};

const eventTypes = (events: readonly GraphDiagnosticEvent[]) => events.map((event) => event.type);

describe("runtime diagnostic causality", () => {
  it("traces explicit dependency execution, fresh skips, and active reuse", async () => {
    const gate = deferred<string>();
    const parent = defineDataNode({
      key: "parent",
      initialValue: "",
      load: () => gate.promise,
    });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent).length,
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [child, parent] }), {
      diagnostics: diagnostics.options,
    });

    const first = runtime.execute([child]);
    await waitForCondition(
      () => eventTypes(diagnostics.events).includes("node.load.started"),
      "parent load to start",
    );
    const second = runtime.execute([parent]);
    gate.resolve("ready");
    await Promise.all([first, second]);
    await runtime.execute([child]);

    const parentStarted = diagnostics.events.find((event) => event.type === "node.load.started");
    expect(parentStarted).toMatchObject({
      nodeKey: "parent",
      reason: "dependency",
      origin: "explicit",
    });
    expect(
      diagnostics.events.some(
        (event) => event.type === "node.execution.reused" && event.nodeKey === "parent",
      ),
    ).toBe(true);
    expect(
      diagnostics.events.flatMap((event) =>
        event.type === "node.execution.skipped" ? [event.nodeKey] : [],
      ),
    ).toEqual(["parent", "child"]);

    const firstRequest = diagnostics.events.find(
      (event) => event.type === "operation.execute.requested",
    );
    expect(parentStarted?.operationId).toBe(firstRequest?.operationId);
  });

  it("traces subscription scheduling and context invalidation reloads", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: "",
      load: async ({ get }) => String(get(context)),
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }), {
      diagnostics: diagnostics.options,
    });

    const subscription = runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    runtime.setContext(context, 2);
    await runtime.whenSettled();
    subscription.unsubscribe();

    expect(eventTypes(diagnostics.events)).toEqual(
      expect.arrayContaining([
        "subscription.added",
        "scheduler.requested",
        "scheduler.started",
        "node.load.started",
        "node.load.succeeded",
        "scheduler.completed",
        "context.changed",
        "node.invalidated",
        "subscription.removed",
      ]),
    );

    const contextChanged = diagnostics.events.find((event) => event.type === "context.changed");
    const invalidated = diagnostics.events.find(
      (event) => event.type === "node.invalidated" && event.reason === "context-invalidation",
    );
    expect(contextChanged).toMatchObject({
      contextKeys: ["context"],
      affectedNodeKeys: ["data"],
    });
    expect(invalidated).toMatchObject({
      rootNodeKeys: ["context"],
      affectedNodeKeys: ["data"],
      scheduled: true,
    });

    const scheduledReload = diagnostics.events.find(
      (event) => event.type === "node.load.started" && event.reason === "context-invalidation",
    );
    expect(scheduledReload).toBeDefined();
  });

  it("distinguishes queued and aborted data-node attempts", async () => {
    const firstGate = deferred<string>();
    const first = defineDataNode({
      key: "first",
      initialValue: "",
      load: () => firstGate.promise,
    });
    const second = defineDataNode({
      key: "second",
      initialValue: "",
      load: async ({ signal }) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
          resolve();
        });
        return "second";
      },
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }), {
      maxConcurrentLoads: 1,
      diagnostics: diagnostics.options,
    });

    const firstWork = runtime.execute([first]);
    await waitForCondition(
      () => diagnostics.events.some((event) => event.type === "node.load.started"),
      "first load to start",
    );
    const subscription = runtime.subscribeNodes([second]);
    await waitForCondition(
      () => diagnostics.events.some((event) => event.type === "node.load.queued"),
      "second load to queue",
    );
    subscription.unsubscribe();
    firstGate.resolve("first");
    await firstWork;
    await runtime.whenSettled();

    expect(
      diagnostics.events.some(
        (event) => event.type === "node.load.queued" && event.nodeKey === "second",
      ),
    ).toBe(true);
    expect(
      diagnostics.events.some(
        (event) => event.type === "node.load.aborted" && event.nodeKey === "second",
      ),
    ).toBe(true);
    expect(
      diagnostics.events.some(
        (event) => event.type === "node.load.started" && event.nodeKey === "second",
      ),
    ).toBe(false);
  });

  it("records failed loads and blocked descendants without changing failure behaviour", async () => {
    const failure = new Error("request failed");
    const parent = defineDataNode({
      key: "failing-parent",
      initialValue: "",
      load: async () => Promise.reject(failure),
    });
    const child = defineDerivedNode({
      key: "blocked-child",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent).length,
    });
    const diagnostics = createDiagnostics();
    const runtime = createGraphRuntime(createGraph({ nodes: [parent, child] }), {
      diagnostics: diagnostics.options,
    });

    await expect(runtime.execute([child])).rejects.toThrow("Graph execution failed for 2 node(s).");

    expect(diagnostics.events.find((event) => event.type === "node.load.failed")).toMatchObject({
      nodeKey: "failing-parent",
      error: { name: "Error", message: "request failed" },
    });
    expect(
      diagnostics.events.find((event) => event.type === "node.execution.blocked"),
    ).toMatchObject({
      nodeKey: "blocked-child",
      blockedBy: ["failing-parent"],
    });
  });
});
