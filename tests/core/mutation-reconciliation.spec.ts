import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineMutation,
  GraphMutationStateError,
  type MutationUpdateEffects,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

const mutation = defineMutation({
  key: "reconciliation.save",
  execute: async (context: { input: { value: number }; signal: AbortSignal }) => ({
    savedValue: context.input.value,
  }),
});

const createLoadedRuntime = async () => {
  const first = defineDataNode({
    key: "reconciliation-first",
    initialValue: 0,
    load: async () => 1,
  });
  const second = defineDataNode({
    key: "reconciliation-second",
    initialValue: "initial",
    load: async () => "loaded",
  });
  const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }));
  await runtime.execute([first, second]);
  return { first, second, runtime };
};

describe("mutation success reconciliation", () => {
  it("updates multiple successful data nodes atomically and returns the result", async () => {
    const { first, second, runtime } = await createLoadedRuntime();
    const observerSnapshots: string[] = [];
    runtime.onChange(() => {
      observerSnapshots.push(
        `${runtime.getState(first).data}:${runtime.getState(second).data}`,
      );
    });

    const result = await runtime.mutate(mutation, { value: 5 }, {
      onSuccess: (effects, response, input) => {
        effects.update(first, current => current + response.savedValue);
        effects.update(second, current => `${current}:${input.value}`);
      },
    });

    expect(result).toEqual({ savedValue: 5 });
    expect(runtime.getState(first)).toMatchObject({
      data: 6,
      status: "success",
      freshness: "fresh",
      generation: 1,
      error: null,
      hasSuccessfulValue: true,
    });
    expect(runtime.getState(second)).toMatchObject({
      data: "loaded:5",
      status: "success",
      freshness: "fresh",
      generation: 1,
      error: null,
      hasSuccessfulValue: true,
    });
    expect(observerSnapshots).toEqual(["6:loaded:5"]);
  });

  it("does not commit any update when an updater throws", async () => {
    const { first, second, runtime } = await createLoadedRuntime();
    const beforeFirst = runtime.getState(first);
    const beforeSecond = runtime.getState(second);
    const failure = new Error("Cannot reconcile response");
    const listener = vi.fn();
    runtime.onChange(listener);

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(first, current => current + 1);
        effects.update(second, () => {
          throw failure;
        });
      },
    })).rejects.toBe(failure);

    expect(runtime.getState(first)).toEqual(beforeFirst);
    expect(runtime.getState(second)).toEqual(beforeSecond);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not evaluate or commit update drafts when onSuccess throws", async () => {
    const { first, runtime } = await createLoadedRuntime();
    const updater = vi.fn((current: number) => current + 1);
    const failure = new Error("Success callback failed");

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(first, updater);
        throw failure;
      },
    })).rejects.toBe(failure);

    expect(updater).not.toHaveBeenCalled();
    expect(runtime.getState(first).data).toBe(1);
  });

  it("rejects asynchronous success callbacks without applying their drafts", async () => {
    const { first, runtime } = await createLoadedRuntime();

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: (async (effects: MutationUpdateEffects) => {
        effects.update(first, current => current + 1);
      }) as unknown as (
        effects: MutationUpdateEffects,
        result: { readonly savedValue: number },
        input: { readonly value: number },
      ) => void,
    })).rejects.toThrow("must be synchronous.");

    expect(runtime.getState(first).data).toBe(1);
  });

  it("rejects duplicate updates before evaluating either updater", async () => {
    const { first, runtime } = await createLoadedRuntime();
    const updater = vi.fn((current: number) => current + 1);

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(first, updater);
        effects.update(first, updater);
      },
    })).rejects.toMatchObject({
      name: "GraphMutationStateError",
      nodeKey: first.key,
    });

    expect(updater).not.toHaveBeenCalled();
    expect(runtime.getState(first).data).toBe(1);
  });

  it("resolves equivalent data-node handles through the registered key", async () => {
    const { first, runtime } = await createLoadedRuntime();
    const equivalent = defineDataNode({
      key: first.key,
      initialValue: 0,
      load: async () => 99,
    });

    await runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => effects.update(equivalent, () => 8),
    });

    expect(runtime.getState(first).data).toBe(8);
  });

  it("rejects a non-data target supplied by untyped JavaScript", async () => {
    const input = defineContextNode({
      key: "reconciliation-invalid-context",
      initialValue: 1,
    });
    const data = defineDataNode({
      key: "reconciliation-valid-data",
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [input, data] }));
    await runtime.execute([data]);

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(input as unknown as typeof data, () => 5);
      },
    })).rejects.toMatchObject({
      name: "GraphMutationStateError",
      nodeKey: input.key,
    });

    expect(runtime.getState(input).data).toBe(1);
    expect(runtime.getState(data).data).toBe(1);
  });

  it("rejects an update when the data node has no successful value", async () => {
    const unloaded = defineDataNode({
      key: "reconciliation-unloaded",
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [unloaded] }));

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(unloaded, () => 5);
      },
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(runtime.getState(unloaded)).toMatchObject({
      data: 0,
      generation: 0,
      hasSuccessfulValue: false,
    });
  });

  it("validates every target before evaluating any updater", async () => {
    const loaded = defineDataNode({
      key: "reconciliation-validated-loaded",
      initialValue: 0,
      load: async () => 1,
    });
    const unloaded = defineDataNode({
      key: "reconciliation-validated-unloaded",
      initialValue: 0,
      load: async () => 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [loaded, unloaded] }));
    await runtime.execute([loaded]);
    const updater = vi.fn((current: number) => current + 1);

    await expect(runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => {
        effects.update(loaded, updater);
        effects.update(unloaded, current => current + 1);
      },
    })).rejects.toBeInstanceOf(GraphMutationStateError);

    expect(updater).not.toHaveBeenCalled();
    expect(runtime.getState(loaded).data).toBe(1);
  });

  it("treats a value and successful fresh state no-op as silent", async () => {
    const { first, runtime } = await createLoadedRuntime();
    const listener = vi.fn();
    runtime.onChange(listener);

    await runtime.mutate(mutation, { value: 1 }, {
      onSuccess: effects => effects.update(first, current => current),
    });

    expect(runtime.getState(first).generation).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("invalidates descendants once while keeping directly updated roots fresh", async () => {
    const parent = defineDataNode({
      key: "reconciliation-parent",
      initialValue: 0,
      load: async () => 1,
    });
    const child = defineDerivedNode({
      key: "reconciliation-child",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent) * 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [parent, child] }));
    await runtime.execute([child]);
    const snapshots: string[] = [];
    runtime.onChange(() => {
      snapshots.push(
        `${runtime.getState(parent).data}:${runtime.getState(child).freshness}`,
      );
    });

    await runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => effects.update(parent, () => 5),
    });

    expect(runtime.getState(parent)).toMatchObject({
      data: 5,
      freshness: "fresh",
      generation: 1,
    });
    expect(runtime.getState(child)).toMatchObject({
      data: 2,
      freshness: "stale",
      generation: 1,
    });
    expect(snapshots).toEqual(["5:stale"]);
  });

  it("schedules subscribed stale descendants through the existing scheduler", async () => {
    const parent = defineDataNode({
      key: "reconciliation-scheduled-parent",
      initialValue: 0,
      load: async () => 1,
    });
    const child = defineDerivedNode({
      key: "reconciliation-scheduled-child",
      dependencies: [parent] as const,
      derive: ({ get }) => get(parent) * 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [parent, child] }));
    const subscription = runtime.subscribeNodes([child]);
    await runtime.whenSettled();

    await runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => effects.update(parent, () => 5),
    });
    await runtime.whenSettled();

    expect(runtime.getState(child)).toMatchObject({
      data: 10,
      freshness: "fresh",
      status: "success",
    });
    subscription.unsubscribe();
  });

  it("advances generations before aborting affected active work", async () => {
    const refreshGate = deferred<number>();
    let requestCount = 0;
    let refreshSignal: AbortSignal | undefined;
    const value = defineDataNode({
      key: "reconciliation-active-value",
      initialValue: 0,
      load: async ({ signal }) => {
        requestCount += 1;
        if (requestCount === 1) return 1;
        refreshSignal = signal;
        return refreshGate.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [value] }));
    await runtime.execute([value]);
    const refresh = runtime.refresh([value]);
    await waitForCondition(
      () => refreshSignal !== undefined,
      "refresh request to start",
    );

    await runtime.mutate(mutation, { value: 5 }, {
      onSuccess: effects => effects.update(value, () => 5),
    });

    expect(refreshSignal?.aborted).toBe(true);
    expect(runtime.getState(value)).toMatchObject({
      data: 5,
      status: "success",
      freshness: "fresh",
      generation: 2,
    });

    refreshGate.resolve(99);
    await refresh;
    expect(runtime.getState(value).data).toBe(5);
  });
});
