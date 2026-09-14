import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction settlement", () => {
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

  it("keeps transaction-time whenSettled pending through commit scheduling", async () => {
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

    let settled = false;
    let transactionSettlement!: Promise<void>;
    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      transactionSettlement = runtime.whenSettled().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
    });

    await waitForCondition(
      () => loadCount === 2,
      "commit scheduler execution to start"
    );
    expect(settled).toBe(false);

    reload.resolve(2);
    await transactionSettlement;

    expect(settled).toBe(true);
    expect(runtime.getState(data).data).toBe(2);
  });

  it("settles transaction-time whenSettled after rollback without phantom scheduler work", async () => {
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

    let settled = false;
    let transactionSettlement!: Promise<void>;
    await expect(
      runtime.transaction(async () => {
        runtime.setContext(context, 2);
        transactionSettlement = runtime.whenSettled().then(() => {
          settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        throw new Error("rollback settlement");
      })
    ).rejects.toThrow("rollback settlement");

    await transactionSettlement;

    expect(settled).toBe(true);
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
