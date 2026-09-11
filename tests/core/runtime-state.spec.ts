import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("graph runtime state", () => {
  it("creates accurate independent initial state", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({ key: "data", initialValue: "initial", load: async () => "loaded" });
    const derived = defineDerivedNode({ key: "derived", dependencies: [context] as const, derive: () => "derived" });
    const graph = createGraph({ nodes: [derived, data, context] });
    const first = createGraphRuntime(graph);
    const second = createGraphRuntime(graph);

    expect(first.getState(context)).toEqual({
      data: 1,
      status: "success",
      freshness: "fresh",
      error: null,
      generation: 0,
      hasSuccessfulValue: true,
    });
    expect(first.getState(data)).toMatchObject({
      data: "initial",
      status: "idle",
      freshness: "stale",
      hasSuccessfulValue: false,
    });
    expect(first.getState(derived)).toMatchObject({
      data: undefined,
      status: "idle",
      freshness: "stale",
      hasSuccessfulValue: false,
    });

    first.setContext(context, 2);
    expect(first.getState(context).data).toBe(2);
    expect(second.getState(context).data).toBe(1);
    expect(Object.isFrozen(first.getState(context))).toBe(true);
  });

  it("notifies committed changes and supports idempotent unsubscribe", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    let safeCalls = 0;
    runtime.onChange(() => {
      throw new Error("listener failure");
    });
    const unsubscribe = runtime.onChange(() => {
      safeCalls += 1;
    });

    runtime.setContext(context, 2);
    runtime.setContext(context, 2);
    expect(safeCalls).toBe(1);

    unsubscribe();
    unsubscribe();
    runtime.setContext(context, 3);
    expect(safeCalls).toBe(1);
  });
});
