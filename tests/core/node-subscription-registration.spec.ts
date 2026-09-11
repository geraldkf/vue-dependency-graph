import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("node subscription registration", () => {
  it("starts every node at zero subscription counts with independent runtime state", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({ key: "data", initialValue: "", load: async () => "value" });
    const derived = defineDerivedNode({ key: "derived", dependencies: [context] as const, derive: () => true });
    const graph = createGraph({ nodes: [derived, data, context] });
    const first = createGraphRuntime(graph);
    const second = createGraphRuntime(graph);

    for (const node of [context, data, derived]) {
      expect(first.getSubscriptionState(node)).toEqual({ direct: 0, required: 0, total: 0 });
      expect(first.hasSubscribers(node)).toBe(false);
      expect(Object.isFrozen(first.getSubscriptionState(node))).toBe(true);
    }

    first.subscribeNodes([data]);
    expect(first.hasSubscribers(data)).toBe(true);
    expect(second.hasSubscribers(data)).toBe(false);
  });

  it("supports direct subscriptions for all node kinds and separate subscriptions", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({ key: "data", initialValue: "", load: async () => "value" });
    const derived = defineDerivedNode({ key: "derived", dependencies: [] as const, derive: () => true });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, data, derived] }));

    const first = runtime.subscribeNodes([context, data, derived]);
    const second = runtime.subscribeNodes([data]);

    expect(runtime.getSubscriptionState(context)).toEqual({ direct: 1, required: 0, total: 1 });
    expect(runtime.getSubscriptionState(data)).toEqual({ direct: 2, required: 0, total: 2 });
    expect(runtime.getSubscriptionState(derived)).toEqual({ direct: 1, required: 0, total: 1 });

    second.unsubscribe();
    expect(runtime.getSubscriptionState(data).direct).toBe(1);
    first.unsubscribe();
    expect(runtime.hasSubscribers(data)).toBe(false);
  });

  it("does not execute synchronously when a subscription is created", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "initial", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    runtime.subscribeNodes([data]);

    expect(load).not.toHaveBeenCalled();
    expect(runtime.getState(data).status).toBe("idle");

    await runtime.whenSettled();
    expect(load).toHaveBeenCalledOnce();
    expect(runtime.getState(data).data).toBe("loaded");
  });

  it("returns independent frozen subscription snapshots", () => {
    const node = defineContextNode({ key: "node", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));

    const before = runtime.getSubscriptionState(node);
    const subscription = runtime.subscribeNodes([node]);
    const after = runtime.getSubscriptionState(node);

    expect(before.total).toBe(0);
    expect(after.total).toBe(1);
    expect(before).not.toBe(after);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(after)).toBe(true);

    subscription.unsubscribe();
  });

});
