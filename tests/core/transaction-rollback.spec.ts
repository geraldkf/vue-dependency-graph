import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction rollback", () => {
  it("discards staged context values when the outer transaction fails", async () => {
    const context = defineContextNode({ key: "failed-context", initialValue: 1 });
    const observed = vi.fn();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(observed);

    await expect(
      runtime.transaction(async transaction => {
        transaction.setContext(context, 2);
        await Promise.resolve();
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(observed).not.toHaveBeenCalled();
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
        runtime.transaction(async transaction => {
          transaction.setContext(context, 2);
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
      runtime.transaction(async transaction => {
        transaction.setContext(context, 2);
        await runtime.transaction(() => {
          transaction.setContext(context, 3);
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

    await runtime.transaction(async transaction => {
      transaction.setContext(context, 2);
      try {
        await runtime.transaction(() => {
          transaction.setContext(context, 3);
          throw new Error("caught inner failure");
        });
      } catch (error) {
        expect(error).toEqual(new Error("caught inner failure"));
      }
      transaction.setContext(context, 4);
    });

    expect(runtime.getState(context).data).toBe(4);
    expect(runtime.getState(context).generation).toBe(1);
  });

  it("rolls back outer work after an inner transaction succeeds", async () => {
    const context = defineContextNode({ key: "outer-failure", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await expect(
      runtime.transaction(async transaction => {
        await runtime.transaction(() => {
          transaction.setContext(context, 2);
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
      runtime.transaction(transaction => {
        transaction.setContext(context, 2);
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
      runtime.transaction(async transaction => {
        transaction.setContext(context, 2);
        attempt.resolve(42);
        await waitForCondition(
          () => runtime.getState(data).data === 42,
          "independent execution to commit"
        );
        expect(observed[observed.length - 1]).toBe(42);
        throw new Error("rollback context only");
      })
    ).rejects.toThrow("rollback context only");
    await execution;

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(runtime.getState(data).data).toBe(42);
    expect(observed[observed.length - 1]).toBe(42);
  });
});
