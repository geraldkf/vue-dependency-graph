import { describe, expect, it, vi } from "vitest";
import {
  GraphRuntimeShutdownError,
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  type AnyNodeDefinition,
  type NodeRuntimeState,
} from "../../src/core";

const build = () => {
  const a = defineContextNode({ key: "observer.a", initialValue: 0 });
  const b = defineContextNode({ key: "observer.b", initialValue: 0 });
  const doubledA = defineDerivedNode({
    key: "observer.doubledA",
    dependencies: [a],
    derive: ({ get }) => get(a) * 2,
  });
  const loadedB = defineDataNode({
    key: "observer.loadedB",
    dependencies: [b],
    initialValue: -1,
    load: async ({ get }) => get(b) + 100,
  });
  const graph = createGraph({ nodes: [a, b, doubledA, loadedB] });
  return { a, b, doubledA, loadedB, graph };
};

describe("runtime.onNodeChange", () => {
  it("calls only the listener of the node whose state changed", () => {
    const { a, b, graph } = build();
    const runtime = createGraphRuntime(graph);
    const onA = vi.fn();
    const onB = vi.fn();
    runtime.onNodeChange(a, onA);
    runtime.onNodeChange(b, onB);

    runtime.setContext(a, 1);

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it("is not called for changes that are not this node's state", () => {
    const { a, b, graph } = build();
    const runtime = createGraphRuntime(graph);
    const onA = vi.fn();
    runtime.onNodeChange(a, onA);

    runtime.setContext(b, 1);
    runtime.subscribeNodes([a]); // a subscription change is not a state change

    expect(onA).not.toHaveBeenCalled();
  });

  it("reads the latest state when called", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const seen: unknown[] = [];
    runtime.onNodeChange(a, () => seen.push(runtime.getState(a).data));

    runtime.setContext(a, 7);

    expect(seen).toEqual([7]);
  });

  it("reports a derived node whose upstream changed, through each state it passes", async () => {
    const { a, doubledA, graph } = build();
    const runtime = createGraphRuntime(graph);
    const subscription = runtime.subscribeNodes([doubledA]);
    await runtime.whenSettled();
    const seen: string[] = [];
    runtime.onNodeChange(doubledA, () => {
      const state = runtime.getState(doubledA);
      seen.push(`${state.status}/${state.freshness}/${String(state.data)}`);
    });

    runtime.setContext(a, 3);
    await runtime.whenSettled();

    expect(seen[0]).toBe("success/stale/0");
    expect(seen.at(-1)).toBe("success/fresh/6");
    subscription.unsubscribe();
  });

  it("runs after the global listeners", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const order: string[] = [];
    runtime.onNodeChange(a, () => order.push("node"));
    runtime.onChange(() => order.push("global"));

    runtime.setContext(a, 1);

    expect(order).toEqual(["global", "node"]);
  });

  it("stops after unsubscribe, which is idempotent", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const listener = vi.fn();
    const stop = runtime.onNodeChange(a, listener);

    stop();
    stop();
    runtime.setContext(a, 1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not replay changes made while no one was listening", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const stop = runtime.onNodeChange(a, () => undefined);
    stop();
    runtime.setContext(a, 1);

    const listener = vi.fn();
    runtime.onNodeChange(a, listener);

    expect(listener).not.toHaveBeenCalled();
    runtime.setContext(a, 2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports several listeners on one node and removing one of them", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = runtime.onNodeChange(a, first);
    runtime.onNodeChange(a, second);

    runtime.setContext(a, 1);
    stopFirst();
    runtime.setContext(a, 2);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("does not call a listener removed earlier in the same dispatch", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const second = vi.fn();
    let stopSecond: () => void = () => undefined;
    runtime.onNodeChange(a, () => stopSecond());
    stopSecond = runtime.onNodeChange(a, second);

    runtime.setContext(a, 1);

    expect(second).not.toHaveBeenCalled();
  });

  it("isolates a throwing listener and reports it as a diagnostic", () => {
    const { a, graph } = build();
    const collector = createInMemoryGraphDiagnostics({ capacity: 100 });
    const runtime = createGraphRuntime(graph, { diagnostics: { sink: collector } });
    const after = vi.fn();
    runtime.onNodeChange(a, () => {
      throw new Error("listener exploded");
    });
    runtime.onNodeChange(a, after);

    expect(() => runtime.setContext(a, 1)).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    const failure = collector.getEvents().find((event) => event.type === "runtime.listener-failed");
    expect(failure).toMatchObject({ error: { message: "listener exploded" } });
  });

  it("allows a listener to change another node, without recursion problems", () => {
    const { a, b, graph } = build();
    const runtime = createGraphRuntime(graph);
    const onB = vi.fn();
    runtime.onNodeChange(b, onB);
    runtime.onNodeChange(a, () => runtime.setContext(b, runtime.getState(a).data as number));

    runtime.setContext(a, 5);

    expect(runtime.getState(b).data).toBe(5);
    expect(onB).toHaveBeenCalledTimes(1);
  });

  it("rejects a node that is not registered in the graph", () => {
    const { graph } = build();
    const runtime = createGraphRuntime(graph);
    const stranger = defineContextNode({ key: "observer.stranger", initialValue: 0 });

    expect(() => runtime.onNodeChange(stranger, () => undefined)).toThrow(/not registered/);
  });

  it("rejects new listeners after shutdown and keeps old unsubscribes safe", () => {
    const { a, graph } = build();
    const runtime = createGraphRuntime(graph);
    const listener = vi.fn();
    const stop = runtime.onNodeChange(a, listener);

    runtime.shutdown();

    expect(() => runtime.onNodeChange(a, () => undefined)).toThrow(GraphRuntimeShutdownError);
    expect(() => stop()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("mirrors every node exactly, through a mixed sequence of operations", async () => {
    const { a, b, doubledA, loadedB, graph } = build();
    const runtime = createGraphRuntime(graph);
    const nodes: readonly AnyNodeDefinition[] = [a, b, doubledA, loadedB];
    const mirror = new Map<string, NodeRuntimeState<unknown>>();
    for (const node of nodes) {
      mirror.set(node.key, runtime.getState(node));
      runtime.onNodeChange(node, () => mirror.set(node.key, runtime.getState(node)));
    }
    const expectMirrorMatches = (): void => {
      for (const node of nodes) expect(mirror.get(node.key)).toEqual(runtime.getState(node));
    };

    const subscription = runtime.subscribeNodes([doubledA, loadedB]);
    await runtime.whenSettled();
    expectMirrorMatches();

    runtime.setContext(a, 1);
    await runtime.whenSettled();
    expectMirrorMatches();

    await runtime.transaction((transaction) => {
      transaction.setContext(a, 2);
      transaction.setContext(b, 2);
    });
    await runtime.whenSettled();
    expectMirrorMatches();

    await runtime.refresh([loadedB]);
    expectMirrorMatches();

    subscription.unsubscribe();
    runtime.setContext(b, 9);
    await runtime.whenSettled();
    expectMirrorMatches();
    expect(runtime.getState(loadedB).freshness).toBe("stale");
  });
});
