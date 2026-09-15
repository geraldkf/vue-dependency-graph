import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineMutation,
  GraphMutationOutcomeUnknownError,
  GraphMutationRollbackConflictError,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const createValue = (key: string, load: () => Promise<number> = async () => 1) =>
  defineDataNode({ key, initialValue: 0, load });

describe("mutation outcomes and races", () => {
  it("retains optimistic data as stale and schedules authoritative reload for unknown outcomes", async () => {
    let loadCount = 0;
    const value = createValue("unknown-reconcile", async () => {
      loadCount += 1;
      return loadCount;
    });
    const failure = new Error("Response lost");
    const mutation = defineMutation({
      key: "unknown-reconcile.save",
      execute: async () => {
        throw failure;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    const subscription = runtime.subscribeNodes([value]);
    await runtime.whenSettled();

    const outcome = runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(value, current => current + 10),
    });

    await expect(outcome).rejects.toMatchObject({
      name: "GraphMutationOutcomeUnknownError",
      cause: failure,
      nodeKeys: [value.key],
    });
    await runtime.whenSettled();

    expect(loadCount).toBe(2);
    expect(runtime.getState(value)).toMatchObject({
      data: 2,
      status: "success",
      freshness: "fresh",
    });
    subscription.unsubscribe();
  });

  it("uses the safe unknown path when the failure classifier throws", async () => {
    const value = createValue("classifier-failure");
    const remoteFailure = new Error("Remote outcome unavailable");
    const mutation = defineMutation({
      key: "classifier-failure.save",
      execute: async () => {
        throw remoteFailure;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    await expect(runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(value, current => current + 10),
      classifyFailure: () => {
        throw new Error("Classifier failed");
      },
    })).rejects.toMatchObject({
      name: "GraphMutationOutcomeUnknownError",
      cause: remoteFailure,
    });

    expect(runtime.getState(value)).toMatchObject({
      data: 11,
      freshness: "stale",
    });
  });

  it("does not overwrite a newer direct reconciliation during known-rejection rollback", async () => {
    const value = createValue("rollback-conflict");
    const optimisticRequest = deferred<void>();
    const remoteFailure = new Error("Known rejection");
    const optimisticMutation = defineMutation({
      key: "rollback-conflict.optimistic",
      execute: async () => optimisticRequest.promise,
    });
    const independentMutation = defineMutation({
      key: "rollback-conflict.independent",
      execute: async () => 99,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    const optimistic = runtime.mutate(optimisticMutation, undefined, {
      optimistic: effects => effects.update(value, current => current + 10),
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(value).data === 11,
      "optimistic value to become visible",
    );

    await runtime.mutate(independentMutation, undefined, {
      onSuccess: (effects, result) => effects.update(value, () => result),
    });
    optimisticRequest.reject(remoteFailure);

    await expect(optimistic).rejects.toMatchObject({
      name: "GraphMutationRollbackConflictError",
      cause: remoteFailure,
      nodeKeys: [value.key],
    });
    expect(runtime.getState(value)).toMatchObject({
      data: 99,
      freshness: "stale",
    });
  });

  it("reports immutable sorted keys when descendant work prevents rollback", async () => {
    const left = createValue("rollback-conflict-left");
    const right = createValue("rollback-conflict-right");
    const request = deferred<void>();
    const failure = new Error("Rejected");
    const mutation = defineMutation({
      key: "rollback-conflict.multiple",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [right, left] }));
    await runtime.execute([left, right]);

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: effects => {
        effects.update(right, current => current + 10);
        effects.update(left, current => current + 10);
      },
      classifyFailure: () => "rejected",
    });
    await waitForCondition(
      () => runtime.getState(left).data === 11,
      "optimistic values to become visible",
    );

    await runtime.refresh([right, left]);
    request.reject(failure);

    let caught: unknown;
    try {
      await pending;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraphMutationRollbackConflictError);
    const conflict = caught as GraphMutationRollbackConflictError;
    expect(conflict.nodeKeys).toEqual([left.key, right.key]);
    expect(Object.isFrozen(conflict.nodeKeys)).toBe(true);
    expect(conflict.cause).toBe(failure);
  });

  it("allows disjoint optimistic mutations to settle independently", async () => {
    const left = createValue("disjoint-left");
    const right = createValue("disjoint-right");
    const leftRequest = deferred<void>();
    const rightRequest = deferred<void>();
    const leftMutation = defineMutation({
      key: "disjoint.left",
      execute: async () => leftRequest.promise,
    });
    const rightMutation = defineMutation({
      key: "disjoint.right",
      execute: async () => rightRequest.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [left, right] }));
    await runtime.execute([left, right]);

    const leftPending = runtime.mutate(leftMutation, undefined, {
      optimistic: effects => effects.update(left, current => current + 10),
    });
    const rightPending = runtime.mutate(rightMutation, undefined, {
      optimistic: effects => effects.update(right, current => current + 20),
    });
    await waitForCondition(
      () => runtime.getState(left).data === 11 && runtime.getState(right).data === 21,
      "disjoint optimistic values to become visible",
    );

    rightRequest.resolve();
    await rightPending;
    expect(runtime.getState(left).data).toBe(11);
    expect(runtime.getState(right).data).toBe(21);

    leftRequest.resolve();
    await leftPending;
  });

  it("keeps context and transaction operations independent while optimistic work is pending", async () => {
    const value = createValue("independent-operations");
    const request = deferred<void>();
    const mutation = defineMutation({
      key: "independent-operations.save",
      execute: async () => request.promise,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: effects => effects.update(value, current => current + 10),
    });
    await waitForCondition(
      () => runtime.getState(value).data === 11,
      "optimistic value to become visible",
    );

    await runtime.transaction(async () => undefined);
    expect(runtime.getState(value).data).toBe(11);

    request.resolve();
    await pending;
  });
});
