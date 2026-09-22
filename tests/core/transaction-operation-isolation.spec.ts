import { describe, expect, it, vi } from "vitest";
import { createGraph, createGraphRuntime, defineContextNode, defineDataNode } from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction caller operation isolation", () => {
  it.each([
    [
      "execute",
      async (fixture: ReturnType<typeof createRuntime>) => fixture.runtime.execute([fixture.data]),
    ],
    [
      "prefetch",
      async (fixture: ReturnType<typeof createRuntime>) => fixture.runtime.prefetch([fixture.data]),
    ],
    [
      "refresh",
      async (fixture: ReturnType<typeof createRuntime>) => fixture.runtime.refresh([fixture.data]),
    ],
  ] as const)(
    "allows unrelated %s work while a transaction is open and uses committed context",
    async (_operation, invoke) => {
      const fixture = createRuntime();
      const releaseTransaction = deferred<void>();
      const listener = vi.fn();
      fixture.runtime.onChange(listener);

      const pendingTransaction = fixture.runtime.transaction(async (transaction) => {
        transaction.setContext(fixture.context, 2);
        await releaseTransaction.promise;
      });
      await Promise.resolve();

      await invoke(fixture);

      expect(fixture.load).toHaveBeenCalledWith(
        expect.objectContaining({ get: expect.any(Function) }),
      );
      expect(fixture.runtime.getState(fixture.data).data).toBe(1);
      expect(listener).toHaveBeenCalled();

      releaseTransaction.resolve();
      await pendingTransaction;
    },
  );

  it("publishes execution completion before an unrelated transaction closes", async () => {
    const context = defineContextNode({ key: "operation-notify-context", initialValue: 1 });
    const result = deferred<number>();
    const data = defineDataNode({
      key: "operation-notify-data",
      dependencies: [context] as const,
      initialValue: 0,
      load: async () => result.promise,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(context, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    const execution = runtime.execute([data]);
    result.resolve(42);
    await execution;
    await waitForCondition(() => runtime.getState(data).data === 42, "execution result to commit");

    expect(listener).toHaveBeenCalled();
    expect(runtime.getState(data).data).toBe(42);
    expect(runtime.getState(context).data).toBe(1);

    releaseTransaction.resolve();
    await pendingTransaction;
  });
});

const createRuntime = () => {
  const context = defineContextNode({ key: "operation-context", initialValue: 1 });
  const load = vi.fn(async ({ get }) => get(context));
  const data = defineDataNode({
    key: "operation-data",
    dependencies: [context] as const,
    initialValue: 0,
    load,
  });
  const runtime = createGraphRuntime(createGraph({ nodes: [context, data] }));
  return { runtime, context, data, load };
};
