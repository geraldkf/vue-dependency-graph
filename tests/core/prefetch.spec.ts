import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("prefetch", () => {
  it("loads a target and required ancestors without subscriptions", async () => {
    const context = defineContextNode({ key: "context", initialValue: 2 });
    const load = vi.fn(async ({ get }) => get(context) * 2);
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [data] as const,
      derive: ({ get }) => get(data) + 1,
    });
    const unrelatedLoad = vi.fn(async () => "unrelated");
    const unrelated = defineDataNode({ key: "unrelated", initialValue: "", load: unrelatedLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [derived, unrelated, data, context] }));

    await runtime.prefetch([derived]);

    expect(runtime.getState(derived).data).toBe(5);
    expect(load).toHaveBeenCalledOnce();
    expect(unrelatedLoad).not.toHaveBeenCalled();
    expect(runtime.getSubscriptionState(derived).total).toBe(0);
    expect(runtime.hasSubscribers(data)).toBe(false);
  });

  it("skips fresh nodes and satisfies a later subscription", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.prefetch([data]);
    await runtime.prefetch([data]);
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledOnce();
  });

  it("supports equivalent handles, empty input, and atomic validation", async () => {
    const load = vi.fn(async () => "loaded");
    const registered = defineDataNode({ key: "data", initialValue: "", load });
    const equivalent = defineDataNode({ key: "data", initialValue: "other", load });
    const missing = defineDataNode({ key: "missing", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    await runtime.prefetch([]);
    await runtime.prefetch([equivalent]);
    expect(runtime.getState(registered).data).toBe("loaded");

    const otherRuntime = createGraphRuntime(createGraph({ nodes: [registered] }));
    await expect(otherRuntime.prefetch([registered, missing])).rejects.toThrow("missing");
    expect(otherRuntime.getState(registered).status).toBe("idle");
  });
});
