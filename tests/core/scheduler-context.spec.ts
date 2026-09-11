import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("scheduler context invalidation", () => {
  it("runs one follow-up using the latest context and discards the obsolete result", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const first = deferred<number>();
    const second = deferred<number>();
    const signals: AbortSignal[] = [];
    const load = vi.fn(({ get, signal }) => {
      signals.push(signal);
      return get(context) === 1 ? first.promise : second.promise;
    });
    const data = defineDataNode({ key: "data", dependencies: [context] as const, initialValue: 0, load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    runtime.subscribeNodes([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "first scheduler attempt");

    runtime.setContext(context, 2);
    runtime.setContext(context, 3);
    expect(signals[0]?.aborted).toBe(true);

    first.resolve(1);
    await waitForCondition(() => load.mock.calls.length === 2, "coalesced follow-up attempt");
    second.resolve(3);
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data).data).toBe(3);
  });

  it("does not load stale descendants without subscribers", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({ key: "data", dependencies: [context] as const, initialValue: 0, load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    runtime.setContext(context, 2);
    await runtime.whenSettled();
    expect(load).not.toHaveBeenCalled();
  });
});
