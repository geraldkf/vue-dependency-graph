import { describe, expect, it } from "vitest";
import { createGraph, defineContextNode, defineDerivedNode } from "../../src/core";

const topology = (order: "parent-first" | "child-first" | "mixed") => {
  const root = defineContextNode({ key: "root", initialValue: 1 });
  const left = defineDerivedNode({
    key: "left",
    dependencies: [root] as const,
    derive: ({ get }) => get(root) + 1,
  });
  const right = defineDerivedNode({
    key: "right",
    dependencies: [root] as const,
    derive: ({ get }) => get(root) + 2,
  });
  const leaf = defineDerivedNode({
    key: "leaf",
    dependencies: [left, right] as const,
    derive: ({ get }) => get(left) + get(right),
  });

  const nodes = {
    "parent-first": [root, left, right, leaf],
    "child-first": [leaf, right, left, root],
    mixed: [right, root, leaf, left],
  }[order];
  const graph = createGraph({ nodes });

  return Object.fromEntries(
    ["root", "left", "right", "leaf"].map((key) => [
      key,
      {
        parents: graph.getParents(key).map((node) => node.key),
        children: graph.getChildren(key).map((node) => node.key),
      },
    ]),
  );
};

describe("graph registration", () => {
  it("exposes equivalent topology for each registration order", () => {
    expect(topology("child-first")).toEqual(topology("parent-first"));
    expect(topology("mixed")).toEqual(topology("parent-first"));
  });

  it("indexes roots, leaves, multiple relationships, diamonds, and disconnected nodes", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const disconnected = defineContextNode({ key: "disconnected", initialValue: 2 });
    const left = defineDerivedNode({ key: "left", dependencies: [root] as const, derive: () => 1 });
    const right = defineDerivedNode({
      key: "right",
      dependencies: [root] as const,
      derive: () => 2,
    });
    const leaf = defineDerivedNode({
      key: "leaf",
      dependencies: [left, right] as const,
      derive: ({ get }) => get(left) + get(right),
    });
    const graph = createGraph({ nodes: [leaf, disconnected, right, root, left] });

    expect(graph.getParents(root)).toEqual([]);
    expect(graph.getChildren(root).map((node) => node.key)).toEqual(["left", "right"]);
    expect(graph.getParents(leaf).map((node) => node.key)).toEqual(["left", "right"]);
    expect(graph.getChildren(leaf)).toEqual([]);
    expect(graph.getParents(disconnected)).toEqual([]);
    expect(graph.getChildren(disconnected)).toEqual([]);
  });

  it("preserves registration order and protects returned topology collections", () => {
    const first = defineContextNode({ key: "first", initialValue: 1 });
    const second = defineDerivedNode({
      key: "second",
      dependencies: [first] as const,
      derive: () => 2,
    });
    const graph = createGraph({ nodes: [second, first] });

    expect(graph.getNodes().map((node) => node.key)).toEqual(["second", "first"]);
    expect(graph.getNode("first")).toBe(first);
    expect(graph.hasNode("missing")).toBe(false);
    expect(graph.getNode("missing")).toBeUndefined();
    expect(graph.getParents("missing")).toEqual([]);
    expect(graph.getChildren("missing")).toEqual([]);

    const nodes = graph.getNodes();
    expect(Object.isFrozen(nodes)).toBe(true);
    expect(Object.isFrozen(graph.getParents(second))).toBe(true);
    expect(Object.isFrozen(graph.getChildren(first))).toBe(true);
    expect(graph.getChildren(first).map((node) => node.key)).toEqual(["second"]);
  });
});
