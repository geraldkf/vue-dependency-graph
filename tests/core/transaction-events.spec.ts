import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  type EventInvalidationContext,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction event publication", () => {
  it("keeps event effects staged until successful commit", async () => {
    const changed = defineEvent<void>("domain.changed");
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const gate = deferred<void>();
    const transaction = runtime.transaction(async transaction => {
      transaction.publish(changed, undefined);
      await gate.promise;
    });
    await Promise.resolve();

    expect(runtime.getState(data).generation).toBe(0);
    gate.resolve();
    await transaction;

    expect(runtime.getState(data).generation).toBe(1);
    expect(runtime.getState(data).freshness).toBe("stale");
  });

  it("discards staged publications when the transaction rolls back", async () => {
    const changed = defineEvent<void>("domain.changed");
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(runtime.transaction(transaction => {
      transaction.publish(changed, undefined);
      throw new Error("rollback");
    })).rejects.toThrowError("rollback");

    expect(runtime.getState(data).generation).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(runtime.getSchedulerState().isScheduled).toBe(false);
  });

  it("evaluates predicates against final staged context values", async () => {
    const jobSeekerId = defineContextNode({
      key: "jobSeekerId",
      initialValue: 1,
    });
    const changed = defineEvent<{ jobSeekerId: number }>("domain.changed");
    const data = defineDataNode({
      key: "data",
      dependencies: [jobSeekerId] as const,
      invalidatedBy: [{
        event: changed,
        when: ({ payload, get }: EventInvalidationContext<
          typeof changed,
          readonly [typeof jobSeekerId]
        >) => payload.jobSeekerId === get(jobSeekerId),
      }] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, jobSeekerId] }));

    await runtime.transaction(transaction => {
      transaction.setContext(jobSeekerId, 2);
      transaction.publish(changed, { jobSeekerId: 2 });
      expect(runtime.getState(jobSeekerId).data).toBe(1);
      expect(runtime.getState(data).generation).toBe(0);
    });

    expect(runtime.getState(jobSeekerId)).toMatchObject({
      data: 2,
      generation: 1,
    });
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("deduplicates combined context and event invalidation", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const changed = defineEvent<void>("domain.changed");
    const target = defineDataNode({
      key: "target",
      dependencies: [context] as const,
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const descendant = defineDerivedNode({
      key: "descendant",
      dependencies: [target] as const,
      derive: () => 2,
    });
    const runtime = createGraphRuntime(createGraph({
      nodes: [descendant, target, context],
    }));
    const listener = vi.fn();
    runtime.onChange(listener);

    await runtime.transaction(transaction => {
      transaction.setContext(context, 2);
      transaction.publish(changed, undefined);
      transaction.publish(changed, undefined);
    });

    expect(runtime.getState(context).generation).toBe(1);
    expect(runtime.getState(target).generation).toBe(1);
    expect(runtime.getState(descendant).generation).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("preserves publication order while deduplicating graph effects", async () => {
    const order: number[] = [];
    const changed = defineEvent<{ sequence: number }>("domain.changed");
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [{
        event: changed,
        when: ({ payload }: EventInvalidationContext<
          typeof changed,
          readonly []
        >) => {
          order.push(payload.sequence);
          return true;
        },
      }] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.transaction(transaction => {
      transaction.publish(changed, { sequence: 1 });
      transaction.publish(changed, { sequence: 2 });
    });

    expect(order).toEqual([1, 2]);
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("applies no context or event changes when a commit predicate throws", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const changed = defineEvent<void>("domain.changed");
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      invalidatedBy: [{
        event: changed,
        when: () => {
          throw new Error("predicate failed");
        },
      }] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));

    await expect(runtime.transaction(transaction => {
      transaction.setContext(context, 2);
      transaction.publish(changed, undefined);
    })).rejects.toThrowError("predicate failed");

    expect(runtime.getState(context)).toMatchObject({ data: 1, generation: 0 });
    expect(runtime.getState(data).generation).toBe(0);
  });

  it("shares staged publications across explicitly nested work and follows the outer outcome", async () => {
    const changed = defineEvent<void>("domain.changed");
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const nestedGate = deferred<void>();

    const outer = runtime.transaction(async transaction => {
      const nested = transaction.transaction(async inner => {
        inner.publish(changed, undefined);
        await nestedGate.promise;
      });
      await Promise.resolve();
      nestedGate.resolve();
      await nested;
    });

    await outer;
    expect(runtime.getState(data).generation).toBe(1);

    await expect(runtime.transaction(async transaction => {
      await transaction.transaction(inner => {
        inner.publish(changed, undefined);
      });
      throw new Error("outer failed");
    })).rejects.toThrowError("outer failed");

    expect(runtime.getState(data).generation).toBe(1);
  });


  it("does not abort affected work until the transaction commits", async () => {
    const changed = defineEvent<void>("domain.changed");
    const result = deferred<string>();
    const gate = deferred<void>();
    let signal: AbortSignal | undefined;
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: "initial",
      load: ({ signal: attemptSignal }) => {
        signal = attemptSignal;
        return result.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signal !== undefined, "active event attempt");

    const transaction = runtime.transaction(async transaction => {
      transaction.publish(changed, undefined);
      await gate.promise;
    });
    await Promise.resolve();

    expect(signal?.aborted).toBe(false);
    expect(runtime.getState(data).generation).toBe(0);

    gate.resolve();
    await transaction;
    expect(runtime.getState(data).generation).toBe(1);
    expect(signal?.aborted).toBe(true);

    result.resolve("obsolete");
    await execution;
    expect(runtime.getState(data).data).toBe("initial");
  });

  it("keeps transaction settlement pending through event-triggered scheduler work", async () => {
    const changed = defineEvent<void>("domain.changed");
    const secondLoad = deferred<number>();
    const load = vi.fn(async () =>
      load.mock.calls.length === 1 ? 1 : secondLoad.promise
    );
    const data = defineDataNode({
      key: "data",
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();

    await runtime.transaction(transaction => {
      transaction.publish(changed, undefined);
    });

    await waitForCondition(
      () => load.mock.calls.length === 2,
      "event-triggered scheduler load"
    );
    let settled = false;
    const transactionSettlement = runtime.whenSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    secondLoad.resolve(2);
    await transactionSettlement;
    expect(settled).toBe(true);
  });
});
