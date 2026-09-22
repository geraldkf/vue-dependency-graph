import { describe, expect, it } from "vitest";
import {
  GraphExecutionError,
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";

describe("refresh failures", () => {
  it("retains successful data and allows later recovery", async () => {
    let shouldFail = false;
    let value = "first";
    const data = defineDataNode({
      key: "data",
      initialValue: "",
      load: async () => {
        if (shouldFail) throw new Error("refresh failed");
        return value;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    await runtime.prefetch([data]);

    shouldFail = true;
    await expect(runtime.refresh([data])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(runtime.getState(data)).toMatchObject({
      data: "first",
      status: "error",
      freshness: "stale",
    });
    expect(runtime.getSchedulerState().error).toBeNull();

    shouldFail = false;
    value = "second";
    await runtime.refresh([data]);
    expect(runtime.getState(data)).toMatchObject({
      data: "second",
      status: "success",
      error: null,
    });
  });

  it("normalises derived refresh failures", async () => {
    let fail = false;
    const data = defineDataNode({ key: "data", initialValue: 0, load: async () => 1 });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [data] as const,
      derive: ({ get }) => {
        if (fail) throw "derived failed";
        return get(data) + 1;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [derived, data] }));
    await runtime.prefetch([derived]);
    fail = true;

    await expect(runtime.refresh([derived])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(runtime.getState(derived).error?.message).toBe("derived failed");
    expect(runtime.getState(derived).data).toBe(2);
  });
});
