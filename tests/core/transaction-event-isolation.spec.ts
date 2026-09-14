import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineEvent,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("transaction event ownership", () => {
  it("applies a plain runtime publication while another transaction is open", async () => {
    const stagedEvent = defineEvent<void>("transaction.staged");
    const immediateEvent = defineEvent<void>("runtime.immediate");
    const stagedTarget = defineDataNode({
      key: "staged-target",
      invalidatedBy: [stagedEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const immediateTarget = defineDataNode({
      key: "immediate-target",
      invalidatedBy: [immediateEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedTarget, immediateTarget] }),
    );

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.publish(stagedEvent, undefined);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.publish(immediateEvent, undefined);

    expect(runtime.getState(stagedTarget).generation).toBe(0);
    expect(runtime.getState(immediateTarget)).toMatchObject({
      generation: 1,
      freshness: "stale",
    });

    releaseTransaction.resolve();
    await pendingTransaction;

    expect(runtime.getState(stagedTarget).generation).toBe(1);
    expect(runtime.getState(immediateTarget).generation).toBe(1);
  });

  it("preserves a plain runtime publication when another transaction rolls back", async () => {
    const stagedEvent = defineEvent<void>("transaction.rollback-staged");
    const immediateEvent = defineEvent<void>("runtime.rollback-independent");
    const stagedTarget = defineDataNode({
      key: "rollback-staged-target",
      invalidatedBy: [stagedEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const immediateTarget = defineDataNode({
      key: "rollback-immediate-target",
      invalidatedBy: [immediateEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedTarget, immediateTarget] }),
    );

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.publish(stagedEvent, undefined);
      await releaseTransaction.promise;
      throw new Error("rollback");
    });
    await Promise.resolve();

    runtime.publish(immediateEvent, undefined);
    expect(runtime.getState(immediateTarget)).toMatchObject({
      generation: 1,
      freshness: "stale",
    });

    releaseTransaction.resolve();
    await expect(pendingTransaction).rejects.toThrow("rollback");

    expect(runtime.getState(stagedTarget).generation).toBe(0);
    expect(runtime.getState(immediateTarget)).toMatchObject({
      generation: 1,
      freshness: "stale",
    });
  });
  it("notifies and schedules an unrelated publication before the transaction closes", async () => {
    const stagedEvent = defineEvent<void>("transaction.dispatch-staged");
    const immediateEvent = defineEvent<void>("runtime.dispatch-immediate");
    const stagedTarget = defineDataNode({
      key: "dispatch-event-staged-target",
      invalidatedBy: [stagedEvent] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const load = vi.fn(async () => 2);
    const immediateTarget = defineDataNode({
      key: "dispatch-event-immediate-target",
      invalidatedBy: [immediateEvent] as const,
      initialValue: 0,
      load,
    });
    const releaseTransaction = deferred<void>();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [stagedTarget, immediateTarget] }),
    );
    runtime.subscribeNodes([immediateTarget]);
    await runtime.whenSettled();
    load.mockClear();
    const listener = vi.fn();
    runtime.onChange(listener);

    const pendingTransaction = runtime.transaction(async transaction => {
      transaction.publish(stagedEvent, undefined);
      await releaseTransaction.promise;
    });
    await Promise.resolve();

    runtime.publish(immediateEvent, undefined);

    expect(listener).toHaveBeenCalled();
    await runtime.whenSettled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(immediateTarget).data).toBe(2);

    releaseTransaction.resolve();
    await pendingTransaction;
  });

});
