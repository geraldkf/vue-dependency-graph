import { describe, expect, it, vi } from "vitest";
import { createGraph, createGraphRuntime, defineDataNode } from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("refresh interactions and races", () => {
  it("supersedes active normal work and prevents its old result from committing", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    let call = 0;
    const load = vi.fn(({ signal }) => {
      signals.push(signal);
      call += 1;
      return call === 1 ? first.promise : second.promise;
    });
    const data = defineDataNode({ key: "data", initialValue: "initial", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const normal = runtime.execute([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "normal attempt");
    const refresh = runtime.refresh([data]);
    await waitForCondition(() => load.mock.calls.length === 2, "refresh attempt");
    expect(signals[0]?.aborted).toBe(true);

    second.resolve("new");
    first.resolve("old");
    await Promise.all([normal, refresh]);
    expect(runtime.getState(data).data).toBe("new");
  });

  it("shares overlapping refresh calls and runs a later refresh again", async () => {
    const first = deferred<string>();
    const load = vi.fn(() => first.promise);
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    const one = runtime.refresh([data]);
    const two = runtime.refresh([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "shared refresh");
    first.resolve("first");
    await Promise.all([one, two]);

    load.mockImplementationOnce(async () => "second");
    await runtime.refresh([data]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data).data).toBe("second");
  });

  it("does not let final unsubscribe cancel caller-owned refresh", async () => {
    const initial = deferred<string>();
    const load = vi.fn(() => initial.promise);
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    const subscription = runtime.subscribeNodes([data]);
    const refresh = runtime.refresh([data]);
    await waitForCondition(() => load.mock.calls.length === 1, "refresh loader");

    subscription.unsubscribe();
    initial.resolve("loaded");
    await refresh;
    await runtime.whenSettled();
    expect(runtime.getState(data).data).toBe("loaded");
  });
  it("shares overlapping refreshes regardless of target order and duplicates", async () => {
    const leftResult = deferred<string>();
    const rightResult = deferred<string>();
    const leftLoad = vi.fn(() => leftResult.promise);
    const rightLoad = vi.fn(() => rightResult.promise);
    const left = defineDataNode({ key: "left", initialValue: "", load: leftLoad });
    const right = defineDataNode({ key: "right", initialValue: "", load: rightLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [left, right] }));

    const first = runtime.refresh([left, right]);
    const second = runtime.refresh([right, left, right]);
    await waitForCondition(
      () => leftLoad.mock.calls.length === 1 && rightLoad.mock.calls.length === 1,
      "order-independent shared refresh",
    );

    leftResult.resolve("left");
    rightResult.resolve("right");
    await Promise.all([first, second]);

    expect(leftLoad).toHaveBeenCalledOnce();
    expect(rightLoad).toHaveBeenCalledOnce();
  });

  it("keeps distinct refresh target sets independent", async () => {
    const leftResult = deferred<string>();
    const rightResult = deferred<string>();
    const leftLoad = vi.fn(() => leftResult.promise);
    const rightLoad = vi.fn(() => rightResult.promise);
    const left = defineDataNode({ key: "left", initialValue: "", load: leftLoad });
    const right = defineDataNode({ key: "right", initialValue: "", load: rightLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [left, right] }));

    const leftRefresh = runtime.refresh([left]);
    const rightRefresh = runtime.refresh([right]);
    await waitForCondition(
      () => leftLoad.mock.calls.length === 1 && rightLoad.mock.calls.length === 1,
      "independent refresh operations",
    );

    leftResult.resolve("left");
    rightResult.resolve("right");
    await Promise.all([leftRefresh, rightRefresh]);

    expect(runtime.getState(left).data).toBe("left");
    expect(runtime.getState(right).data).toBe("right");
  });
});
