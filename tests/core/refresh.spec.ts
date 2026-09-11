import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

describe("manual refresh", () => {
  it("reloads fresh data and preserves its value while refreshing", async () => {
    const refreshed = deferred<string>();
    let call = 0;
    const load = vi.fn(() => {
      call += 1;
      return call === 1 ? Promise.resolve("first") : refreshed.promise;
    });
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));
    await runtime.prefetch([data]);

    const refresh = runtime.refresh([data]);
    await waitForCondition(() => runtime.getState(data).status === "refreshing", "refresh state");
    expect(runtime.getState(data).data).toBe("first");

    refreshed.resolve("second");
    await refresh;
    expect(runtime.getState(data).data).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("recomputes a derived node without reloading its fresh ancestor", async () => {
    const load = vi.fn(async () => 2);
    let multiplier = 2;
    const data = defineDataNode({ key: "data", initialValue: 0, load });
    const derived = defineDerivedNode({ key: "derived", dependencies: [data] as const, derive: ({ get }) => get(data) * multiplier });
    const runtime = createGraphRuntime(createGraph({ nodes: [derived, data] }));
    await runtime.prefetch([derived]);

    multiplier = 3;
    await runtime.refresh([derived]);

    expect(runtime.getState(derived).data).toBe(6);
    expect(load).toHaveBeenCalledOnce();
  });

  it("deduplicates targets and supports empty input", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({ key: "data", initialValue: "", load });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.refresh([]);
    await runtime.refresh([data, data]);
    expect(load).toHaveBeenCalledOnce();
  });
});
