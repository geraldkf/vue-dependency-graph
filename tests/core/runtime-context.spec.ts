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
});
