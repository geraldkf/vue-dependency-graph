import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
} from "../../src/core";
import { deferred } from "./test-helpers";

describe("overlapping transactions", () => {
  it("joins overlapping transaction calls and commits after every participant settles", async () => {
    const first = defineContextNode({ key: "overlap-first", initialValue: 1 });
    const second = defineContextNode({ key: "overlap-second", initialValue: 10 });
    const releaseRoot = deferred<void>();
    const releaseJoined = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));
    let rootSettled = false;

    const rootTransaction = runtime.transaction(async () => {
      runtime.setContext(first, 2);
      await releaseRoot.promise;
    }).then(() => {
      rootSettled = true;
    });

    const joinedTransaction = runtime.transaction(async () => {
      runtime.setContext(second, 20);
      await releaseJoined.promise;
    });

    releaseRoot.resolve();
    await Promise.resolve();

    expect(rootSettled).toBe(false);
    expect(runtime.getState(first).data).toBe(1);
    expect(runtime.getState(second).data).toBe(10);

    releaseJoined.resolve();
    await Promise.all([rootTransaction, joinedTransaction]);

    expect(rootSettled).toBe(true);
    expect(runtime.getState(first).data).toBe(2);
    expect(runtime.getState(second).data).toBe(20);
  });

  it("uses the root transaction outcome when a joined overlapping call fails", async () => {
    const context = defineContextNode({ key: "overlap-joined-failure", initialValue: 1 });
    const releaseRoot = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const rootTransaction = runtime.transaction(async () => {
      await releaseRoot.promise;
    });
    const joinedTransaction = runtime.transaction(() => {
      runtime.setContext(context, 2);
      throw new Error("joined failure");
    });

    await expect(joinedTransaction).rejects.toThrow("joined failure");
    releaseRoot.resolve();
    await rootTransaction;

    expect(runtime.getState(context).data).toBe(2);
    expect(runtime.getState(context).generation).toBe(1);
  });

  it("rolls back joined overlapping work when the root transaction fails", async () => {
    const context = defineContextNode({ key: "overlap-root-failure", initialValue: 1 });
    const releaseRoot = deferred<void>();
    const releaseJoined = deferred<void>();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const rootTransaction = runtime.transaction(async () => {
      await releaseRoot.promise;
      throw new Error("root failure");
    });
    const joinedTransaction = runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await releaseJoined.promise;
    });

    releaseRoot.resolve();
    releaseJoined.resolve();

    await expect(rootTransaction).rejects.toThrow("root failure");
    await joinedTransaction;

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
  });
});
