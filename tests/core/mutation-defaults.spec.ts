import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineMutation,
  GraphMutationOutcomeUnknownError,
  type DefineMutationOptions,
} from "../../src/core";
import { deferred } from "./test-helpers";

const createCounter = (key: string) => {
  let loads = 0;
  const node = defineDataNode({
    key,
    initialValue: 0,
    load: async () => {
      loads += 1;
      return 10;
    },
  });
  return { node, loads: () => loads };
};

describe("mutation default effects", () => {
  it("leaves a definition without defaults exactly as before", () => {
    const execute = async () => 1;
    const mutation = defineMutation({ key: "defaults.none", execute });

    expect(mutation).toEqual({ key: "defaults.none", execute });
    expect("defaults" in mutation).toBe(false);
  });

  it("stores supplied defaults on a frozen definition", () => {
    const optimistic = vi.fn();
    const mutation = defineMutation({
      key: "defaults.stored",
      execute: async () => 1,
      optimistic,
    });

    expect(Object.isFrozen(mutation)).toBe(true);
    expect(Object.isFrozen(mutation.defaults)).toBe(true);
    expect(mutation.defaults).toEqual({ optimistic });
  });

  it.each(["optimistic", "onSuccess", "classifyFailure"] as const)(
    "rejects a non-function %s default from untyped JavaScript",
    (field) => {
      const malformed = {
        key: "defaults.malformed",
        execute: async () => 1,
        [field]: "not a function",
      } as unknown as DefineMutationOptions<void, number>;

      expect(() => defineMutation(malformed)).toThrow(
        `Mutation ${field} must be a function when provided.`,
      );
    },
  );

  it("applies default optimistic and onSuccess effects when the call supplies none", async () => {
    const { node, loads } = createCounter("defaults.applied");
    const request = deferred<number>();
    const mutation = defineMutation({
      key: "defaults.applied.save",
      execute: async () => request.promise,
      optimistic: (effects, input: number) => {
        effects.update(node, (current) => current + input);
      },
      onSuccess: (effects) => {
        effects.invalidate([node]);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const loadsBefore = loads();

    const pending = runtime.mutate(mutation, 5);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getState(node).data).toBe(15);

    request.resolve(1);
    await pending;
    expect(runtime.getState(node).freshness).toBe("stale");
    await runtime.execute([node]);
    expect(loads()).toBe(loadsBefore + 1);
  });

  it("lets a call-site optimistic replace the default, so only one runs", async () => {
    const { node } = createCounter("defaults.override.optimistic");
    const request = deferred<number>();
    const defaultOptimistic = vi.fn();
    const mutation = defineMutation({
      key: "defaults.override.optimistic.save",
      execute: async () => request.promise,
      optimistic: defaultOptimistic,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    const pending = runtime.mutate(mutation, undefined, {
      optimistic: (effects) => {
        effects.update(node, (current) => current + 100);
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(defaultOptimistic).not.toHaveBeenCalled();
    expect(runtime.getState(node).data).toBe(110);

    request.resolve(1);
    await pending;
  });

  it("lets a call-site onSuccess replace the default, so only one runs", async () => {
    const { node } = createCounter("defaults.override.success");
    const defaultOnSuccess = vi.fn();
    const callOnSuccess = vi.fn();
    const mutation = defineMutation({
      key: "defaults.override.success.save",
      execute: async () => 1,
      onSuccess: defaultOnSuccess,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    await runtime.mutate(mutation, undefined, { onSuccess: callOnSuccess });

    expect(defaultOnSuccess).not.toHaveBeenCalled();
    expect(callOnSuccess).toHaveBeenCalledTimes(1);
  });

  it("merges per field: a call that overrides one field keeps the other defaults", async () => {
    const { node } = createCounter("defaults.merge");
    const defaultOnSuccess = vi.fn();
    const mutation = defineMutation({
      key: "defaults.merge.save",
      execute: async () => 1,
      onSuccess: defaultOnSuccess,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const callOptimistic = vi.fn();

    await runtime.mutate(mutation, undefined, { optimistic: callOptimistic });

    expect(callOptimistic).toHaveBeenCalledTimes(1);
    expect(defaultOnSuccess).toHaveBeenCalledTimes(1);
  });

  it("treats an undefined call-site field as not supplied", async () => {
    const { node } = createCounter("defaults.undefined");
    const defaultOnSuccess = vi.fn();
    const mutation = defineMutation({
      key: "defaults.undefined.save",
      execute: async () => 1,
      onSuccess: defaultOnSuccess,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    await runtime.mutate(mutation, undefined, { onSuccess: undefined });

    expect(defaultOnSuccess).toHaveBeenCalledTimes(1);
  });

  it("opts out of a default with a no-op call-site replacement", async () => {
    const { node } = createCounter("defaults.optout");
    const defaultOptimistic = vi.fn();
    const mutation = defineMutation({
      key: "defaults.optout.save",
      execute: async () => 1,
      optimistic: defaultOptimistic,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    await runtime.mutate(mutation, undefined, { optimistic: () => {} });

    expect(defaultOptimistic).not.toHaveBeenCalled();
  });

  it("uses a default classifyFailure to roll back a known rejection", async () => {
    const { node } = createCounter("defaults.classify");
    const failure = new Error("rejected by server");
    const mutation = defineMutation({
      key: "defaults.classify.save",
      execute: async (): Promise<number> => {
        throw failure;
      },
      optimistic: (effects) => {
        effects.update(node, (current) => current + 1);
      },
      classifyFailure: () => "rejected",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    await expect(runtime.mutate(mutation, undefined)).rejects.toBe(failure);
    expect(runtime.getState(node).data).toBe(10);
  });

  it("treats a failure as unknown when no classifyFailure is supplied anywhere", async () => {
    const { node } = createCounter("defaults.classify.none");
    const mutation = defineMutation({
      key: "defaults.classify.none.save",
      execute: async (): Promise<number> => {
        throw new Error("dropped connection");
      },
      optimistic: (effects) => {
        effects.update(node, (current) => current + 1);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);

    await expect(runtime.mutate(mutation, undefined)).rejects.toBeInstanceOf(
      GraphMutationOutcomeUnknownError,
    );
  });
});
