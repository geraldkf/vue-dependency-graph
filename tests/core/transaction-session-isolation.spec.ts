import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  GraphTransactionConflictError,
} from "../../src/core";
import { deferred } from "./test-helpers";

/**
 * Direct coverage for the isolated-session model introduced by
 * `docs/implementation/114-transaction-overlap-isolation-plan.md`
 * (C1). Two `runtime.transaction(...)` calls never share staged state
 * unless one explicitly reuses a handle it was already given (see C2) --
 * overlapping in wall-clock time is not the same as composing.
 */
describe("transaction session isolation", () => {
  it("commits or rolls back each overlapping call based only on its own outcome", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const releaseFailing = deferred<void>();

    const succeeding = runtime.transaction(transaction => {
      transaction.setContext(context, 2);
    });
    const failing = runtime
      .transaction(async transaction => {
        transaction.setContext(context, 3);
        await releaseFailing.promise;
        throw new Error("unrelated failure");
      })
      .catch((error: unknown) => error);

    await succeeding;
    // The succeeding call already committed above -- confirm the still-open
    // failing call hasn't (and can't) disturb it.
    expect(runtime.getState(context).data).toBe(2);

    releaseFailing.resolve();
    const failingResult = await failing;

    expect(failingResult).toBeInstanceOf(Error);
    // The failing call's own write never lands, and it has no effect on
    // the already-committed, unrelated succeeding call's value.
    expect(runtime.getState(context).data).toBe(2);
  });

  it("commits two unrelated overlapping calls to different contexts independently, in either completion order", async () => {
    const first = defineContextNode({ key: "context-a", initialValue: 1 });
    const second = defineContextNode({ key: "context-b", initialValue: 10 });
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));
    const releaseFirst = deferred<void>();

    const firstTransaction = runtime.transaction(async transaction => {
      transaction.setContext(first, 2);
      await releaseFirst.promise;
    });
    const secondTransaction = runtime.transaction(transaction => {
      transaction.setContext(second, 20);
    });

    await secondTransaction;
    expect(runtime.getState(second).data).toBe(20);
    // First hasn't released yet -- confirm it's genuinely independent, not
    // waiting on or blocked by the second call finishing.
    expect(runtime.getState(first).data).toBe(1);

    releaseFirst.resolve();
    await firstTransaction;
    expect(runtime.getState(first).data).toBe(2);
  });

  it("still raises a conflict for two overlapping calls writing the same context, via the ordinary generation check", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const releaseSecond = deferred<void>();

    const firstTransaction = runtime.transaction(transaction => {
      transaction.setContext(context, 2);
    });
    await firstTransaction;

    const secondTransaction = runtime.transaction(async transaction => {
      transaction.setContext(context, 3);
      await releaseSecond.promise;
    });

    // An unrelated immediate write changes the generation the second call
    // already staged against, before it commits.
    runtime.setContext(context, 99);
    releaseSecond.resolve();

    await expect(secondTransaction).rejects.toThrow(GraphTransactionConflictError);
    expect(runtime.getState(context).data).toBe(99);
  });
});
