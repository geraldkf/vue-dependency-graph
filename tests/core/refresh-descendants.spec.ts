import { describe, expect, it, vi } from "vitest";
import { createGraph, createGraphRuntime, defineDataNode, defineDerivedNode } from "../../src/core";

describe("refresh descendant invalidation", () => {
  it("invalidates transitive descendants once when the value changes", async () => {
    let value = 1;
    const root = defineDataNode({ key: "root", initialValue: 0, load: async () => value });
    const child = defineDerivedNode({ key: "child", dependencies: [root] as const, derive: ({ get }) => get(root) + 1 });
    const leaf = defineDerivedNode({ key: "leaf", dependencies: [child] as const, derive: ({ get }) => get(child) + 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [leaf, child, root] }));
    await runtime.prefetch([leaf]);

    value = 2;
    await runtime.refresh([root]);

    expect(runtime.getState(child)).toMatchObject({ data: 2, freshness: "stale", generation: 1 });
    expect(runtime.getState(leaf)).toMatchObject({ data: 3, freshness: "stale", generation: 1 });
  });

  it("does not invalidate descendants when the value is equal", async () => {
    const root = defineDataNode({ key: "root", initialValue: 0, load: async () => 1 });
    const child = defineDerivedNode({ key: "child", dependencies: [root] as const, derive: ({ get }) => get(root) + 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, root] }));
    await runtime.prefetch([child]);
    const before = runtime.getState(child);

    await runtime.refresh([root]);

    expect(runtime.getState(child)).toEqual(before);
  });

  it("automatically recomputes subscribed descendants only", async () => {
    let value = 1;
    const root = defineDataNode({ key: "root", initialValue: 0, load: async () => value });
    const derive = vi.fn(({ get }) => get(root) + 1);
    const child = defineDerivedNode({ key: "child", dependencies: [root] as const, derive });
    const unrelatedLoad = vi.fn(async () => "unrelated");
    const unrelated = defineDataNode({ key: "unrelated", initialValue: "", load: unrelatedLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, unrelated, root] }));
    runtime.subscribeNodes([child]);
    await runtime.whenSettled();

    value = 2;
    await runtime.refresh([root]);
    await runtime.whenSettled();

    expect(runtime.getState(child).data).toBe(3);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(unrelatedLoad).not.toHaveBeenCalled();
  });
});
