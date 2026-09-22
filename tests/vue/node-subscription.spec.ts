import { describe, expect, it } from "vitest";
import { createGraph, createGraphRuntime, defineContextNode, defineDataNode } from "../../src/core";
import { createNodeSubscription } from "../../src/vue/node-subscription";

describe("createNodeSubscription", () => {
  it("subscribes to the node on creation", () => {
    const context = defineContextNode({ key: "ctx-b1", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    expect(runtime.getSubscriptionState(context).direct).toBe(0);
    const { dispose } = createNodeSubscription(runtime, context);
    expect(runtime.getSubscriptionState(context).direct).toBe(1);
    dispose();
  });

  it("updates state when the node's state actually changes", async () => {
    const context = defineContextNode({ key: "ctx-b2", initialValue: 1 });
    const data = defineDataNode({
      key: "data-b2",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));

    const { state, dispose } = createNodeSubscription(runtime, data);
    await runtime.whenSettled();
    expect(state.value.data).toBe(1);

    runtime.setContext(context, 2);
    await runtime.whenSettled();
    expect(state.value.data).toBe(2);

    dispose();
  });

  it("does not replace the ref when an unrelated node changes", async () => {
    const contextA = defineContextNode({ key: "ctx-b3a", initialValue: 1 });
    const contextB = defineContextNode({ key: "ctx-b3b", initialValue: 100 });
    const dataA = defineDataNode({
      key: "data-b3a",
      dependencies: [contextA] as const,
      initialValue: 0,
      load: async ({ get }) => get(contextA),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [contextA, contextB, dataA] }));

    const { state, dispose } = createNodeSubscription(runtime, dataA);
    await runtime.whenSettled();

    const observedBeforeUnrelatedChange = state.value;
    runtime.setContext(contextB, 200); // unrelated to dataA
    await runtime.whenSettled();

    // Same reference, not just an equal-looking value — proves the
    // dirty-check actually prevented a needless replacement, not just
    // that the two objects happen to look alike.
    expect(state.value).toBe(observedBeforeUnrelatedChange);

    dispose();
  });

  it("dispose releases the subscription and stops syncing", async () => {
    const context = defineContextNode({ key: "ctx-b4", initialValue: 1 });
    const data = defineDataNode({
      key: "data-b4",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));

    const { state, dispose } = createNodeSubscription(runtime, data);
    await runtime.whenSettled();
    dispose();

    expect(runtime.getSubscriptionState(data).direct).toBe(0);

    const stateAtDispose = state.value;
    runtime.setContext(context, 2);
    await runtime.whenSettled();

    // No subscriber left after dispose, so this ref must never be
    // touched again regardless of what happens to the node afterward.
    expect(state.value).toBe(stateAtDispose);
  });

  it("dispose is safe to call more than once", () => {
    const context = defineContextNode({ key: "ctx-b5", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const { dispose } = createNodeSubscription(runtime, context);
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });
});
