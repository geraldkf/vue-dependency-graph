import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { compareKeys } from "../../src/core/util/compare-keys";

const keys = ["b", "B", "a", "A", "_x", "1", "10", "2", "a.b", "a-b", "a:b", "ä", "z", "Z", ""];

describe("compareKeys", () => {
  it("orders by UTF-16 code unit, exactly like the default sort", () => {
    expect([...keys].sort(compareKeys)).toEqual([...keys].sort());
  });

  it("is a consistent comparator", () => {
    expect(compareKeys("a", "a")).toBe(0);
    expect(compareKeys("a", "b")).toBe(-1);
    expect(compareKeys("b", "a")).toBe(1);
    expect(compareKeys("B", "a")).toBe(-1); // uppercase before lowercase, unlike locale order
    expect(compareKeys("a", "ä")).toBe(-1);
  });

  it("does not depend on the host locale", () => {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => {
      throw new Error("ordering must not consult the locale");
    };
    try {
      expect([...keys].sort(compareKeys)).toEqual([...keys].sort());
    } finally {
      String.prototype.localeCompare = original;
    }
  });
});

describe("runtime-visible ordering uses code-unit order", () => {
  const siblingKeys = ["b", "B", "a", "_x", "1", "ä", "z", "A"];

  it("lists a node's children in code-unit order, whatever order they were declared in", () => {
    const root = defineContextNode({ key: "root", initialValue: 0 });
    const children = siblingKeys.map((key) =>
      defineDerivedNode({ key, dependencies: [root], derive: ({ get }) => get(root) }),
    );
    const forward = createGraph({ nodes: [root, ...children] });
    const backward = createGraph({ nodes: [root, ...[...children].reverse()] });

    const expected = [...siblingKeys].sort();
    expect(forward.getChildren(root).map((node) => node.key)).toEqual(expected);
    expect(backward.getChildren(root).map((node) => node.key)).toEqual(expected);
  });

  it("does not call localeCompare while building a graph", () => {
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => {
      throw new Error("graph construction must not consult the locale");
    };
    try {
      const root = defineContextNode({ key: "root", initialValue: 0 });
      const children = siblingKeys.map((key) =>
        defineDerivedNode({ key, dependencies: [root], derive: ({ get }) => get(root) }),
      );
      expect(() => createGraph({ nodes: [root, ...children] })).not.toThrow();
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  it("lists per-node metrics in code-unit order", async () => {
    const root = defineContextNode({ key: "root", initialValue: 0 });
    const nodes = ["b", "B", "a", "_x", "ä"].map((key) =>
      defineDataNode({
        key,
        dependencies: [root],
        initialValue: 0,
        load: async ({ get }) => get(root),
      }),
    );
    const collector = createInMemoryGraphDiagnostics({ capacity: 500 });
    const runtime = createGraphRuntime(createGraph({ nodes: [root, ...nodes] }), {
      diagnostics: { sink: collector },
    });

    await runtime.execute(nodes);

    expect(collector.getMetrics().nodeAttempts.map((attempt) => attempt.nodeKey)).toEqual([
      "B",
      "_x",
      "a",
      "b",
      "ä",
    ]);
    runtime.shutdown();
  });
});
