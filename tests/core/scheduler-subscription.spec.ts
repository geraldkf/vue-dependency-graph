import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("automatic node subscription execution", () => {
  it("loads a subscribed data node and settles", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    runtime.subscribeNodes([data]);
    expect(load).not.toHaveBeenCalled();

    await runtime.whenSettled();

    expect(load).toHaveBeenCalledOnce();
    expect(runtime.getState(data)).toMatchObject({
      data: "loaded",
      status: "success",
      freshness: "fresh",
    });
    expect(runtime.getSchedulerState()).toEqual({
      isScheduled: false,
      isRunning: false,
      error: null,
    });
  });

  it("loads required ancestors and derives the subscribed target", async () => {
    const context = defineContextNode({ key: "context", initialValue: 2 });
    const parentLoad = vi.fn(async ({ get }) => get(context) * 3);
    const parent = defineDataNode({
      key: "parent",
      dependencies: [context] as const,
      initialValue: 0,
      load: parentLoad,
    });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent) + 1,
    });
    const unrelatedLoad = vi.fn(async () => "unrelated");
    const unrelated = defineDataNode({ key: "unrelated", initialValue: "", load: unrelatedLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, unrelated, parent, context] }));

    runtime.subscribeNodes([child]);
    await runtime.whenSettled();

    expect(parentLoad).toHaveBeenCalledOnce();
    expect(runtime.getState(child).data).toBe(7);
    expect(unrelatedLoad).not.toHaveBeenCalled();
  });

  it("settles a subscribed context without loading anything", async () => {
    const context = defineContextNode({ key: "context", initialValue: 2 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    runtime.subscribeNodes([context]);
    await runtime.whenSettled();

    expect(runtime.getState(context).data).toBe(2);
  });
});
