import { describe, expect, it } from "vitest";
import {
  GraphValidationError,
  createGraph,
  defineContextNode,
  defineDerivedNode,
  type AnyNodeDefinition,
  type DerivedNodeDefinition,
} from "../../src/core";

const expectValidation = (
  action: () => unknown,
  code: GraphValidationError["code"],
  keys: readonly string[],
) => {
  try {
    action();
    throw new Error("Expected graph validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(GraphValidationError);
    expect((error as GraphValidationError).code).toBe(code);
    for (const key of keys) expect((error as Error).message).toContain(key);
  }
};

describe("graph validation", () => {
  it("rejects duplicate node keys", () => {
    const first = defineContextNode({ key: "duplicate", initialValue: 1 });
    const second = defineContextNode({ key: "duplicate", initialValue: 2 });

    expectValidation(() => createGraph({ nodes: [first, second] }), "DUPLICATE_NODE_KEY", [
      "duplicate",
    ]);
  });

  it("rejects duplicate dependencies", () => {
    const parent = defineContextNode({ key: "parent", initialValue: 1 });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [parent, parent] as const,
      derive: () => 1,
    });

    expectValidation(() => createGraph({ nodes: [child, parent] }), "DUPLICATE_DEPENDENCY", [
      "child",
      "parent",
    ]);
  });

  it("rejects missing dependencies in connected and disconnected components", () => {
    const missing = defineContextNode({ key: "missing", initialValue: 1 });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [missing] as const,
      derive: () => 1,
    });
    const disconnected = defineContextNode({ key: "disconnected", initialValue: 2 });

    expectValidation(() => createGraph({ nodes: [disconnected, child] }), "MISSING_DEPENDENCY", [
      "child",
      "missing",
    ]);
  });

  it("rejects self cycles", () => {
    let self!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    self = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "self",
      dependencies: () => [self],
      derive: () => "self",
    });

    expectValidation(() => createGraph({ nodes: [self] }), "CIRCULAR_DEPENDENCY", ["self"]);
  });

  it("rejects two-node cycles", () => {
    let first!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    let second!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    first = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "first",
      dependencies: () => [second],
      derive: () => "first",
    });
    second = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "second",
      dependencies: () => [first],
      derive: () => "second",
    });

    expectValidation(() => createGraph({ nodes: [second, first] }), "CIRCULAR_DEPENDENCY", [
      "first",
      "second",
    ]);
  });

  it("rejects longer cycles in disconnected components", () => {
    let first!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    let second!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    let third!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    first = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "A",
      dependencies: () => [second],
      derive: () => "A",
    });
    second = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "B",
      dependencies: () => [third],
      derive: () => "B",
    });
    third = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "C",
      dependencies: () => [first],
      derive: () => "C",
    });
    const disconnected = defineContextNode({ key: "disconnected", initialValue: 1 });

    expectValidation(
      () => createGraph({ nodes: [disconnected, third, first, second] }),
      "CIRCULAR_DEPENDENCY",
      ["A", "B", "C"],
    );
  });

  it("accepts a valid diamond graph", () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const left = defineDerivedNode({ key: "left", dependencies: [root] as const, derive: () => 1 });
    const right = defineDerivedNode({
      key: "right",
      dependencies: [root] as const,
      derive: () => 2,
    });
    const leaf = defineDerivedNode({
      key: "leaf",
      dependencies: [left, right] as const,
      derive: () => 3,
    });

    expect(() => createGraph({ nodes: [leaf, right, left, root] })).not.toThrow();
  });
});
