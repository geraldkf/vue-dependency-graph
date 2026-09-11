import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("runtime context updates", () => {
  it("invalidates transitive descendants once and preserves their data", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const unrelated = defineDataNode({ key: "unrelated", initialValue: "u", load: async () => "loaded-u" });
    const childLoad = vi.fn(async ({ get }) => `child-${get(context)}`);
    const child = defineDataNode({
      key: "child",
      dependencies: [context] as const,
      initialValue: "initial-child",
      load: childLoad,
    });
    const leaf = defineDerivedNode({
      key: "leaf",
      dependencies: [child] as const,
      derive: ({ get }) => `${get(child)}-leaf`,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [leaf, unrelated, child, context] }));

    await runtime.execute([leaf, unrelated]);
    runtime.setContext(context, 2);

    expect(runtime.getState(context)).toMatchObject({ data: 2, generation: 1, freshness: "fresh" });
    expect(runtime.getState(child)).toMatchObject({
      data: "child-1",
      generation: 1,
      status: "success",
      freshness: "stale",
    });
    expect(runtime.getState(leaf)).toMatchObject({
      data: "child-1-leaf",
      generation: 1,
      status: "success",
      freshness: "stale",
    });
    expect(runtime.getState(unrelated)).toMatchObject({ generation: 0, freshness: "fresh" });
    expect(childLoad).toHaveBeenCalledOnce();
  });

  it("resolves equivalent context handles through the registered key", () => {
    const registered = defineContextNode({ key: "context", initialValue: 1 });
    const equivalent = defineContextNode({ key: "context", initialValue: 99 });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    runtime.setContext(equivalent, 2);

    expect(runtime.getState(registered).data).toBe(2);
  });

  it("rejects invalid context handles without changing state or notifying", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const missing = defineContextNode({ key: "missing", initialValue: 2 });
    const data = defineDataNode({ key: "data", initialValue: 0, load: async () => 1 });
    const contextShapedDataHandle = defineContextNode({ key: "data", initialValue: 0 });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    expect(() => runtime.setContext(missing, 3)).toThrow("missing");
    expect(() => runtime.setContext(contextShapedDataHandle, 3)).toThrow("data");

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(data).generation).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

});
