import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("scheduler coalescing", () => {
  it("coalesces synchronous subscriptions and shared ancestors", async () => {
    const parentLoad = vi.fn(async () => 3);
    const parent = defineDataNode({ key: "parent", initialValue: 0, load: parentLoad });
    const left = defineDerivedNode({
      key: "left",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent) + 1,
    });
    const right = defineDerivedNode({
      key: "right",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent) + 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [right, left, parent] }));

    runtime.subscribeNodes([left]);
    runtime.subscribeNodes([right]);
    runtime.subscribeNodes([left]);
    await runtime.whenSettled();

    expect(parentLoad).toHaveBeenCalledOnce();
    expect(runtime.getState(left).data).toBe(4);
    expect(runtime.getState(right).data).toBe(5);
  });

  it("uses the latest context value from the synchronous change group", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    runtime.subscribeNodes([data]);
    runtime.setContext(context, 2);
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(2);
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not load when the subscription is removed before the flush", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const subscription = runtime.subscribeNodes([data]);
    subscription.unsubscribe();
    await runtime.whenSettled();

    expect(load).not.toHaveBeenCalled();
  });
});
