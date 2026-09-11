import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const abortableLoader = (
  result: ReturnType<typeof deferred<string>>,
  signals: AbortSignal[]
) => ({ signal }: { readonly signal: AbortSignal }): Promise<string> => {
  signals.push(signal);
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
    result.promise.then(resolve, reject);
  });
};

describe("subscription-driven cancellation", () => {
  it("aborts scheduler-owned work after the final subscriber unsubscribes", async () => {
    const result = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn(abortableLoader(result, signals));
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const subscription = runtime.subscribeNodes([data]);
    await waitForCondition(() => signals.length === 1, "scheduler loader to start");
    subscription.unsubscribe();
    await runtime.whenSettled();

    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.getState(data).error).toBeNull();
    expect(runtime.getSchedulerState().error).toBeNull();
  });

  it("keeps shared work while another subscriber remains", async () => {
    const result = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn(abortableLoader(result, signals));
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const first = runtime.subscribeNodes([data]);
    const second = runtime.subscribeNodes([data]);

    await waitForCondition(() => signals.length === 1, "shared loader to start");
    first.unsubscribe();
    expect(signals[0]?.aborted).toBe(false);

    result.resolve("loaded");
    await runtime.whenSettled();
    expect(runtime.getState(data).data).toBe("loaded");
    second.unsubscribe();
  });

  it("does not cancel explicit caller-owned work when subscribers disappear", async () => {
    const result = deferred<string>();
    const signals: AbortSignal[] = [];
    const load = vi.fn(abortableLoader(result, signals));
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const explicitExecution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "explicit loader to start");
    const subscription = runtime.subscribeNodes([data]);
    subscription.unsubscribe();

    expect(signals[0]?.aborted).toBe(false);
    result.resolve("loaded");
    await explicitExecution;
    await runtime.whenSettled();
    expect(runtime.getState(data).data).toBe("loaded");
  });
});
