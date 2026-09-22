import { describe, expect, it, vi } from "vitest";
import { createGraph, createGraphRuntime, defineDataNode, defineMutation } from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const rejection = new Error("Known rejection");

const createParent = (key: string) =>
  defineDataNode({
    key,
    initialValue: 0,
    load: async () => 1,
  });

describe("optimistic data descendant loading", () => {
  it("allows a subscribed data descendant to settle before mutation success", async () => {
    const parent = createParent("optimistic-descendant-success-parent");
    const descendantReload = deferred<number>();
    let descendantLoads = 0;
    const descendant = defineDataNode({
      key: "optimistic-descendant-success-child",
      dependencies: [parent] as const,
      initialValue: 0,
      load: async ({ get }) => {
        descendantLoads += 1;
        if (descendantLoads === 1) return get(parent) * 10;
        return descendantReload.promise;
      },
    });
    const request = deferred<void>();
    const mutation = defineMutation({
      key: "optimistic-descendant.success",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [descendant, parent] }));
    const subscription = runtime.subscribeNodes([descendant]);
    await runtime.whenSettled();

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(parent, (current) => current + 10),
    });
    await waitForCondition(
      () => descendantLoads === 2,
      "data descendant reload to start before mutation settlement",
    );

    descendantReload.resolve(110);
    await waitForCondition(
      () => runtime.getState(descendant).data === 110,
      "data descendant reload to settle before mutation success",
    );
    const descendantGeneration = runtime.getState(descendant).generation;

    request.resolve();
    await pending;

    expect(runtime.getState(parent)).toMatchObject({
      data: 11,
      freshness: "fresh",
    });
    expect(runtime.getState(descendant)).toMatchObject({
      data: 110,
      freshness: "fresh",
      generation: descendantGeneration,
    });
    subscription.unsubscribe();
  });

  it("reports a rollback conflict when a data descendant settles before known rejection", async () => {
    const parentReload = deferred<number>();
    let parentLoads = 0;
    const parent = defineDataNode({
      key: "optimistic-descendant-rejection-parent",
      initialValue: 0,
      load: async () => {
        parentLoads += 1;
        return parentLoads === 1 ? 1 : parentReload.promise;
      },
    });
    const descendantReload = deferred<number>();
    const authoritativeReload = deferred<number>();
    let descendantLoads = 0;
    const descendant = defineDataNode({
      key: "optimistic-descendant-rejection-child",
      dependencies: [parent] as const,
      initialValue: 0,
      load: async ({ get }) => {
        descendantLoads += 1;
        if (descendantLoads === 1) return get(parent) * 10;
        if (descendantLoads === 2) return descendantReload.promise;
        return authoritativeReload.promise;
      },
    });
    const request = deferred<never>();
    const mutation = defineMutation({
      key: "optimistic-descendant.rejection",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [descendant, parent] }));
    const subscription = runtime.subscribeNodes([descendant]);
    await runtime.whenSettled();

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(parent, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => descendantLoads === 2,
      "data descendant reload to start before known rejection",
    );
    descendantReload.resolve(110);
    await waitForCondition(
      () => runtime.getState(descendant).data === 110,
      "newer data descendant result to commit",
    );

    request.reject(rejection);
    await expect(pending).rejects.toMatchObject({
      name: "GraphMutationRollbackConflictError",
      nodeKeys: [descendant.key],
      cause: rejection,
    });

    await waitForCondition(
      () => parentLoads === 2,
      "authoritative parent reconciliation to start after rollback conflict",
    );
    expect(runtime.getState(parent)).toMatchObject({
      data: 11,
      freshness: "stale",
      status: "refreshing",
    });
    expect(runtime.getState(descendant)).toMatchObject({
      data: 110,
      freshness: "stale",
    });
    expect(runtime.getState(descendant).data).not.toBe(10);
    expect(runtime.getState(parent).data).not.toBe(1);

    parentReload.resolve(1);
    await waitForCondition(
      () => descendantLoads === 3,
      "authoritative descendant reconciliation to start",
    );
    authoritativeReload.resolve(111);
    await runtime.whenSettled();
    expect(runtime.getState(descendant)).toMatchObject({
      data: 111,
      freshness: "fresh",
    });
    subscription.unsubscribe();
  });

  it("keeps an active ignored-abort descendant result obsolete after rollback", async () => {
    const parent = createParent("optimistic-descendant-active-parent");
    const descendantReload = deferred<number>();
    let descendantLoads = 0;
    const descendant = defineDataNode({
      key: "optimistic-descendant-active-child",
      dependencies: [parent] as const,
      initialValue: 0,
      load: async ({ get }) => {
        descendantLoads += 1;
        if (descendantLoads === 1) return get(parent) * 10;
        return descendantReload.promise;
      },
    });
    const request = deferred<never>();
    const mutation = defineMutation({
      key: "optimistic-descendant.active-rejection",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [descendant, parent] }));
    const subscription = runtime.subscribeNodes([descendant]);
    await runtime.whenSettled();

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(parent, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(() => descendantLoads === 2, "active descendant reload to start");
    const optimisticDescendantGeneration = runtime.getState(descendant).generation;

    request.reject(rejection);
    await expect(pending).rejects.toBe(rejection);

    const rollbackDescendantGeneration = runtime.getState(descendant).generation;
    expect(rollbackDescendantGeneration).toBeGreaterThan(optimisticDescendantGeneration);
    expect(runtime.getState(descendant)).toMatchObject({
      data: 10,
      freshness: "fresh",
    });

    descendantReload.resolve(110);
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getState(descendant)).toMatchObject({
      data: 10,
      generation: rollbackDescendantGeneration,
    });
    subscription.unsubscribe();
  });

  it("starts mutation execution outside a full data-load concurrency slot", async () => {
    const parent = createParent("optimistic-descendant-concurrency-parent");
    let descendantLoads = 0;
    const descendantReload = deferred<number>();
    const descendant = defineDataNode({
      key: "optimistic-descendant-concurrency-child",
      dependencies: [parent] as const,
      initialValue: 0,
      load: async ({ get }) => {
        descendantLoads += 1;
        if (descendantLoads === 1) return get(parent) * 10;
        return descendantReload.promise;
      },
    });
    const blockerRefresh = deferred<number>();
    let blockerLoads = 0;
    const blocker = defineDataNode({
      key: "optimistic-descendant-concurrency-blocker",
      initialValue: 0,
      load: async () => {
        blockerLoads += 1;
        if (blockerLoads === 1) return 1;
        return blockerRefresh.promise;
      },
    });
    const request = deferred<void>();
    const execute = vi.fn(async () => request.promise);
    const mutation = defineMutation({
      key: "optimistic-descendant.concurrency",
      execute,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [blocker, descendant, parent] }), {
      maxConcurrentLoads: 1,
    });
    const subscription = runtime.subscribeNodes([descendant]);
    await runtime.whenSettled();
    await runtime.execute([blocker]);

    const blockingRefresh = runtime.refresh([blocker]);
    await waitForCondition(() => blockerLoads === 2, "blocking data load to occupy the only slot");

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(parent, (current) => current + 10),
    });
    await waitForCondition(
      () => execute.mock.calls.length === 1,
      "mutation request to start outside the data-load limiter",
    );

    expect(descendantLoads).toBe(1);
    expect(runtime.getState(descendant).freshness).toBe("stale");

    blockerRefresh.resolve(2);
    await blockingRefresh;
    await waitForCondition(
      () => descendantLoads === 2,
      "queued descendant reload to acquire the released slot",
    );

    descendantReload.resolve(110);
    request.resolve();
    await pending;
    await runtime.whenSettled();

    expect(runtime.getState(descendant).data).toBe(110);
    subscription.unsubscribe();
  });
});
