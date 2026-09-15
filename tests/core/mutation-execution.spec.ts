import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineMutation,
  type MutationExecuteContext,
} from "../../src/core";

interface SaveInput {
  readonly value: string;
}

interface SaveResult {
  readonly id: number;
  readonly value: string;
}

const context = defineContextNode({
  key: "mutation-execution-context",
  initialValue: 1,
});

const graph = createGraph({ nodes: [context] });

const createSaveMutation = (
  execute: (context: MutationExecuteContext<SaveInput>) => Promise<SaveResult>,
) => defineMutation({ key: "value.save", execute });

describe("mutation execution", () => {
  it("executes once with the typed input and returns the remote result", async () => {
    const execute = vi.fn(
      async ({ input, signal }: MutationExecuteContext<SaveInput>) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
        return { id: 42, value: input.value };
      },
    );
    const mutation = createSaveMutation(execute);
    const runtime = createGraphRuntime(graph);

    await expect(runtime.mutate(mutation, { value: "saved" })).resolves.toEqual({
      id: 42,
      value: "saved",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns a rejected promise when execute throws synchronously", async () => {
    const failure = new Error("Synchronous failure");
    const execute = (() => {
      throw failure;
    }) as unknown as (
      context: MutationExecuteContext<SaveInput>,
    ) => Promise<SaveResult>;
    const mutation = createSaveMutation(execute);
    const runtime = createGraphRuntime(graph);

    await expect(runtime.mutate(mutation, { value: "failed" })).rejects.toBe(
      failure,
    );
  });

  it("preserves the original remote rejection", async () => {
    const failure = new Error("Save rejected");
    const mutation = createSaveMutation(async () => {
      throw failure;
    });
    const runtime = createGraphRuntime(graph);

    await expect(runtime.mutate(mutation, { value: "rejected" })).rejects.toBe(
      failure,
    );
  });

  it("does not change graph state or notify observers", async () => {
    const mutation = createSaveMutation(async ({ input }) => ({
      id: 7,
      value: input.value,
    }));
    const runtime = createGraphRuntime(graph);
    const before = runtime.getState(context);
    const listener = vi.fn();
    runtime.onChange(listener);

    await runtime.mutate(mutation, { value: "unchanged" });

    expect(runtime.getState(context)).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("creates independent attempts for separate runtime calls", async () => {
    const signals: AbortSignal[] = [];
    const mutation = createSaveMutation(async ({ input, signal }) => {
      signals.push(signal);
      return { id: signals.length, value: input.value };
    });
    const firstRuntime = createGraphRuntime(graph);
    const secondRuntime = createGraphRuntime(graph);

    await Promise.all([
      firstRuntime.mutate(mutation, { value: "first" }),
      secondRuntime.mutate(mutation, { value: "second" }),
    ]);

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("remains independent while a graph transaction is open", async () => {
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const mutation = createSaveMutation(async ({ input }) => ({
      id: 9,
      value: input.value,
    }));
    const runtime = createGraphRuntime(graph);

    const transaction = runtime.transaction(async () => {
      await transactionGate;
    });

    await expect(runtime.mutate(mutation, { value: "independent" })).resolves.toEqual({
      id: 9,
      value: "independent",
    });

    releaseTransaction();
    await transaction;
  });
});
