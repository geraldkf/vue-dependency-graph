import { describe, expect, it, vi } from "vitest";
import { createGraph, createGraphRuntime, defineDataNode, defineDerivedNode } from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("runtime in-flight deduplication", () => {
  it("shares one attempt across overlapping executions", async () => {
    const result = deferred<string>();
    const load = vi.fn(() => result.promise);
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const first = runtime.execute([data]);
    const second = runtime.execute([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "the shared data loader to start");
    expect(load).toHaveBeenCalledOnce();

    result.resolve("loaded");
    await Promise.all([first, second]);
    expect(runtime.getState(data).data).toBe("loaded");
  });

  it("loads a shared ancestor once for overlapping targets", async () => {
    const result = deferred<number>();
    const load = vi.fn(() => result.promise);
    const parent = defineDataNode({ key: "parent", initialValue: 0, load });
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

    const execution = runtime.execute([left, right]);
    await waitForCondition(
      () => load.mock.calls.length === 1,
      "the shared ancestor loader to start",
    );
    expect(load).toHaveBeenCalledOnce();
    result.resolve(3);
    await execution;

    expect(runtime.getState(left).data).toBe(4);
    expect(runtime.getState(right).data).toBe(5);
  });

  it("does not share work across runtime instances", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const graph = createGraph({ nodes: [data] });

    await Promise.all([
      createGraphRuntime(graph).execute([data]),
      createGraphRuntime(graph).execute([data]),
    ]);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
