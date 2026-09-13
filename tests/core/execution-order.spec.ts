import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("dependency-aware execution", () => {
  it("resolves an empty target list", async () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));
    await expect(runtime.execute([])).resolves.toBeUndefined();
  });

  it("executes ancestors before descendants and skips unrelated nodes", async () => {
    const calls: string[] = [];
    const context = defineContextNode({ key: "context", initialValue: 3 });
    const parent = defineDataNode({
      key: "parent",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => {
        calls.push("parent");
        return get(context) * 2;
      },
    });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [parent] as const,
      derive: ({ get }) => {
        calls.push("child");
        return get(parent) + 1;
      },
    });
    const unrelatedLoad = vi.fn(async () => "unrelated");
    const unrelated = defineDataNode({ key: "unrelated", initialValue: "", load: unrelatedLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [child, unrelated, parent, context] }));

    await runtime.execute([child]);

    expect(calls).toEqual(["parent", "child"]);
    expect(runtime.getState(parent).data).toBe(6);
    expect(runtime.getState(child).data).toBe(7);
    expect(unrelatedLoad).not.toHaveBeenCalled();

    await runtime.execute([child]);
    expect(calls).toEqual(["parent", "child"]);
  });

  it("executes independent parents concurrently before their child", async () => {
    const leftResult = deferred<number>();
    const rightResult = deferred<number>();
    const started: string[] = [];
    const left = defineDataNode({
      key: "left",
      initialValue: 0,
      load: async () => {
        started.push("left");
        return leftResult.promise;
      },
    });
    const right = defineDataNode({
      key: "right",
      initialValue: 0,
      load: async () => {
        started.push("right");
        return rightResult.promise;
      },
    });
    const total = defineDerivedNode({
      key: "total",
      dependencies: [left, right] as const,
      derive: ({ get }) => get(left) + get(right),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [total, right, left] }));

    const execution = runtime.execute([total]);
    await waitForCondition(
      () => started.length === 2,
      "both independent parent loaders to start"
    );
    expect(started.sort()).toEqual(["left", "right"]);
    expect(runtime.getState(total).status).toBe("idle");

    leftResult.resolve(2);
    rightResult.resolve(4);
    await execution;
    expect(runtime.getState(total).data).toBe(6);
  });

  it("resolves equivalent targets and validates the full list before execution", async () => {
    const load = vi.fn(async () => "registered");
    const registered = defineDataNode({ key: "data", initialValue: "", load });
    const equivalent = defineDataNode({ key: "data", initialValue: "other", load });
    const missing = defineDataNode({ key: "missing", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    await runtime.execute([equivalent]);
    expect(runtime.getState(registered).data).toBe("registered");

    const otherRuntime = createGraphRuntime(createGraph({ nodes: [registered] }));
    await expect(otherRuntime.execute([registered, missing])).rejects.toThrow("missing");
    expect(load).toHaveBeenCalledOnce();
    expect(otherRuntime.getState(registered).status).toBe("idle");
  });

});
