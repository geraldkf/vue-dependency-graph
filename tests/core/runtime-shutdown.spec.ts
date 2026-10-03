import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineMutation,
  GraphRuntimeShutdownError,
  type GraphTransaction,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("terminal runtime shutdown", () => {
  it("does not commit an optimistic updater that ends the owner lifetime", async () => {
    const node = defineDataNode({ key: "node", initialValue: 0, load: async () => 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const execute = vi.fn(async () => 2);
    await expect(
      runtime.mutate(defineMutation({ key: "save", execute }), undefined, {
        optimistic: (e) =>
          e.update(node, () => {
            runtime.shutdown();
            return 2;
          }),
      }),
    ).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    expect(runtime.getState(node).data).toBe(1);
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not start a loader when an attempt-start listener shuts down", async () => {
    const load = vi.fn(() => new Promise<number>(() => undefined));
    const node = defineDataNode({ key: "node", initialValue: 0, load });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    runtime.onChange(() => {
      if (runtime.getState(node).status === "loading") runtime.shutdown();
    });
    await expect(runtime.execute([node])).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    expect(load).not.toHaveBeenCalled();
  });

  it("does not roll back after a failure classifier ends the owner lifetime", async () => {
    const node = defineDataNode({ key: "node", initialValue: 0, load: async () => 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const mutation = defineMutation({
      key: "save",
      execute: async () => {
        throw new Error("rejected");
      },
    });
    await expect(
      runtime.mutate(mutation, undefined, {
        optimistic: (e) => e.update(node, () => 2),
        classifyFailure: () => {
          runtime.shutdown();
          return "rejected";
        },
      }),
    ).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    expect(runtime.getState(node).data).toBe(2);
  });

  it("does not commit success effects when their callback shuts down", async () => {
    const node = defineDataNode({ key: "node", initialValue: 0, load: async () => 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    await expect(
      runtime.mutate(defineMutation({ key: "save", execute: async () => 2 }), undefined, {
        onSuccess: (e, result) => {
          e.update(node, () => result);
          runtime.shutdown();
        },
      }),
    ).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    expect(runtime.getState(node).data).toBe(1);
  });
  it("cancels queued scheduler work and rejects later writes while allowing inspection", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async () => 2);
    const node = defineDataNode({ key: "node", initialValue: 0, load });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, node] }));
    const subscription = runtime.subscribeNodes([node]);
    const listener = vi.fn();
    const stop = runtime.onChange(listener);
    runtime.shutdown();
    runtime.shutdown();
    await runtime.whenSettled();
    expect(load).not.toHaveBeenCalled();
    expect(() => runtime.setContext(context, 2)).toThrow(GraphRuntimeShutdownError);
    expect(() => runtime.execute([node])).toThrow(GraphRuntimeShutdownError);
    expect(() => runtime.subscribeNodes([node])).toThrow(GraphRuntimeShutdownError);
    expect(() => runtime.onChange(listener)).toThrow(GraphRuntimeShutdownError);
    expect(() => runtime.transaction(() => undefined)).toThrow(GraphRuntimeShutdownError);
    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getSubscriptionState(node).total).toBe(0);
    expect(runtime.createDiagnosticSnapshot().nodes).toHaveLength(2);
    subscription.unsubscribe();
    subscription.unsubscribe();
    stop();
    expect(listener).not.toHaveBeenCalled();
  });

  it("settles ignored-abort active and queued loads without allowing late commits", async () => {
    const pending = deferred<number>();
    let signal: AbortSignal | undefined;
    const first = defineDataNode({
      key: "first",
      initialValue: 0,
      load: ({ signal: s }) => {
        signal = s;
        return pending.promise;
      },
    });
    const queuedLoad = vi.fn(async () => 9);
    const second = defineDataNode({ key: "second", initialValue: 0, load: queuedLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [first, second] }), {
      maxConcurrentLoads: 1,
    });
    const executing = runtime.execute([first, second]);
    const rejected = expect(executing).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    await waitForCondition(() => !!signal, "first load started");
    runtime.shutdown();
    await rejected;
    await runtime.whenSettled();
    expect(signal!.aborted).toBe(true);
    expect(queuedLoad).not.toHaveBeenCalled();
    pending.resolve(42);
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getState(first).data).toBe(0);
  });

  it("ends non-cooperative mutations without applying success or rollback", async () => {
    const node = defineDataNode({ key: "value", initialValue: 0, load: async () => 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const remote = deferred<number>();
    let signal: AbortSignal | undefined;
    const mutation = defineMutation({
      key: "save",
      execute: ({ signal: s }) => {
        signal = s;
        return remote.promise;
      },
    });
    const success = vi.fn();
    const saving = runtime.mutate(mutation, undefined, {
      optimistic: (e) => e.update(node, () => 2),
      onSuccess: success,
      classifyFailure: () => "rejected",
    });
    const rejected = expect(saving).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    await waitForCondition(() => !!signal, "mutation started");
    runtime.shutdown();
    await rejected;
    expect(signal!.aborted).toBe(true);
    expect(runtime.getState(node).data).toBe(2);
    remote.resolve(99);
    await Promise.resolve();
    expect(success).not.toHaveBeenCalled();
  });

  it("discards staged work and settles a transaction whose callback never finishes", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const pending = deferred<void>();
    let handle: GraphTransaction | undefined;
    const work = runtime.transaction(async (tx) => {
      handle = tx;
      tx.setContext(context, 2);
      await pending.promise;
    });
    const rejected = expect(work).rejects.toBeInstanceOf(GraphRuntimeShutdownError);
    runtime.shutdown();
    await rejected;
    expect(runtime.getState(context).data).toBe(1);
    expect(() => handle!.setContext(context, 3)).toThrow(GraphRuntimeShutdownError);
    pending.resolve();
    await Promise.resolve();
    expect(runtime.getState(context).data).toBe(1);
  });
});
