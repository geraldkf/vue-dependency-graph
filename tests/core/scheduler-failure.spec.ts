import { describe, expect, it, vi } from "vitest";
import {
  GraphExecutionError,
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";

describe("scheduler failures", () => {
  it("stores automatic execution failure and settles without retrying", async () => {
    const load = vi.fn(async () => {
      throw new Error("failed");
    });
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledOnce();
    expect(runtime.getSchedulerState().error).toBeInstanceOf(GraphExecutionError);
    expect(runtime.getState(data).error?.message).toBe("failed");
    expect(runtime.getSchedulerState().isRunning).toBe(false);
  });

  it("retries after a new subscription and clears errors after success", async () => {
    let shouldFail = true;
    const load = vi.fn(async () => {
      if (shouldFail) throw new Error("failed");
      return "loaded";
    });
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    shouldFail = false;
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getSchedulerState().error).toBeNull();
    expect(runtime.getState(data)).toMatchObject({
      data: "loaded",
      error: null,
      status: "success",
    });
  });

  it("retries a subscribed branch after context change", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => {
      const value = get(context);
      if (value === 1) throw new Error("failed");
      return value;
    });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    runtime.setContext(context, 2);
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(2);
    expect(runtime.getSchedulerState().error).toBeNull();
  });
});
