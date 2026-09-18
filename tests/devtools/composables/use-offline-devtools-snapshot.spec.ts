import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineDataNode,
} from "../../../src/core";
import { useGraphDevtools } from "../../../src/devtools/composables/use-graph-devtools";
import {
  useOfflineDevtoolsSnapshot,
  InvalidDevtoolsExportError,
} from "../../../src/devtools/composables/use-offline-devtools-snapshot";
import { defineComponent } from "vue";
import { render } from "@testing-library/vue";

/** Produces a real export via the live composable, exactly as a person
 * exporting a snapshot from the live panel would - rather than
 * hand-crafting a fixture that could drift from the real export shape. */
const realExport = async (): Promise<string> => {
  const Count = defineDataNode({
    key: "offline-count",
    initialValue: 0,
    load: () => Promise.resolve(5),
  });
  const diagnostics = createInMemoryGraphDiagnostics({ capacity: 200 });
  const runtime = createGraphRuntime(createGraph({ nodes: [Count] }), {
    diagnostics: { sink: diagnostics },
  });

  let live!: ReturnType<typeof useGraphDevtools>;
  const Probe = defineComponent({
    setup() {
      live = useGraphDevtools({ runtime, diagnostics });
      return () => null;
    },
  });
  const { unmount } = render(Probe);
  await runtime.execute([Count]);
  await new Promise(resolve => queueMicrotask(() => resolve(undefined)));

  const exported = live.exportSnapshot();
  unmount();
  return exported;
};

describe("useOfflineDevtoolsSnapshot", () => {
  it("starts empty", () => {
    const offline = useOfflineDevtoolsSnapshot();
    expect(offline.loaded.value).toBeUndefined();
    expect(offline.graphView.value).toEqual({
      nodes: [],
      events: [],
      edges: [],
      columnCount: 0,
      maxRowCount: 0,
    });
  });

  it("loads a real export and drives the same view models the live composable produces", async () => {
    const json = await realExport();
    const offline = useOfflineDevtoolsSnapshot();

    offline.loadFromJson(json);

    expect(offline.loaded.value).toBeDefined();
    expect(offline.graphView.value.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "offline-count" })])
    );
    offline.select("offline-count");
    expect(offline.selectedNodeDetail.value).toMatchObject({ key: "offline-count" });
  });

  it("rejects invalid JSON with a clear error", () => {
    const offline = useOfflineDevtoolsSnapshot();
    expect(() => offline.loadFromJson("not json")).toThrow(InvalidDevtoolsExportError);
  });

  it("rejects well-formed JSON that isn't a devtools export", () => {
    const offline = useOfflineDevtoolsSnapshot();
    expect(() => offline.loadFromJson(JSON.stringify({ hello: "world" }))).toThrow(
      InvalidDevtoolsExportError
    );
  });

  it("rejects an unsupported schema version", () => {
    const offline = useOfflineDevtoolsSnapshot();
    expect(() =>
      offline.loadFromJson(
        JSON.stringify({ schemaVersion: 99, snapshot: {}, events: [] })
      )
    ).toThrow(/unsupported schemaVersion/);
  });

  it("clear() resets to empty and drops the selection", async () => {
    const json = await realExport();
    const offline = useOfflineDevtoolsSnapshot();
    offline.loadFromJson(json);
    offline.select("offline-count");

    offline.clear();

    expect(offline.loaded.value).toBeUndefined();
    expect(offline.selectedNodeKey.value).toBeUndefined();
  });
});
