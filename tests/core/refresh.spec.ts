import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  type RefreshableNodeDefinition,
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

  it("resolves equivalent refreshable handles through registered keys", async () => {
    const dataLoad = vi.fn(async () => 2);
    const registeredData = defineDataNode({ key: "data", initialValue: 0, load: dataLoad });
    const equivalentData = defineDataNode({ key: "data", initialValue: 99, load: dataLoad });
    const registeredDerived = defineDerivedNode({
      key: "derived",
      dependencies: [registeredData] as const,
      derive: ({ get }) => get(registeredData) + 1,
    });
    const equivalentDerived = defineDerivedNode({
      key: "derived",
      dependencies: [equivalentData] as const,
      derive: () => 99,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [registeredDerived, registeredData] })
    );

    await runtime.refresh([equivalentData, equivalentDerived]);

    expect(runtime.getState(registeredData).data).toBe(2);
    expect(runtime.getState(registeredDerived).data).toBe(3);
  });

  it("validates the full refresh list before changing generations", () => {
    const registered = defineDataNode({ key: "data", initialValue: "", load: async () => "loaded" });
    const missing = defineDataNode({ key: "missing", initialValue: "", load: async () => "missing" });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    expect(() => runtime.refresh([registered, missing])).toThrow("missing");
    expect(runtime.getState(registered).generation).toBe(0);
    expect(runtime.getState(registered).status).toBe("idle");
  });

  it("defensively rejects context-node refresh", async () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const refreshable = context as unknown as RefreshableNodeDefinition;

    await expect(runtime.refresh([refreshable])).rejects.toThrow("context");
    expect(runtime.getState(context).generation).toBe(0);
  });

});
