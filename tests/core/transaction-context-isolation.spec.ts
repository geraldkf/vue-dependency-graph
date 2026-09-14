import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("transaction context ownership", () => {
  it("commits a plain runtime context write while another transaction is open", async () => {
    const stagedContext = defineContextNode({
      key: "staged-context",
      initialValue: 1,
    });
    const immediateContext = defineContextNode({
      key: "immediate-context",
      initialValue: 10,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedContext, immediateContext] }),
    );

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.setContext(stagedContext, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(immediateContext, 999);

    expect(runtime.getState(stagedContext)).toMatchObject({
      data: 1,
      generation: 0,
    });
    expect(runtime.getState(immediateContext)).toMatchObject({
      data: 999,
      generation: 1,
    });

    releaseTransaction.resolve();
    await pendingTransaction;

    expect(runtime.getState(stagedContext).data).toBe(2);
    expect(runtime.getState(immediateContext).data).toBe(999);
  });

  it("preserves a plain runtime context write when another transaction rolls back", async () => {
    const stagedContext = defineContextNode({
      key: "rolled-back-staged-context",
      initialValue: 1,
    });
    const immediateContext = defineContextNode({
      key: "rollback-independent-context",
      initialValue: 10,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedContext, immediateContext] }),
    );

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.setContext(stagedContext, 2);
      await releaseTransaction.promise;
      throw new Error("rollback");
    });
    await Promise.resolve();

    runtime.setContext(immediateContext, 999);
    expect(runtime.getState(immediateContext)).toMatchObject({
      data: 999,
      generation: 1,
    });

    releaseTransaction.resolve();
    await expect(pendingTransaction).rejects.toThrow("rollback");

    expect(runtime.getState(stagedContext)).toMatchObject({
      data: 1,
      generation: 0,
    });
    expect(runtime.getState(immediateContext)).toMatchObject({
      data: 999,
      generation: 1,
    });
  });
  it("notifies and schedules an unrelated context write before the transaction closes", async () => {
    const stagedContext = defineContextNode({
      key: "dispatch-staged-context",
      initialValue: 1,
    });
    const immediateContext = defineContextNode({
      key: "dispatch-immediate-context",
      initialValue: 10,
    });
    const load = vi.fn(async ({ get }) => get(immediateContext));
    const dependent = defineDataNode({
      key: "dispatch-context-dependent",
      dependencies: [immediateContext] as const,
      initialValue: 0,
      load,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedContext, immediateContext, dependent] }),
    );
    runtime.subscribeNodes([dependent]);
    await runtime.whenSettled();
    load.mockClear();
    const listener = vi.fn();
    runtime.onChange(listener);

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.setContext(stagedContext, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(immediateContext, 999);

    expect(listener).toHaveBeenCalled();
    await runtime.whenSettled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(dependent).data).toBe(999);

    releaseTransaction.resolve();
    await pendingTransaction;
  });

});
