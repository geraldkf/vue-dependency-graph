import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("runtime cancellation and races", () => {
  it("aborts affected work, preserves unrelated work, and discards obsolete results", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const firstResult = deferred<string>();
    const secondResult = deferred<string>();
    const unrelatedResult = deferred<string>();
    const signals: AbortSignal[] = [];
    let call = 0;
    const affected = defineDataNode({
      key: "affected",
      dependencies: [context] as const,
      initialValue: "initial",
      load: ({ get, signal }) => {
        signals.push(signal);
        const current = get(context);
        call += 1;
        return call === 1
          ? firstResult.promise.then(value => `${value}-${current}`)
          : secondResult.promise.then(value => `${value}-${current}`);
      },
    });
    const unrelated = defineDataNode({
      key: "unrelated",
      initialValue: "",
      load: () => unrelatedResult.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [affected, unrelated, context] }));
    const notifications = vi.fn();
    runtime.onChange(notifications);

    const firstExecution = runtime.execute([affected, unrelated]);
    await waitForCondition(
      () => signals.length === 1 && runtime.getState(unrelated).status === "loading",
      "affected and unrelated loaders to start"
    );
    runtime.setContext(context, 2);

    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.getState(affected)).toMatchObject({
      data: "initial",
      status: "idle",
      freshness: "stale",
      error: null,
      generation: 1,
    });
    expect(runtime.getState(unrelated).status).toBe("loading");

    const secondExecution = runtime.execute([affected]);
    await waitForCondition(
      () => signals.length === 2,
      "the replacement loader to start"
    );
    secondResult.resolve("new");
    unrelatedResult.resolve("unrelated");
    firstResult.resolve("old");

    await Promise.all([firstExecution, secondExecution]);
    expect(runtime.getState(affected)).toMatchObject({
      data: "new-2",
      status: "success",
      freshness: "fresh",
      error: null,
    });
    expect(runtime.getState(unrelated).data).toBe("unrelated");
    expect(signals).toHaveLength(2);
  });

  it("does not reuse an obsolete generation attempt", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const results = [deferred<number>(), deferred<number>()];
    const load = vi.fn(({ get }) => {
      const index = get(context) - 1;
      const result = results[index];
      if (!result) throw new Error("Unexpected context value.");
      return result.promise;
    });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    const first = runtime.execute([data]);
    await waitForCondition(
      () => load.mock.calls.length === 1,
      "the first generation loader to start"
    );
    runtime.setContext(context, 2);
    const second = runtime.execute([data]);
    await waitForCondition(
      () => load.mock.calls.length === 2,
      "the second generation loader to start"
    );

    results[1]?.resolve(20);
    results[0]?.resolve(10);
    await Promise.all([first, second]);

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data).data).toBe(20);
  });
});
