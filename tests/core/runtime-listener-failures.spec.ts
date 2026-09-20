import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  normalizeDiagnosticEvents,
  refreshInterval,
  type GraphDiagnosticEvent,
  type GraphRuntimeListenerFailedDiagnosticEvent,
  type TimerEnvironment,
} from "../../src/core";
import { waitForCondition } from "./test-helpers";

const listenerFailures = (
  events: readonly GraphDiagnosticEvent[],
): readonly GraphRuntimeListenerFailedDiagnosticEvent[] =>
  events.filter(
    (event): event is GraphRuntimeListenerFailedDiagnosticEvent =>
      event.type === "runtime.listener-failed",
  );

const build = () => {
  const collector = createInMemoryGraphDiagnostics({ capacity: 200 });
  const context = defineContextNode({ key: "context", initialValue: 1 });
  const runtime = createGraphRuntime(createGraph({ nodes: [context] }), {
    diagnostics: { sink: collector },
  });
  return { collector, context, runtime };
};

describe("runtime.listener-failed diagnostics", () => {
  it("reports a throwing onChange listener and still runs the others", () => {
    const { collector, context, runtime } = build();
    const healthy = vi.fn();
    runtime.onChange(() => {
      throw new Error("listener boom");
    });
    runtime.onChange(healthy);

    expect(() => runtime.setContext(context, 2)).not.toThrow();

    expect(healthy).toHaveBeenCalledOnce();
    expect(runtime.getState(context).data).toBe(2);
    const [failure] = listenerFailures(collector.getEvents());
    expect(failure).toMatchObject({
      type: "runtime.listener-failed",
      error: { name: "Error", message: "listener boom" },
    });
  });

  it("attributes the failure to the operation being committed", () => {
    const { collector, context, runtime } = build();
    runtime.onChange(() => {
      throw new Error("listener boom");
    });

    runtime.setContext(context, 2);

    const events = collector.getEvents();
    const changed = events.find(event => event.type === "context.changed");
    const [failure] = listenerFailures(events);
    expect(changed?.operationId).toBeTruthy();
    expect(failure?.operationId).toBe(changed?.operationId);
  });

  it("reports a thrown non-Error as an error with its text", () => {
    const { collector, context, runtime } = build();
    runtime.onChange(() => {
      throw "plain string";
    });

    runtime.setContext(context, 2);

    const [failure] = listenerFailures(collector.getEvents());
    expect(failure?.error.message).toContain("plain string");
  });

  it("emits one event per failing notification", () => {
    const { collector, context, runtime } = build();
    runtime.onChange(() => {
      throw new Error("listener boom");
    });

    runtime.setContext(context, 2);
    runtime.setContext(context, 3);

    expect(listenerFailures(collector.getEvents())).toHaveLength(2);
  });

  it("stays silent, and still isolates, when diagnostics are disabled", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const healthy = vi.fn();
    runtime.onChange(() => {
      throw new Error("listener boom");
    });
    runtime.onChange(healthy);

    expect(() => runtime.setContext(context, 2)).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
  });

  it("reports a failure inside a background policy, which listens the same way", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 200 });
    let now = 0;
    let setTimeoutCalls = 0;
    const environment: TimerEnvironment = {
      now: () => now,
      // The first attempt to arm a timer fails, as a broken environment would.
      setTimeout: () => {
        setTimeoutCalls += 1;
        if (setTimeoutCalls === 1) throw new Error("timer boom");
        return setTimeoutCalls;
      },
      clearTimeout: () => undefined,
      random: () => 0.5,
      isPaused: () => false,
      onPauseChange: () => () => undefined,
    };
    const node = defineDataNode({
      key: "polled",
      initialValue: 0,
      load: async () => {
        now += 1;
        return 7;
      },
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: environment,
      diagnostics: { sink: collector },
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    await waitForCondition(
      () => listenerFailures(collector.getEvents()).length > 0,
      "the policy failure to be reported",
    );

    // The failure is visible, and the runtime carried on: the node loaded.
    expect(runtime.getState(node)).toMatchObject({
      status: "success",
      data: 7,
    });
    expect(listenerFailures(collector.getEvents())[0]?.error.message).toBe(
      "timer boom",
    );
    subscription.unsubscribe();
  });

  it("normalises like any other event", () => {
    const { collector, context, runtime } = build();
    runtime.onChange(() => {
      throw new Error("listener boom");
    });
    runtime.setContext(context, 2);

    const events = normalizeDiagnosticEvents(collector.getEvents());

    expect(listenerFailures(events)).toHaveLength(1);
  });
});
