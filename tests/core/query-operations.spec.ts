import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineQuery,
} from "../../src/core";

describe("query operations", () => {
  it("prefetches every query node through the existing execution engine", async () => {
    const context = defineContextNode({
      key: "query-prefetch-context",
      initialValue: 2,
    });
    const firstLoad = vi.fn(async () => 10);
    const secondLoad = vi.fn(async () => 20);
    const first = defineDataNode({
      key: "query-prefetch-first",
      dependencies: [context] as const,
      initialValue: 0,
      load: firstLoad,
    });
    const second = defineDataNode({
      key: "query-prefetch-second",
      dependencies: [context] as const,
      initialValue: 0,
      load: secondLoad,
    });
    const summary = defineDerivedNode({
      key: "query-prefetch-summary",
      dependencies: [first, second] as const,
      derive: ({ get }) => get(first) + get(second),
    });
    const query = defineQuery({
      key: "query-prefetch",
      nodes: { context, first, summary },
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [context, first, second, summary] })
    );

    await runtime.prefetchQuery(query);

    expect(firstLoad).toHaveBeenCalledOnce();
    expect(secondLoad).toHaveBeenCalledOnce();
    expect(runtime.getState(summary).data).toBe(30);
    expect(runtime.getSubscriptionState(first).total).toBe(0);
  });

  it("refreshes data and derived query members while ignoring context aliases", async () => {
    const context = defineContextNode({
      key: "query-refresh-context",
      initialValue: 3,
    });
    let request = 0;
    const load = vi.fn(async () => ++request);
    const data = defineDataNode({
      key: "query-refresh-data",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const derived = defineDerivedNode({
      key: "query-refresh-derived",
      dependencies: [data] as const,
      derive: ({ get }) => get(data) * 10,
    });
    const query = defineQuery({
      key: "query-refresh",
      nodes: { context, data, derived },
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [context, data, derived] })
    );

    await runtime.prefetchQuery(query);
    const contextGeneration = runtime.getState(context).generation;
    await runtime.refreshQuery(query);

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data).data).toBe(2);
    expect(runtime.getState(derived).data).toBe(20);
    expect(runtime.getState(context).generation).toBe(contextGeneration);
  });

  it("deduplicates the same node referenced by multiple aliases", async () => {
    const load = vi.fn(async () => "loaded");
    const data = defineDataNode({
      key: "query-duplicate-data",
      initialValue: "",
      load,
    });
    const query = defineQuery({
      key: "query-duplicate-aliases",
      nodes: { primary: data, secondary: data },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data] }));

    await runtime.prefetchQuery(query);
    await runtime.refreshQuery(query);

    expect(load).toHaveBeenCalledTimes(2);
    expect(runtime.getState(data).generation).toBe(1);
  });

  it("treats an empty query as a no-op", async () => {
    const query = defineQuery({ key: "empty-query", nodes: {} });
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));

    await expect(runtime.prefetchQuery(query)).resolves.toBeUndefined();
    await expect(runtime.refreshQuery(query)).resolves.toBeUndefined();
  });

  it("preserves validation before query operation work starts", async () => {
    const registeredLoad = vi.fn(async () => "registered");
    const missingLoad = vi.fn(async () => "missing");
    const registered = defineDataNode({
      key: "query-validation-registered",
      initialValue: "",
      load: registeredLoad,
    });
    const missing = defineDataNode({
      key: "query-validation-missing",
      initialValue: "",
      load: missingLoad,
    });
    const query = defineQuery({
      key: "query-validation",
      nodes: { registered, missing },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [registered] }));

    await expect(runtime.prefetchQuery(query)).rejects.toThrow(missing.key);
    expect(registeredLoad).not.toHaveBeenCalled();
    expect(missingLoad).not.toHaveBeenCalled();
  });
});
