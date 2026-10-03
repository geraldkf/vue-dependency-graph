import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

/**
 * A load can settle successfully and *then* be superseded before the runtime
 * gets to apply its result: the loader's promise resolves, and in the few
 * microtasks before the attempt resumes, a context change aborts it. The
 * abort signal has already lost the race inside the loader wrapper at that
 * point, so the only thing standing between a stale value and the node's
 * state is the staleness check made just before the result is applied.
 */
describe("attempt superseded between its load settling and its result being applied", () => {
  it("never applies or publishes the stale result", async () => {
    const Selected = defineContextNode({ key: "selected", initialValue: "a" });
    const loads = new Map<string, ReturnType<typeof deferred<string>>>();
    const Detail = defineDataNode({
      key: "detail",
      dependencies: [Selected],
      initialValue: "",
      load: ({ get }) => {
        const pending = deferred<string>();
        loads.set(get(Selected), pending);
        return pending.promise;
      },
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Selected, Detail] }), {
      diagnostics: { sink: diagnostics },
    });
    const subscription = runtime.subscribeNodes([Detail]);

    await waitForCondition(() => loads.has("a"), "first load started");

    // Settle the loader, then supersede the attempt from a microtask that runs
    // after the loader wrapper has resolved but before the attempt resumes.
    loads.get("a")!.resolve("stale-from-a");
    queueMicrotask(() => runtime.setContext(Selected, "b"));

    await waitForCondition(() => loads.has("b"), "second load started");
    loads.get("b")!.resolve("fresh-from-b");
    await runtime.whenSettled();

    // Diagnostics, not `onChange`, are the observation point: change
    // notifications are coalesced, so a stale intermediate value could be
    // overwritten before a listener ever read it.
    const loadEvents = diagnostics
      .getEvents()
      .filter((event) => event.type.startsWith("node.load."))
      .map((event) => `${event.type}@${(event as { generation?: number }).generation}`);
    expect(loadEvents).toEqual([
      "node.load.started@0",
      "node.load.discarded@0",
      "node.load.started@1",
      "node.load.succeeded@1",
    ]);
    expect(runtime.getState(Detail).data).toBe("fresh-from-b");
    subscription.unsubscribe();
  });
  it("discards, rather than reports as a failure, a load that failed just before being superseded", async () => {
    const Selected = defineContextNode({ key: "selected-failing", initialValue: "a" });
    const loads = new Map<string, ReturnType<typeof deferred<string>>>();
    const Detail = defineDataNode({
      key: "detail-failing",
      dependencies: [Selected],
      initialValue: "",
      load: ({ get }) => {
        const pending = deferred<string>();
        loads.set(get(Selected), pending);
        return pending.promise;
      },
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Selected, Detail] }), {
      diagnostics: { sink: diagnostics },
    });
    const subscription = runtime.subscribeNodes([Detail]);

    await waitForCondition(() => loads.has("a"), "first load started");

    loads.get("a")!.reject(new Error("stale failure"));
    queueMicrotask(() => runtime.setContext(Selected, "b"));

    await waitForCondition(() => loads.has("b"), "second load started");
    loads.get("b")!.resolve("fresh-from-b");
    await runtime.whenSettled();

    const loadEvents = diagnostics
      .getEvents()
      .filter((event) => event.type.startsWith("node.load."))
      .map((event) => `${event.type}@${(event as { generation?: number }).generation}`);
    expect(loadEvents).toEqual([
      "node.load.started@0",
      "node.load.discarded@0",
      "node.load.started@1",
      "node.load.succeeded@1",
    ]);
    expect(runtime.getState(Detail)).toMatchObject({ data: "fresh-from-b", error: null });
    subscription.unsubscribe();
  });
});
