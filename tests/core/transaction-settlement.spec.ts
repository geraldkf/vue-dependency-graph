import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction settlement", () => {
  it("reports ordinary runtime settlement independently while a transaction is open", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.setContext(context, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    let settled = false;
    await runtime.whenSettled().then(() => {
      settled = true;
    });

    expect(settled).toBe(true);
    expect(runtime.getState(context).data).toBe(1);

    releaseTransaction.resolve();
    await pendingTransaction;
    expect(runtime.getState(context).data).toBe(2);
  });

  it("waits for transaction commit scheduling when called after the transaction", async () => {
    const context = defineContextNode({ key: "settled-commit-context", initialValue: 1 });
    const reload = deferred<number>();
    let loadCount = 0;
    const data = defineDataNode({
      key: "settled-commit-data",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => {
        loadCount += 1;
        if (loadCount === 1) return get(context);
        return reload.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    await runtime.transaction(transaction => {
      transaction.setContext(context, 2);
    });

    await waitForCondition(
      () => loadCount === 2,
      "commit scheduler execution to start",
    );
    let settled = false;
    const settlement = runtime.whenSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    reload.resolve(2);
    await settlement;

    expect(settled).toBe(true);
    expect(runtime.getState(data).data).toBe(2);
  });

  it("settles after rollback without phantom scheduler work", async () => {
    const context = defineContextNode({ key: "settled-rollback-context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "settled-rollback-data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    await expect(
      runtime.transaction(transaction => {
        transaction.setContext(context, 2);
        throw new Error("rollback settlement");
      }),
    ).rejects.toThrow("rollback settlement");

    await runtime.whenSettled();

    expect(load).not.toHaveBeenCalled();
    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(data).generation).toBe(0);
    expect(runtime.getSchedulerState()).toMatchObject({
      isScheduled: false,
      isRunning: false,
      error: null,
    });
  });
});
