import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  staleAfter,
} from "../../../src/core";
import { computeNodeDetail } from "../../../src/devtools/protocol/node-inspector";

describe("computeNodeDetail", () => {
  it("provides safe defaults for an offline topology with no state or demand rows", () => {
    const parent = defineContextNode({ key: "parent", initialValue: 1 });
    const child = defineDataNode({
      key: "child",
      dependencies: [parent],
      initialValue: 0,
      load: async () => 2,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [parent, child] }));
    const snapshot = { ...runtime.createDiagnosticSnapshot(), nodes: [], subscriptions: [] };
    expect(computeNodeDetail(snapshot, "child")).toMatchObject({
      status: "idle",
      freshness: "stale",
      generation: 0,
      hasSuccessfulValue: false,
      value: { status: "omitted" },
      error: null,
      dependencies: [{ key: "parent", status: "idle" }],
      subscribers: { direct: 0, required: 0, total: 0 },
      refreshPolicy: null,
      attemptMetrics: null,
    });
    runtime.shutdown();
  });
  it("returns undefined for a key not present in the snapshot", () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));
    expect(computeNodeDetail(runtime.createDiagnosticSnapshot(), "missing")).toBeUndefined();
  });

  it("reports dependencies, descendants, invalidating events, subscribers, and refresh policy", () => {
    const Updated = defineEvent<void>("thing.updated");
    const UserId = defineContextNode<string>({ key: "userId", initialValue: "u1" });
    const Thing = defineDataNode({
      key: "thing",
      dependencies: [UserId] as const,
      initialValue: null,
      invalidatedBy: [Updated],
      refresh: staleAfter({ durationMs: 60_000 }),
      load: () => Promise.resolve({ ok: true }),
    });
    const ThingLabel = defineDerivedNode({
      key: "thingLabel",
      dependencies: [Thing] as const,
      derive: () => "label",
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [UserId, Thing, ThingLabel] }));
    const subscription = runtime.subscribeNodes([ThingLabel]);

    const detail = computeNodeDetail(runtime.createDiagnosticSnapshot(), "thing");

    expect(detail).toMatchObject({
      key: "thing",
      kind: "data",
      dependencies: [{ key: "userId" }],
      descendants: [{ key: "thingLabel" }],
      invalidatedByEvents: ["thing.updated"],
    });
    expect(detail?.subscribers.total).toBeGreaterThan(0);
    expect(detail?.refreshPolicy).toMatchObject({ kind: "stale-after" });

    subscription.unsubscribe();
  });

  it("computes mean and max duration from node attempt metrics after execution", async () => {
    const Count = defineDataNode({
      key: "count",
      initialValue: 0,
      load: () => Promise.resolve(42),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    await runtime.execute([Count]);

    const detail = computeNodeDetail(runtime.createDiagnosticSnapshot(), "count");

    expect(detail?.attemptMetrics).toMatchObject({ started: 1, succeeded: 1 });
    expect(detail?.attemptMetrics?.meanDurationMs).not.toBeNull();
    expect(detail?.attemptMetrics?.maxDurationMs).not.toBeNull();
  });

  it("reports null refresh policy and attempt metrics when neither is present", () => {
    const Plain = defineContextNode<number>({ key: "plain", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Plain] }));

    const detail = computeNodeDetail(runtime.createDiagnosticSnapshot(), "plain");

    expect(detail?.refreshPolicy).toBeNull();
    expect(detail?.attemptMetrics).toBeNull();
  });
});
