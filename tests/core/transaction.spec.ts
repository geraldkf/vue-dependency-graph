import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  type DataNodeDefinition,
  type GraphRuntime,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transactions", () => {
  it("without a transaction, an async-spanning update causes two loads", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    runtime.setContext(context, 2);
    await runtime.whenSettled();
    runtime.setContext(context, 3);
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces an async-spanning update into a single load inside a transaction", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await Promise.resolve();
      await Promise.resolve();
      runtime.setContext(context, 3);
    });
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not resolve whenSettled mid-transaction even when an unsubscribe would otherwise settle it", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const subscription = runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    let settledDuringTransaction = false;
    await runtime.transaction(async () => {
      subscription.unsubscribe(); // would call resolveSettlementIfIdle synchronously today
      const otherSubscription = runtime.subscribeNodes([data]);
      void runtime.whenSettled().then(() => {
        settledDuringTransaction = true;
      });
      await Promise.resolve();
      expect(settledDuringTransaction).toBe(false);
      otherSubscription.unsubscribe();
    });

    await waitForCondition(
      () => settledDuringTransaction,
      "settlement to resolve after transaction commit"
    );
  });

  it("collapses nested transactions into one commit", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => {
      observed.push(runtime.getState(context).data);
    });

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await runtime.transaction(() => {
        runtime.setContext(context, 3);
      });
      runtime.setContext(context, 4);
    });

    expect(observed).toEqual([4]);
  });

  it.each([
    ["execute", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.execute([data])],
    ["prefetch", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.prefetch([data])],
    ["refresh", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.refresh([data])],
  ] as const)(
    "rejects %s inside a transaction without starting or invalidating work",
    async (operation, invoke) => {
      const load = vi.fn(async () => 1);
      const data = defineDataNode({
        key: `data-${operation}`,
        dependencies: [] as const,
        initialValue: 0,
        load,
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
      const stateBefore = runtime.getState(data);

      await expect(
        runtime.transaction(() => invoke(runtime, data))
      ).rejects.toThrow(
        `runtime.${operation}(...) cannot be called inside runtime.transaction(...).`
      );

      expect(load).not.toHaveBeenCalled();
      expect(runtime.getState(data)).toEqual(stateBefore);
    }
  );

  it("keeps staged context values hidden until the outer transaction commits", async () => {
    const context = defineContextNode({ key: "staged-context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => observed.push(runtime.getState(context).data));

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      expect(runtime.getState(context).data).toBe(1);
      expect(runtime.getState(context).generation).toBe(0);
      expect(observed).toEqual([]);

      await Promise.resolve();

      runtime.setContext(context, 3);
      expect(runtime.getState(context).data).toBe(1);
      expect(observed).toEqual([]);
    });

    expect(runtime.getState(context).data).toBe(3);
    expect(runtime.getState(context).generation).toBe(1);
    expect(observed).toEqual([3]);
  });

  it("uses the final staged value across nested transactions", async () => {
    const context = defineContextNode({ key: "nested-context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await runtime.transaction(() => {
        runtime.setContext(context, 3);
        expect(runtime.getState(context).data).toBe(1);
      });
      expect(runtime.getState(context).data).toBe(1);
      runtime.setContext(context, 4);
    });

    expect(runtime.getState(context).data).toBe(4);
    expect(runtime.getState(context).generation).toBe(1);
  });

  it("does not commit when the final staged value equals the committed value", async () => {
    const context = defineContextNode({ key: "reverted-context", initialValue: 1 });
    const observed = vi.fn();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(observed);

    await runtime.transaction(() => {
      runtime.setContext(context, 2);
      runtime.setContext(context, 1);
    });

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(observed).not.toHaveBeenCalled();
  });

  it("discards staged context values when the outer transaction fails", async () => {
    const context = defineContextNode({ key: "failed-context", initialValue: 1 });
    const observed = vi.fn();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(observed);

    await expect(
      runtime.transaction(async () => {
        runtime.setContext(context, 2);
        await Promise.resolve();
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(observed).not.toHaveBeenCalled();
  });

  it("requests one scheduler pass for a multi-context commit", async () => {
    const first = defineContextNode({ key: "scheduled-first", initialValue: 1 });
    const second = defineContextNode({ key: "scheduled-second", initialValue: 2 });
    const load = vi.fn(async ({ get }) => get(first) + get(second));
    const data = defineDataNode({
      key: "scheduled-data",
      dependencies: [first, second] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [data, first, second] })
    );
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    await runtime.transaction(() => {
      runtime.setContext(first, 10);
      runtime.setContext(second, 20);
    });
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(data).data).toBe(30);
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("invalidates a shared descendant once when multiple contexts commit", async () => {
    const first = defineContextNode({ key: "first-context", initialValue: 1 });
    const second = defineContextNode({ key: "second-context", initialValue: 2 });
    const shared = defineDerivedNode({
      key: "shared-descendant",
      dependencies: [first, second] as const,
      derive: ({ get }) => get(first) + get(second),
    });
    const observed = vi.fn();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [shared, first, second] })
    );
    runtime.onChange(observed);

    await runtime.transaction(() => {
      runtime.setContext(first, 10);
      runtime.setContext(second, 20);
    });

    expect(runtime.getState(first).generation).toBe(1);
    expect(runtime.getState(second).generation).toBe(1);
    expect(runtime.getState(shared).generation).toBe(1);
    expect(runtime.getState(shared).freshness).toBe("stale");
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it("invalidates each node once across diamond descendant paths", async () => {
    const context = defineContextNode({ key: "diamond-context", initialValue: 1 });
    const left = defineDerivedNode({
      key: "diamond-left",
      dependencies: [context] as const,
      derive: ({ get }) => get(context),
    });
    const right = defineDerivedNode({
      key: "diamond-right",
      dependencies: [context] as const,
      derive: ({ get }) => get(context),
    });
    const bottom = defineDerivedNode({
      key: "diamond-bottom",
      dependencies: [left, right] as const,
      derive: ({ get }) => get(left) + get(right),
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [bottom, left, right, context] })
    );

    await runtime.transaction(() => {
      runtime.setContext(context, 2);
    });

    expect(runtime.getState(left).generation).toBe(1);
    expect(runtime.getState(right).generation).toBe(1);
    expect(runtime.getState(bottom).generation).toBe(1);
  });

  it("aborts affected active work at commit rather than while staging", async () => {
    const context = defineContextNode({ key: "abort-context", initialValue: 1 });
    const attempt = deferred<number>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "abort-data",
      dependencies: [context] as const,
      initialValue: 0,
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "initial attempt to start");

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      expect(signals[0]?.aborted).toBe(false);
      expect(runtime.getState(data).generation).toBe(0);
      await Promise.resolve();
      expect(signals[0]?.aborted).toBe(false);
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.getState(data).generation).toBe(1);
    attempt.resolve(1);
    await execution;
  });

  it("does not abort active work unaffected by committed contexts", async () => {
    const changed = defineContextNode({ key: "changed-context", initialValue: 1 });
    const unrelated = defineContextNode({ key: "unrelated-context", initialValue: 1 });
    const attempt = deferred<number>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "unaffected-data",
      dependencies: [unrelated] as const,
      initialValue: 0,
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [data, changed, unrelated] })
    );
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "unaffected attempt to start");

    await runtime.transaction(() => {
      runtime.setContext(changed, 2);
    });

    expect(signals[0]?.aborted).toBe(false);
    expect(runtime.getState(data).generation).toBe(0);
    attempt.resolve(1);
    await execution;
  });

  it.each([
    ["synchronous throw", () => {
      throw new Error("rollback");
    }],
    ["asynchronous rejection", async () => {
      await Promise.resolve();
      throw new Error("rollback");
    }],
  ] as const)(
    "rolls back staged contexts after a %s",
    async (_failureType, fail) => {
      const context = defineContextNode({ key: `rollback-${_failureType}`, initialValue: 1 });
      const dependent = defineDerivedNode({
        key: `rollback-dependent-${_failureType}`,
        dependencies: [context] as const,
        derive: ({ get }) => get(context),
      });
      const observed = vi.fn();
      const runtime = createGraphRuntime(
        createGraph({ nodes: [dependent, context] })
      );
      runtime.onChange(observed);

      await expect(
        runtime.transaction(async () => {
          runtime.setContext(context, 2);
          await fail();
        })
      ).rejects.toThrow("rollback");

      expect(runtime.getState(context).data).toBe(1);
      expect(runtime.getState(context).generation).toBe(0);
      expect(runtime.getState(dependent).generation).toBe(0);
      expect(observed).not.toHaveBeenCalled();
    }
  );

  it("rolls back the outer transaction when an inner failure propagates", async () => {
    const context = defineContextNode({ key: "propagated-failure", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await expect(
      runtime.transaction(async () => {
        runtime.setContext(context, 2);
        await runtime.transaction(() => {
          runtime.setContext(context, 3);
          throw new Error("inner failure");
        });
      })
    ).rejects.toThrow("inner failure");

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
  });

  it("allows the outer transaction to commit when an inner failure is caught", async () => {
    const context = defineContextNode({ key: "caught-failure", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      try {
        await runtime.transaction(() => {
          runtime.setContext(context, 3);
          throw new Error("caught inner failure");
        });
      } catch (error) {
        expect(error).toEqual(new Error("caught inner failure"));
      }
      runtime.setContext(context, 4);
    });

    expect(runtime.getState(context).data).toBe(4);
    expect(runtime.getState(context).generation).toBe(1);
  });

  it("rolls back outer work after an inner transaction succeeds", async () => {
    const context = defineContextNode({ key: "outer-failure", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await expect(
      runtime.transaction(async () => {
        await runtime.transaction(() => {
          runtime.setContext(context, 2);
        });
        throw new Error("outer failure");
      })
    ).rejects.toThrow("outer failure");

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
  });

  it("does not abort affected active work when staged context changes roll back", async () => {
    const context = defineContextNode({ key: "rollback-abort-context", initialValue: 1 });
    const attempt = deferred<number>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "rollback-abort-data",
      dependencies: [context] as const,
      initialValue: 0,
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "rollback attempt to start");

    await expect(
      runtime.transaction(() => {
        runtime.setContext(context, 2);
        throw new Error("rollback active work");
      })
    ).rejects.toThrow("rollback active work");

    expect(signals[0]?.aborted).toBe(false);
    expect(runtime.getState(context).generation).toBe(0);
    expect(runtime.getState(data).generation).toBe(0);
    attempt.resolve(1);
    await execution;
    expect(runtime.getState(data).data).toBe(1);
  });

  it("publishes independent execution completion after a transaction rolls back", async () => {
    const context = defineContextNode({ key: "independent-context", initialValue: 1 });
    const attempt = deferred<number>();
    const data = defineDataNode({
      key: "independent-data",
      dependencies: [] as const,
      initialValue: 0,
      load: () => attempt.promise,
    });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.onChange(() => observed.push(runtime.getState(data).data));
    const execution = runtime.execute([data]);

    await expect(
      runtime.transaction(async () => {
        runtime.setContext(context, 2);
        attempt.resolve(42);
        await waitForCondition(
          () => runtime.getState(data).data === 42,
          "independent execution to commit"
        );
        expect(observed).toEqual([]);
        throw new Error("rollback context only");
      })
    ).rejects.toThrow("rollback context only");
    await execution;

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(runtime.getState(data).data).toBe(42);
    expect(observed).toEqual([42]);
  });

  it("allows guarded operations again after a transaction completes", async () => {
    const load = vi.fn(async () => 1);
    const data = defineDataNode({
      key: "data-after-transaction",
      dependencies: [] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.transaction(async () => {
      await Promise.resolve();
    });
    await runtime.execute([data]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(data).data).toBe(1);
  });

  it("behaves as a plain passthrough outside a transaction (existing call sites unaffected)", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => {
      observed.push(runtime.getState(context).data);
    });

    runtime.setContext(context, 2);
    runtime.setContext(context, 3);

    expect(observed).toEqual([2, 3]);
  });

});
