import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDerivedNode,
} from "../../src/core";

describe("node subscription lifecycle", () => {
  it("releases exactly one subscription and is idempotent", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const child = defineDerivedNode({ key: "child", dependencies: [root] as const, derive: () => 2 });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, root] }));
    const first = runtime.subscribeNodes([child]);
    const second = runtime.subscribeNodes([child]);

    first.unsubscribe();
    first.unsubscribe();
    expect(runtime.getSubscriptionState(child).direct).toBe(1);
    expect(runtime.getSubscriptionState(root).required).toBe(1);

    second.unsubscribe();
    expect(runtime.getSubscriptionState(child).total).toBe(0);
    expect(runtime.getSubscriptionState(root).total).toBe(0);
  });

  it("supports an empty no-op subscription without notification", () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    const subscription = runtime.subscribeNodes([]);
    expect(subscription.nodes).toEqual([]);
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("validates all targets before applying subscription", () => {
    const registered = defineContextNode({ key: "registered", initialValue: 1 });
    const missing = defineContextNode({ key: "missing", initialValue: 2 });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    expect(() => runtime.subscribeNodes([registered, missing])).toThrow("missing");
    expect(runtime.getSubscriptionState(registered).total).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("resolves a different handle through its registered key", () => {
    const registered = defineContextNode({ key: "shared", initialValue: 1 });
    const equivalent = defineContextNode({ key: "shared", initialValue: 99 });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    const subscription = runtime.subscribeNodes([equivalent]);
    expect(subscription.nodes).toEqual([registered]);
    expect(runtime.getSubscriptionState(equivalent).direct).toBe(1);
  });

  it("notifies once for add and active release while isolating listener failures", () => {
    const node = defineContextNode({ key: "node", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    const observed: number[] = [];
    runtime.onChange(() => { throw new Error("listener failure"); });
    runtime.onChange(() => observed.push(runtime.getSubscriptionState(node).total));

    const subscription = runtime.subscribeNodes([node, node]);
    subscription.unsubscribe();
    subscription.unsubscribe();

    expect(observed[0]).toBe(1);
    expect(observed[observed.length - 1]).toBe(0);
  });
});
