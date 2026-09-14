import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("transaction commit invalidation", () => {
  it("requests one scheduler pass for a multi-context commit", async () => {
    const first = defineContextNode({ key: "scheduled-first", initialValue: 1 });
    const second = defineContextNode({ key: "scheduled-second", initialValue: 2 });
    const load = vi.fn(async ({ get }) => get(first) + get(second));
    const data = defineDataNode({
      key: "scheduled-data",
      dependencies: [first, second] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [data, first, second] })
    );
    runtime.subscribeNodes([data]);
    await runtime.whenSettled();
    load.mockClear();

    await runtime.transaction(() => {
      runtime.setContext(first, 10);
      runtime.setContext(second, 20);
    });
    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getState(data).data).toBe(30);
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("invalidates a shared descendant once when multiple contexts commit", async () => {
    const first = defineContextNode({ key: "first-context", initialValue: 1 });
    const second = defineContextNode({ key: "second-context", initialValue: 2 });
    const shared = defineDerivedNode({
      key: "shared-descendant",
      dependencies: [first, second] as const,
      derive: ({ get }) => get(first) + get(second),
    });
    const observed = vi.fn();
    const runtime = createGraphRuntime(
      createGraph({ nodes: [shared, first, second] })
    );
    runtime.onChange(observed);

    await runtime.transaction(() => {
      runtime.setContext(first, 10);
      runtime.setContext(second, 20);
    });

    expect(runtime.getState(first).generation).toBe(1);
    expect(runtime.getState(second).generation).toBe(1);
    expect(runtime.getState(shared).generation).toBe(1);
    expect(runtime.getState(shared).freshness).toBe("stale");
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it("invalidates each node once across diamond descendant paths", async () => {
    const context = defineContextNode({ key: "diamond-context", initialValue: 1 });
    const left = defineDerivedNode({
      key: "diamond-left",
      dependencies: [context] as const,
      derive: ({ get }) => get(context),
    });
    const right = defineDerivedNode({
      key: "diamond-right",
      dependencies: [context] as const,
      derive: ({ get }) => get(context),
    });
    const bottom = defineDerivedNode({
      key: "diamond-bottom",
      dependencies: [left, right] as const,
      derive: ({ get }) => get(left) + get(right),
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [bottom, left, right, context] })
    );

    await runtime.transaction(() => {
      runtime.setContext(context, 2);
    });

    expect(runtime.getState(left).generation).toBe(1);
    expect(runtime.getState(right).generation).toBe(1);
    expect(runtime.getState(bottom).generation).toBe(1);
  });

  it("aborts affected active work at commit rather than while staging", async () => {
    const context = defineContextNode({ key: "abort-context", initialValue: 1 });
    const attempt = deferred<number>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "abort-data",
      dependencies: [context] as const,
      initialValue: 0,
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, context] }));
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "initial attempt to start");

    await runtime.transaction(async () => {
      runtime.setContext(context, 2);
      expect(signals[0]?.aborted).toBe(false);
      expect(runtime.getState(data).generation).toBe(0);
      await Promise.resolve();
      expect(signals[0]?.aborted).toBe(false);
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(runtime.getState(data).generation).toBe(1);
    attempt.resolve(1);
    await execution;
  });

  it("does not abort active work unaffected by committed contexts", async () => {
    const changed = defineContextNode({ key: "changed-context", initialValue: 1 });
    const unrelated = defineContextNode({ key: "unrelated-context", initialValue: 1 });
    const attempt = deferred<number>();
    const signals: AbortSignal[] = [];
    const data = defineDataNode({
      key: "unaffected-data",
      dependencies: [unrelated] as const,
      initialValue: 0,
      load: ({ signal }) => {
        signals.push(signal);
        return attempt.promise;
      },
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [data, changed, unrelated] })
    );
    const execution = runtime.execute([data]);
    await waitForCondition(() => signals.length === 1, "unaffected attempt to start");

    await runtime.transaction(() => {
      runtime.setContext(changed, 2);
    });

    expect(signals[0]?.aborted).toBe(false);
    expect(runtime.getState(data).generation).toBe(0);
    attempt.resolve(1);
    await execution;
  });
});
