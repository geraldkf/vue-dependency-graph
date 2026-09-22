import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const knownRejection = new Error("Known rejection");

const createRejectedMutation = (key: string) => {
  const request = deferred<never>();
  return {
    mutation: defineMutation({
      key,
      execute: async () => request.promise,
    }),
    reject: () => request.reject(knownRejection),
  };
};

describe("optimistic rollback scheduling", () => {
  it("schedules authoritative work when rollback restores a stale subscribed snapshot", async () => {
    const staleLoad = deferred<number>();
    const recoveryLoad = deferred<number>();
    let loadCount = 0;
    const value = defineDataNode({
      key: "rollback-scheduling-stale-subscribed",
      initialValue: 0,
      load: async () => {
        loadCount += 1;
        if (loadCount === 1) return 1;
        if (loadCount === 2) return staleLoad.promise;
        return recoveryLoad.promise;
      },
    });
    const { mutation, reject } = createRejectedMutation("rollback-scheduling.stale-subscribed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    const subscription = runtime.subscribeNodes([value]);
    await runtime.whenSettled();

    const staleRefresh = runtime.refresh([value]);
    await waitForCondition(() => loadCount === 2, "stale refresh to start");

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(value, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(() => runtime.getState(value).data === 11, "optimistic value to appear");

    reject();
    await expect(pending).rejects.toBe(knownRejection);
    await waitForCondition(() => loadCount === 3, "rollback recovery load to start");

    expect(runtime.getState(value)).toMatchObject({
      data: 1,
      freshness: "stale",
      status: "refreshing",
    });

    staleLoad.resolve(99);
    await staleRefresh;
    expect(runtime.getState(value).data).toBe(1);

    let settled = false;
    const settlement = runtime.whenSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    recoveryLoad.resolve(25);
    await settlement;
    expect(runtime.getState(value)).toMatchObject({
      data: 25,
      freshness: "fresh",
      status: "success",
    });
    subscription.unsubscribe();
  });

  it("does not schedule when rollback restores a fresh subscribed snapshot", async () => {
    let loadCount = 0;
    const value = defineDataNode({
      key: "rollback-scheduling-fresh-subscribed",
      initialValue: 0,
      load: async () => {
        loadCount += 1;
        return loadCount;
      },
    });
    const { mutation, reject } = createRejectedMutation("rollback-scheduling.fresh-subscribed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    const subscription = runtime.subscribeNodes([value]);
    await runtime.whenSettled();

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(value, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(value).data === 11,
      "fresh optimistic value to appear",
    );

    reject();
    await expect(pending).rejects.toBe(knownRejection);
    await runtime.whenSettled();

    expect(loadCount).toBe(1);
    expect(runtime.getState(value)).toMatchObject({
      data: 1,
      freshness: "fresh",
      status: "success",
    });
    subscription.unsubscribe();
  });

  it("does not schedule when rollback restores a stale unsubscribed snapshot", async () => {
    const staleLoad = deferred<number>();
    let loadCount = 0;
    const value = defineDataNode({
      key: "rollback-scheduling-stale-unsubscribed",
      initialValue: 0,
      load: async () => {
        loadCount += 1;
        return loadCount === 1 ? 1 : staleLoad.promise;
      },
    });
    const { mutation, reject } = createRejectedMutation("rollback-scheduling.stale-unsubscribed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    const staleRefresh = runtime.refresh([value]);
    await waitForCondition(() => loadCount === 2, "unsubscribed refresh to start");
    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(value, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(value).data === 11,
      "unsubscribed optimistic value to appear",
    );

    reject();
    await expect(pending).rejects.toBe(knownRejection);
    await runtime.whenSettled();
    expect(loadCount).toBe(2);

    staleLoad.resolve(99);
    await staleRefresh;
    expect(runtime.getState(value)).toMatchObject({
      data: 1,
      freshness: "stale",
    });
  });

  it("coalesces multiple restored stale subscribed snapshots into one scheduler pass", async () => {
    const staleLeft = deferred<number>();
    const staleRight = deferred<number>();
    const recoveryLeft = deferred<number>();
    const recoveryRight = deferred<number>();
    let leftLoads = 0;
    let rightLoads = 0;
    const left = defineDataNode({
      key: "rollback-scheduling-multiple-left",
      initialValue: 0,
      load: async () => {
        leftLoads += 1;
        if (leftLoads === 1) return 1;
        if (leftLoads === 2) return staleLeft.promise;
        return recoveryLeft.promise;
      },
    });
    const right = defineDataNode({
      key: "rollback-scheduling-multiple-right",
      initialValue: 0,
      load: async () => {
        rightLoads += 1;
        if (rightLoads === 1) return 2;
        if (rightLoads === 2) return staleRight.promise;
        return recoveryRight.promise;
      },
    });
    const { mutation, reject } = createRejectedMutation("rollback-scheduling.multiple");
    const runtime = createGraphRuntime(createGraph({ nodes: [left, right] }));
    const subscription = runtime.subscribeNodes([left, right]);
    await runtime.whenSettled();

    const staleRefresh = runtime.refresh([left, right]);
    await waitForCondition(
      () => leftLoads === 2 && rightLoads === 2,
      "both stale refreshes to start",
    );
    const scheduledTransitions: boolean[] = [];
    runtime.onChange(() => {
      scheduledTransitions.push(runtime.getSchedulerState().isScheduled);
    });

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => {
        effects.update(left, (current) => current + 10);
        effects.update(right, (current) => current + 10);
      },
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(left).data === 11 && runtime.getState(right).data === 12,
      "both optimistic values to appear",
    );

    reject();
    await expect(pending).rejects.toBe(knownRejection);
    await waitForCondition(
      () => leftLoads === 3 && rightLoads === 3,
      "both rollback recovery loads to start",
    );

    expect(scheduledTransitions.filter(Boolean)).toHaveLength(1);

    staleLeft.resolve(91);
    staleRight.resolve(92);
    recoveryLeft.resolve(21);
    recoveryRight.resolve(22);
    await staleRefresh;
    await runtime.whenSettled();

    expect(runtime.getState(left).data).toBe(21);
    expect(runtime.getState(right).data).toBe(22);
    subscription.unsubscribe();
  });

  it("coalesces shared stale ancestor and descendant recovery", async () => {
    const staleParent = deferred<number>();
    const recoveryParent = deferred<number>();
    let parentLoads = 0;
    let deriveCount = 0;
    const parent = defineDataNode({
      key: "rollback-scheduling-shared-parent",
      initialValue: 0,
      load: async () => {
        parentLoads += 1;
        if (parentLoads === 1) return 1;
        if (parentLoads === 2) return staleParent.promise;
        return recoveryParent.promise;
      },
    });
    const child = defineDerivedNode({
      key: "rollback-scheduling-shared-child",
      dependencies: [parent] as const,
      derive: ({ get }) => {
        deriveCount += 1;
        return get(parent) * 2;
      },
    });
    const { mutation, reject } = createRejectedMutation("rollback-scheduling.shared-graph");
    const runtime = createGraphRuntime(createGraph({ nodes: [child, parent] }));
    const subscription = runtime.subscribeNodes([child]);
    await runtime.whenSettled();

    const staleRefresh = runtime.refresh([parent, child]);
    await waitForCondition(() => parentLoads === 2, "shared parent refresh to start");
    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => effects.update(parent, (current) => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(parent).data === 11 && runtime.getState(child).data === 22,
      "shared graph optimistic values to appear",
    );
    const deriveCountAfterOptimistic = deriveCount;

    reject();
    await expect(pending).rejects.toBe(knownRejection);
    await waitForCondition(() => parentLoads === 3, "shared graph recovery to start");

    staleParent.resolve(90);
    recoveryParent.resolve(5);
    await staleRefresh;
    await runtime.whenSettled();

    expect(runtime.getState(parent).data).toBe(5);
    expect(runtime.getState(child).data).toBe(10);
    expect(deriveCount).toBe(deriveCountAfterOptimistic + 1);
    subscription.unsubscribe();
  });
});
