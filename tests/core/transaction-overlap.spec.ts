import { describe, expect, it } from "vitest";
import { createGraph, createGraphRuntime, defineContextNode } from "../../src/core";
import { deferred } from "./test-helpers";

describe("overlapping transaction sessions", () => {
  it("commits disjoint sessions independently in completion order", async () => {
    const first = defineContextNode({ key: "overlap-first", initialValue: 1 });
    const second = defineContextNode({ key: "overlap-second", initialValue: 10 });
    const releaseFirst = deferred<void>();
    const releaseSecond = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));

    const firstTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(first, 2);
      await releaseFirst.promise;
    });
    const secondTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(second, 20);
      await releaseSecond.promise;
    });

    releaseSecond.resolve();
    await secondTransaction;

    expect(runtime.getState(first)).toMatchObject({ data: 1, generation: 0 });
    expect(runtime.getState(second)).toMatchObject({ data: 20, generation: 1 });

    releaseFirst.resolve();
    await firstTransaction;

    expect(runtime.getState(first)).toMatchObject({ data: 2, generation: 1 });
    expect(runtime.getState(second)).toMatchObject({ data: 20, generation: 1 });
  });

  it("does not commit a failed session through an overlapping successful session", async () => {
    const successful = defineContextNode({
      key: "overlap-successful",
      initialValue: 1,
    });
    const failed = defineContextNode({ key: "overlap-failed", initialValue: 10 });
    const releaseSuccessful = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [successful, failed] }));

    const successfulTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(successful, 2);
      await releaseSuccessful.promise;
    });
    const failedTransaction = runtime.transaction((transaction) => {
      transaction.setContext(failed, 20);
      throw new Error("independent failure");
    });

    await expect(failedTransaction).rejects.toThrow("independent failure");
    expect(runtime.getState(successful)).toMatchObject({ data: 1, generation: 0 });
    expect(runtime.getState(failed)).toMatchObject({ data: 10, generation: 0 });

    releaseSuccessful.resolve();
    await successfulTransaction;

    expect(runtime.getState(successful)).toMatchObject({ data: 2, generation: 1 });
    expect(runtime.getState(failed)).toMatchObject({ data: 10, generation: 0 });
  });

  it("preserves a successful session when another overlapping session rolls back", async () => {
    const rolledBack = defineContextNode({
      key: "overlap-rolled-back",
      initialValue: 1,
    });
    const committed = defineContextNode({
      key: "overlap-committed",
      initialValue: 10,
    });
    const releaseRollback = deferred<void>();
    const releaseCommit = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [rolledBack, committed] }));

    const rolledBackTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(rolledBack, 2);
      await releaseRollback.promise;
      throw new Error("independent rollback");
    });
    const committedTransaction = runtime.transaction(async (transaction) => {
      transaction.setContext(committed, 20);
      await releaseCommit.promise;
    });

    releaseRollback.resolve();
    await expect(rolledBackTransaction).rejects.toThrow("independent rollback");

    releaseCommit.resolve();
    await committedTransaction;

    expect(runtime.getState(rolledBack)).toMatchObject({ data: 1, generation: 0 });
    expect(runtime.getState(committed)).toMatchObject({ data: 20, generation: 1 });
  });
});
