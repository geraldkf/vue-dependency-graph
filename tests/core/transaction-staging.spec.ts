import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  type DataNodeDefinition,
  type GraphRuntime,
} from "../../src/core";
import { waitForCondition } from "./test-helpers";

describe("transaction staging and operation boundaries", () => {
  it("without a transaction, an async-spanning update causes two loads", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    runtime.setContext(context, 2);
    await runtime.whenSettled();
    runtime.setContext(context, 3);
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("coalesces an async-spanning update into a single load inside a transaction", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await Promise.resolve();
      await Promise.resolve();
      runtime.setContext(context, 3);
    });
    await runtime.whenSettled();

    expect(runtime.getState(data).data).toBe(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("collapses nested transactions into one commit", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => {
      observed.push(runtime.getState(context).data);
    });

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await runtime.transaction(() => {
        runtime.setContext(context, 3);
      });
      runtime.setContext(context, 4);
    });

    expect(observed).toEqual([4]);
  });

  it.each([
    ["execute", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.execute([data])],
    ["prefetch", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.prefetch([data])],
    ["refresh", (runtime: GraphRuntime, data: DataNodeDefinition<number, readonly []>) => runtime.refresh([data])],
  ] as const)(
    "rejects %s inside a transaction without starting or invalidating work",
    async (operation, invoke) => {
      const load = vi.fn(async () => 1);
      const data = defineDataNode({
        key: `data-${operation}`,
        dependencies: [] as const,
        initialValue: 0,
        load,
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
      const stateBefore = runtime.getState(data);

      await expect(
        runtime.transaction(() => invoke(runtime, data))
      ).rejects.toThrow(
        `runtime.${operation}(...) cannot be called inside runtime.transaction(...).`
      );

      expect(load).not.toHaveBeenCalled();
      expect(runtime.getState(data)).toEqual(stateBefore);
    }
  );

  it("keeps staged context values hidden until the outer transaction commits", async () => {
    const context = defineContextNode({ key: "staged-context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => observed.push(runtime.getState(context).data));

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      expect(runtime.getState(context).data).toBe(1);
      expect(runtime.getState(context).generation).toBe(0);
      expect(observed).toEqual([]);

      await Promise.resolve();

      runtime.setContext(context, 3);
      expect(runtime.getState(context).data).toBe(1);
      expect(observed).toEqual([]);
    });

    expect(runtime.getState(context).data).toBe(3);
    expect(runtime.getState(context).generation).toBe(1);
    expect(observed).toEqual([3]);
  });

  it("uses the final staged value across nested transactions", async () => {
    const context = defineContextNode({ key: "nested-context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      await runtime.transaction(() => {
        runtime.setContext(context, 3);
        expect(runtime.getState(context).data).toBe(1);
      });
      expect(runtime.getState(context).data).toBe(1);
      runtime.setContext(context, 4);
    });

    expect(runtime.getState(context).data).toBe(4);
    expect(runtime.getState(context).generation).toBe(1);
  });

  it("does not commit when the final staged value equals the committed value", async () => {
    const context = defineContextNode({ key: "reverted-context", initialValue: 1 });
    const observed = vi.fn();
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(observed);

    await runtime.transaction(() => {
      runtime.setContext(context, 2);
      runtime.setContext(context, 1);
    });

    expect(runtime.getState(context).data).toBe(1);
    expect(runtime.getState(context).generation).toBe(0);
    expect(observed).not.toHaveBeenCalled();
  });

  it("allows guarded operations again after a transaction completes", async () => {
    const load = vi.fn(async () => 1);
    const data = defineDataNode({
      key: "data-after-transaction",
      dependencies: [] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.transaction(async () => {
      await Promise.resolve();
    });
    await runtime.execute([data]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(data).data).toBe(1);
  });

  it("behaves as a plain passthrough outside a transaction (existing call sites unaffected)", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const observed: number[] = [];
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    runtime.onChange(() => {
      observed.push(runtime.getState(context).data);
    });

    runtime.setContext(context, 2);
    runtime.setContext(context, 3);

    expect(observed).toEqual([2, 3]);
  });
});
