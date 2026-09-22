import { describe, expect, it, vi } from "vitest";
import {
  GraphExecutionError,
  createGraph,
  createGraphRuntime,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("prefetch interactions", () => {
  it("shares work with the scheduler and survives final unsubscribe", async () => {
    const result = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn(({ signal }) => {
      signals.push(signal);
      return result.promise;
    });
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const subscription = runtime.subscribeNodes([data]);
    const prefetch = runtime.prefetch([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "shared prefetch loader");
    subscription.unsubscribe();

    expect(signals[0]?.aborted).toBe(false);
    result.resolve("loaded");
    await prefetch;
    await runtime.whenSettled();
    expect(load).toHaveBeenCalledOnce();
  });

  it("shares work with explicit execution", async () => {
    const result = deferred<string>();
    const load = vi.fn(() => result.promise);
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const explicit = runtime.execute([data]);
    const prefetch = runtime.prefetch([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "shared explicit loader");
    result.resolve("loaded");
    await Promise.all([explicit, prefetch]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("rejects caller-visible failure without setting scheduler error", async () => {
    const data = defineDataNode({
      key: "data",
      initialValue: "",
      load: async () => {
        throw new Error("failed");
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await expect(runtime.prefetch([data])).rejects.toBeInstanceOf(GraphExecutionError);
    expect(runtime.getSchedulerState().error).toBeNull();
  });
});
