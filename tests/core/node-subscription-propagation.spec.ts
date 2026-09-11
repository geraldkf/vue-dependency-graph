import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDerivedNode,
} from "../../src/core";

describe("node node subscription propagation", () => {
  it("propagates required subscription through transitive ancestors", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const parent = defineDerivedNode({ key: "parent", dependencies: [root] as const, derive: () => 2 });
    const child = defineDerivedNode({ key: "child", dependencies: [parent] as const, derive: () => 3 });
    const unrelated = defineContextNode({ key: "unrelated", initialValue: 4 });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, unrelated, parent, root] }));

    runtime.subscribeNodes([child]);

    expect(runtime.getSubscriptionState(child)).toEqual({ direct: 1, required: 0, total: 1 });
    expect(runtime.getSubscriptionState(parent)).toEqual({ direct: 0, required: 1, total: 1 });
    expect(runtime.getSubscriptionState(root)).toEqual({ direct: 0, required: 1, total: 1 });
    expect(runtime.getSubscriptionState(unrelated).total).toBe(0);
  });

  it("deduplicates a diamond ancestor per subscription", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const left = defineDerivedNode({ key: "left", dependencies: [root] as const, derive: () => 2 });
    const right = defineDerivedNode({ key: "right", dependencies: [root] as const, derive: () => 3 });
    const leaf = defineDerivedNode({ key: "leaf", dependencies: [left, right] as const, derive: () => 4 });
    const runtime = createGraphRuntime(createGraph({ nodes: [leaf, right, left, root] }));

    runtime.subscribeNodes([leaf]);
    expect(runtime.getSubscriptionState(root).required).toBe(1);

    runtime.subscribeNodes([left, right]);
    expect(runtime.getSubscriptionState(root).required).toBe(2);
  });

  it("uses subscription-level set semantics for parent and child targets", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const parent = defineDerivedNode({ key: "parent", dependencies: [root] as const, derive: () => 2 });
    const child = defineDerivedNode({ key: "child", dependencies: [parent] as const, derive: () => 3 });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, parent, root] }));

    const subscription = runtime.subscribeNodes([child, parent, child]);

    expect(subscription.nodes.map(node => node.key)).toEqual(["child", "parent"]);
    expect(Object.isFrozen(subscription.nodes)).toBe(true);
    expect(runtime.getSubscriptionState(child)).toEqual({ direct: 1, required: 0, total: 1 });
    expect(runtime.getSubscriptionState(parent)).toEqual({ direct: 1, required: 0, total: 1 });
    expect(runtime.getSubscriptionState(root)).toEqual({ direct: 0, required: 1, total: 1 });
  });
});
