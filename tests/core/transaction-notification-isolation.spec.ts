import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineEvent,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction notification and scheduling isolation", () => {
  it("notifies and schedules a committed transaction while another session remains open", async () => {
    const firstContext = defineContextNode({
      key: "notification-isolation-first",
      initialValue: 1,
    });
    const secondContext = defineContextNode({
      key: "notification-isolation-second",
      initialValue: 10,
    });
    const load = vi.fn(async () => 20);
    const dependent = defineDataNode({
      key: "notification-isolation-dependent",
      dependencies: [secondContext] as const,
      initialValue: 0,
      load,
    });
    const releaseFirst = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [dependent, firstContext, secondContext] }),
    );
    runtime.subscribeNodes([dependent]);
    await runtime.whenSettled();
    load.mockClear();
    const listener = vi.fn();
    runtime.onChange(listener);

    const firstTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(firstContext, 2);
      await releaseFirst.promise;
    });
    await Promise.resolve();

    await runtime.transaction((transaction) => {
      transaction.setContext(secondContext, 20);
    });

    expect(runtime.getState(firstContext).data).toBe(1);
    expect(runtime.getState(secondContext).data).toBe(20);
    expect(listener).toHaveBeenCalled();
    await waitForCondition(
      () => load.mock.calls.length === 1,
      "independent transaction scheduler execution to start",
    );
    await runtime.whenSettled();
    expect(runtime.getState(dependent).data).toBe(20);

    releaseFirst.resolve();
    await firstTransaction;
  });

  it("does not delay subscription notification or scheduling behind an open transaction", async () => {
    const stagedContext = defineContextNode({
      key: "subscription-isolation-staged",
      initialValue: 1,
    });
    const load = vi.fn(async () => 42);
    const data = defineDataNode({
      key: "subscription-isolation-data",
      initialValue: 0,
      load,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [data, stagedContext] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(stagedContext, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    const subscription = runtime.subscribeNodes([data]);

    expect(listener).toHaveBeenCalled();
    await runtime.whenSettled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(data).data).toBe(42);
    expect(runtime.getState(stagedContext).data).toBe(1);

    subscription.unsubscribe();
    releaseTransaction.resolve();
    await pendingTransaction;
  });
  it("dispatches a committed event session while another session remains open", async () => {
    const stagedContext = defineContextNode({
      key: "event-dispatch-isolation-staged",
      initialValue: 1,
    });
    const changed = defineEvent<void>("event-dispatch-isolation.changed");
    const load = vi.fn(async () => 1);
    const target = defineDataNode({
      key: "event-dispatch-isolation-target",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [target, stagedContext] }));
    const subscription = runtime.subscribeNodes([target]);
    await runtime.whenSettled();
    load.mockClear();

    const pendingTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(stagedContext, 2);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    await runtime.transaction((transaction) => {
      transaction.publish(changed, undefined);
    });
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(target)).toMatchObject({
      generation: 1,
      freshness: "fresh",
    });
    expect(runtime.getState(stagedContext)).toMatchObject({
      data: 1,
      generation: 0,
    });

    releaseTransaction.resolve();
    await pendingTransaction;
    subscription.unsubscribe();
  });
});
