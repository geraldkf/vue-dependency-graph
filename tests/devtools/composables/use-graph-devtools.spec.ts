import { describe, expect, it } from "vitest";
import { defineComponent, nextTick } from "vue";
import { render } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineDataNode,
  type GraphRuntime,
  type InMemoryGraphDiagnostics,
} from "../../../src/core";
import {
  useGraphDevtools,
  type UseGraphDevtoolsResult,
} from "../../../src/devtools/composables/use-graph-devtools";

const mountProbe = (
  runtime: GraphRuntime,
  diagnostics: InMemoryGraphDiagnostics
): { captured: UseGraphDevtoolsResult; unmount: () => void } => {
  let captured!: UseGraphDevtoolsResult;
  const Probe = defineComponent({
    setup() {
      captured = useGraphDevtools({ runtime, diagnostics });
      return () => null;
    },
  });
  const { unmount } = render(Probe);
  return { captured, unmount };
};

describe("useGraphDevtools", () => {
  it("throws when called outside an active effect scope", () => {
    const runtime = createGraphRuntime(createGraph({ nodes: [] }));
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 50 });
    expect(() => useGraphDevtools({ runtime, diagnostics })).toThrow(
      /must be called inside setup\(\)/
    );
  });

  it("reflects graph state and updates reactively after execution", async () => {
    const Count = defineDataNode({
      key: "gd-count",
      initialValue: 0,
      load: () => Promise.resolve(7),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    const { captured, unmount } = mountProbe(runtime, diagnostics);

    expect(captured.graphView.value.nodes).toHaveLength(1);
    expect(captured.graphView.value.nodes[0]).toMatchObject({ status: "idle" });

    await runtime.execute([Count]);
    await nextTick(); // let the microtask-coalesced revision bump land

    expect(captured.graphView.value.nodes[0]).toMatchObject({
      status: "success",
      freshness: "fresh",
    });
    expect(captured.timeline.value.length).toBeGreaterThan(0);
    expect(captured.metricsView.value.groups.length).toBeGreaterThan(0);

    unmount();
  });

  it("select() drives selectedNodeDetail", async () => {
    const Count = defineDataNode({
      key: "gd-select",
      initialValue: 0,
      load: () => Promise.resolve(1),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    const { captured } = mountProbe(runtime, diagnostics);

    expect(captured.selectedNodeDetail.value).toBeUndefined();
    captured.select("gd-select");
    expect(captured.selectedNodeDetail.value).toMatchObject({ key: "gd-select" });
    captured.select(undefined);
    expect(captured.selectedNodeDetail.value).toBeUndefined();
  });

  it("exportSnapshot produces a self-describing, round-trippable JSON export", async () => {
    const Count = defineDataNode({
      key: "gd-export",
      initialValue: 0,
      load: () => Promise.resolve(3),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    const { captured } = mountProbe(runtime, diagnostics);
    await runtime.execute([Count]);

    const parsed = JSON.parse(captured.exportSnapshot());
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("number");
    expect(parsed.snapshot.topology).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "gd-export" })])
    );
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it("stops watching the runtime once the effect scope is disposed", async () => {
    const Count = defineDataNode({
      key: "gd-dispose",
      initialValue: 0,
      load: () => Promise.resolve(9),
    });
    const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
    const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
      diagnostics: { sink: diagnostics },
    });
    const { captured, unmount } = mountProbe(runtime, diagnostics);
    const stateBeforeDispose = captured.graphView.value.nodes[0];
    expect(stateBeforeDispose).toMatchObject({ status: "idle" });

    unmount();
    await runtime.execute([Count]);
    await nextTick();

    // With the listener disposed, the composable's computed refs are
    // frozen at whatever they last saw - they must NOT pick up the
    // execution that happened after unmount, proving onScopeDispose
    // actually released the onChange subscription rather than leaking it.
    expect(captured.graphView.value.nodes[0]).toMatchObject({ status: "idle" });
  });
});
