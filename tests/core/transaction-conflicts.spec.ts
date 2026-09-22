import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineEvent,
  GraphTransactionConflictError,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("transaction context conflicts", () => {
  it("rejects a transaction that would overwrite an independent context write", async () => {
    const context = defineContextNode({ key: "conflicting-context", initialValue: 1 });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(context, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(context, 3);
    releaseTransaction.resolve();

    await expect(pendingTransaction).rejects.toEqual(
      expect.objectContaining({
        name: "GraphTransactionConflictError",
        contextKeys: ["conflicting-context"],
      }),
    );
    expect(runtime.getState(context)).toMatchObject({ data: 3, generation: 1 });
  });

  it("rejects atomically without applying other staged contexts or events", async () => {
    const conflicting = defineContextNode({ key: "atomic-conflict", initialValue: 1 });
    const unaffected = defineContextNode({ key: "atomic-unaffected", initialValue: 10 });
    const changed = defineEvent<void>("atomic-conflict-event");
    const predicate = vi.fn(() => true);
    const target = defineDataNode({
      key: "atomic-conflict-target",
      invalidatedBy: [{ event: changed, when: predicate }] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [conflicting, unaffected, target] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(conflicting, 2);
      transaction.setContext(unaffected, 20);
      transaction.publish(changed, undefined);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(conflicting, 3);
    listener.mockClear();
    releaseTransaction.resolve();

    await expect(pendingTransaction).rejects.toBeInstanceOf(GraphTransactionConflictError);
    expect(runtime.getState(conflicting)).toMatchObject({ data: 3, generation: 1 });
    expect(runtime.getState(unaffected)).toMatchObject({ data: 10, generation: 0 });
    expect(runtime.getState(target).generation).toBe(0);
    expect(predicate).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it("reports conflicting context keys in deterministic order", async () => {
    const second = defineContextNode({ key: "second-conflict", initialValue: 2 });
    const first = defineContextNode({ key: "first-conflict", initialValue: 1 });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [second, first] }));

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(second, 20);
      transaction.setContext(first, 10);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(second, 200);
    runtime.setContext(first, 100);
    releaseTransaction.resolve();

    const error = await pendingTransaction.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GraphTransactionConflictError);
    expect((error as GraphTransactionConflictError).contextKeys).toEqual([
      "first-conflict",
      "second-conflict",
    ]);
    expect(Object.isFrozen((error as GraphTransactionConflictError).contextKeys)).toBe(true);
  });

  it("detects a conflict even when the staged final value reverts to its original value", async () => {
    const context = defineContextNode({ key: "reverted-conflict", initialValue: 1 });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(context, 2);
      transaction.setContext(context, 1);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.setContext(context, 3);
    releaseTransaction.resolve();

    await expect(pendingTransaction).rejects.toBeInstanceOf(GraphTransactionConflictError);
    expect(runtime.getState(context)).toMatchObject({ data: 3, generation: 1 });
  });

  it("does not conflict when an independent write happens before the context is staged", async () => {
    const context = defineContextNode({ key: "late-staged-context", initialValue: 1 });
    const beginStaging = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const pendingTransaction = runtime.transaction(async (transaction) => {
      await beginStaging.promise;
      transaction.setContext(context, 3);
    });
    await Promise.resolve();

    runtime.setContext(context, 2);
    beginStaging.resolve();
    await pendingTransaction;

    expect(runtime.getState(context)).toMatchObject({ data: 3, generation: 2 });
  });
});
