import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
  GraphMutationReconciliationError,
  GraphMutationStateError,
  type MutationUpdateEffects,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const createValue = (key: string, load: () => Promise<number> = async () => 1) =>
  defineDataNode({ key, initialValue: 0, load });

const createMutation = (key: string) =>
  defineMutation({
    key,
    execute: async () => ({ saved: true as const }),
  });

const optimisticIncrement =
  (node: ReturnType<typeof createValue>) =>
  (effects: MutationUpdateEffects): void => {
    effects.update(node, (current) => current + 10);
  };

describe("optimistic success reconciliation failure", () => {
  it("retains optimistic state as stale and reports remote success", async () => {
    const value = createValue("reconciliation-failure-value");
    const summary = defineDerivedNode({
      key: "reconciliation-failure-summary",
      dependencies: [value] as const,
      derive: ({ get }) => get(value) * 2,
    });
    const mutation = createMutation("reconciliation-failure.save");
    const failure = new Error("Local reconciliation failed");
    const runtime = createGraphRuntime(createGraph({ nodes: [summary, value] }));
    await runtime.execute([summary]);

    const result = runtime.mutate(mutation, undefined, {
      optimistic: optimisticIncrement(value),
      onSuccess: () => {
        throw failure;
      },
    });

    await expect(result).rejects.toMatchObject({
      name: "GraphMutationReconciliationError",
      mutationKey: mutation.key,
      nodeKeys: [summary.key, value.key].sort(),
      remoteSucceeded: true,
      cause: failure,
    });

    expect(runtime.getState(value)).toMatchObject({
      data: 11,
      freshness: "stale",
      generation: 2,
    });
    expect(runtime.getState(summary)).toMatchObject({
      data: 2,
      freshness: "stale",
      generation: 2,
    });
  });

  it("exposes immutable unique sorted affected node keys", async () => {
    const value = createValue("z-reconciliation-failure-value");
    const summary = defineDerivedNode({
      key: "a-reconciliation-failure-summary",
      dependencies: [value] as const,
      derive: ({ get }) => get(value),
    });
    const mutation = createMutation("reconciliation-failure.error-contract");
    const failure = new Error("Invalid success target");
    const runtime = createGraphRuntime(createGraph({ nodes: [value, summary] }));
    await runtime.execute([summary]);

    let captured: unknown;
    try {
      await runtime.mutate(mutation, undefined, {
        optimistic: optimisticIncrement(value),
        onSuccess: (effects) => {
          effects.update(summary as never, () => 5);
        },
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(GraphMutationReconciliationError);
    const reconciliation = captured as GraphMutationReconciliationError;
    expect(reconciliation.mutationKey).toBe(mutation.key);
    expect(reconciliation.nodeKeys).toEqual([summary.key, value.key]);
    expect(Object.isFrozen(reconciliation.nodeKeys)).toBe(true);
    expect(reconciliation.remoteSucceeded).toBe(true);
    expect(reconciliation.cause).toBeInstanceOf(GraphMutationStateError);
    expect((reconciliation.cause as Error).message).not.toBe(failure.message);
  });

  it("releases ownership so later optimistic work can target the node", async () => {
    const value = createValue("reconciliation-failure-ownership");
    const failedMutation = createMutation("reconciliation-failure.first");
    const succeedingMutation = createMutation("reconciliation-failure.second");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    await expect(
      runtime.mutate(failedMutation, undefined, {
        optimistic: optimisticIncrement(value),
        onSuccess: () => {
          throw new Error("Local reconciliation failed");
        },
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);

    await expect(
      runtime.mutate(succeedingMutation, undefined, {
        optimistic: (effects) => effects.update(value, (current) => current + 1),
      }),
    ).resolves.toEqual({ saved: true });

    expect(runtime.getState(value).data).toBe(12);
  });

  it("reloads subscribed optimistic state authoritatively", async () => {
    let loadCount = 0;
    const authoritativeReload = deferred<number>();
    const value = createValue("reconciliation-failure-subscribed", async () => {
      loadCount += 1;
      return loadCount === 1 ? 1 : authoritativeReload.promise;
    });
    const mutation = createMutation("reconciliation-failure.subscribed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    const subscription = runtime.subscribeNodes([value]);
    await runtime.whenSettled();

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: optimisticIncrement(value),
        onSuccess: () => {
          throw new Error("Local reconciliation failed");
        },
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);

    await waitForCondition(() => loadCount === 2, "authoritative reconciliation load to start");
    expect(runtime.getState(value)).toMatchObject({
      data: 11,
      freshness: "stale",
      status: "refreshing",
    });

    authoritativeReload.resolve(25);
    await runtime.whenSettled();
    expect(runtime.getState(value)).toMatchObject({
      data: 25,
      freshness: "fresh",
      status: "success",
    });
    subscription.unsubscribe();
  });

  it("emits one recovery notification before scheduler work", async () => {
    const value = createValue("reconciliation-failure-notification");
    const mutation = createMutation("reconciliation-failure.notification");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const observed: string[] = [];
    runtime.onChange(() => {
      const state = runtime.getState(value);
      observed.push(`${state.data}:${state.freshness}:${state.generation}`);
    });

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: optimisticIncrement(value),
        onSuccess: () => {
          throw new Error("Local reconciliation failed");
        },
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);

    expect(observed).toEqual(["11:fresh:1", "11:stale:2"]);
  });

  it("commits no success update when a later success updater fails", async () => {
    const first = createValue("reconciliation-failure-first");
    const second = createValue("reconciliation-failure-second");
    const mutation = createMutation("reconciliation-failure.atomic");
    const failure = new Error("Updater failed");
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));
    await runtime.execute([first, second]);

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: (effects) => effects.update(first, (current) => current + 10),
        onSuccess: (effects) => {
          effects.update(first, () => 100);
          effects.update(second, () => {
            throw failure;
          });
        },
      }),
    ).rejects.toMatchObject({
      name: "GraphMutationReconciliationError",
      cause: failure,
    });

    expect(runtime.getState(first)).toMatchObject({
      data: 11,
      freshness: "stale",
    });
    expect(runtime.getState(second)).toMatchObject({
      data: 1,
      freshness: "fresh",
      generation: 0,
    });
  });

  it("recovers from asynchronous success callbacks and updater results", async () => {
    const callbackValue = createValue("reconciliation-failure-async-callback");
    const updaterValue = createValue("reconciliation-failure-async-updater");
    const mutation = createMutation("reconciliation-failure.async");
    const runtime = createGraphRuntime(createGraph({ nodes: [callbackValue, updaterValue] }));
    await runtime.execute([callbackValue, updaterValue]);

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: optimisticIncrement(callbackValue),
        onSuccess: (async () => undefined) as unknown as () => void,
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);
    expect(runtime.getState(callbackValue).freshness).toBe("stale");

    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: optimisticIncrement(updaterValue),
        onSuccess: (effects) => {
          effects.update(updaterValue, (() => Promise.resolve(50)) as unknown as (
            current: number,
          ) => number);
        },
      }),
    ).rejects.toBeInstanceOf(GraphMutationReconciliationError);
    expect(runtime.getState(updaterValue)).toMatchObject({
      data: 11,
      freshness: "stale",
    });
  });

  it("preserves the original local error for non-optimistic success failure", async () => {
    const value = createValue("reconciliation-failure-non-optimistic");
    const mutation = createMutation("reconciliation-failure.non-optimistic");
    const failure = new Error("Local reconciliation failed");
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);

    await expect(
      runtime.mutate(mutation, undefined, {
        onSuccess: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(runtime.getState(value)).toMatchObject({
      data: 1,
      freshness: "fresh",
      generation: 0,
    });
  });
});
