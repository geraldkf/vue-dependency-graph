import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineEvent,
  defineMutation,
  normalizeDiagnosticEvents,
} from "../../src/core";

describe("observability regression", () => {
  it("preserves a complete causal trace across core runtime capabilities", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 200 });
    let now = 0;
    const changed = defineEvent<void>("changed");
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      invalidatedBy: [changed],
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const save = defineMutation({
      key: "save",
      execute: async () => "saved",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }), {
      diagnostics: {
        sink: collector,
        environment: {
          now: () => ++now,
          createRuntimeId: () => "regression-runtime",
        },
      },
    });

    const subscription = runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    runtime.setContext(context, 2);
    await runtime.whenSettled();
    runtime.publish(changed, undefined);
    await runtime.whenSettled();
    await runtime.transaction((transaction) => {
      transaction.setContext(context, 3);
      transaction.publish(changed, undefined);
    });
    await runtime.whenSettled();
    await runtime.mutate(save, undefined);
    subscription.unsubscribe();

    const events = normalizeDiagnosticEvents(collector.getEvents());
    const types = events.map((event) => event.type);

    expect(types).toEqual(
      expect.arrayContaining([
        "runtime.created",
        "subscription.added",
        "scheduler.requested",
        "scheduler.started",
        "node.load.started",
        "node.load.succeeded",
        "context.changed",
        "node.invalidated",
        "event.published",
        "event.matched",
        "transaction.started",
        "transaction.committed",
        "mutation.started",
        "mutation.remote-started",
        "mutation.remote-succeeded",
        "mutation.success-committed",
        "mutation.completed",
        "subscription.removed",
      ]),
    );

    const schedulerLoads = events.filter(
      (event) => event.type === "node.load.started" && event.origin === "scheduler",
    );
    expect(schedulerLoads.length).toBeGreaterThanOrEqual(3);
    expect(schedulerLoads.every((event) => event.operationId !== undefined)).toBe(true);

    const schedulerStarts = new Map(
      events
        .filter((event) => event.type === "scheduler.started")
        .map((event) => [event.operationId, event.causeId] as const),
    );
    expect(
      schedulerLoads.every((event) => event.causeId === schedulerStarts.get(event.operationId)),
    ).toBe(true);

    expect(events.filter((event) => event.type === "transaction.committed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "mutation.completed")).toEqual([
      expect.objectContaining({ outcome: "succeeded" }),
    ]);
  });
});
