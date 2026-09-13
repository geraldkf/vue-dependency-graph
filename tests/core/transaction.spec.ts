import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { waitForCondition } from "./test-helpers";

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

  it("does not roll back partial state when the transaction body throws", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await expect(
      runtime.transaction(async () => {
        runtime.setContext(context, 2);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // No rollback: the committed mutation before the throw is still visible.
    expect(runtime.getState(context).data).toBe(2);
  });
});
