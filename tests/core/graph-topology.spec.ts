import { describe, expect, it, vi } from "vitest";
import {
  GraphValidationError,
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  type AnyNodeDefinition,
  type DerivedNodeDefinition,
  type EventInvalidationContext,
} from "../../src/core";

describe("dependency resolution", () => {
  it("does not evaluate a dependency resolver when the node is defined", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const resolver = vi.fn(() => [context] as const);

    defineDerivedNode({
      key: "derived",
      dependencies: resolver,
      derive: () => 1,
    });
    defineDataNode({
      key: "data",
      dependencies: resolver,
      initialValue: 0,
      load: async () => 1,
    });

    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(["derived", "data"] as const)(
    "resolves a %s node's dependency resolver once and keeps the result stable",
    (kind) => {
      const context = defineContextNode({ key: "context", initialValue: 1 });
      const resolver = vi.fn(() => [context] as const);
      const node =
        kind === "derived"
          ? defineDerivedNode({
              key: "node",
              dependencies: resolver,
              derive: () => 1,
            })
          : defineDataNode({
              key: "node",
              dependencies: resolver,
              initialValue: 0,
              load: async () => 1,
            });

      createGraph({ nodes: [node, context] });
      const first = node.dependencies;
      const second = node.dependencies;

      expect(resolver).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      expect(first).toEqual([context]);
      expect(Object.isFrozen(first)).toBe(true);
    },
  );

  it("keeps a plain dependency array stable and frozen", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const node = defineDerivedNode({
      key: "node",
      dependencies: [context] as const,
      derive: () => 1,
    });

    expect(node.dependencies).toBe(node.dependencies);
    expect(Object.isFrozen(node.dependencies)).toBe(true);
  });

  it("does not let a caller's array mutate resolved dependencies", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const source = [context] as AnyNodeDefinition[];
    const node = defineDerivedNode({
      key: "node",
      dependencies: source as unknown as readonly [typeof context],
      derive: () => 1,
    });

    source.push(defineContextNode({ key: "late", initialValue: 2 }));

    expect(node.dependencies.map((dependency) => dependency.key)).toEqual(["context"]);
  });

  it("supports forward references between definitions", () => {
    let later!: DerivedNodeDefinition<string, readonly AnyNodeDefinition[]>;
    const earlier = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "earlier",
      dependencies: () => [later],
      derive: () => "earlier",
    });
    const context = defineContextNode({ key: "context", initialValue: 1 });
    later = defineDerivedNode<string, readonly AnyNodeDefinition[]>({
      key: "later",
      dependencies: () => [context],
      derive: () => "later",
    });

    const graph = createGraph({ nodes: [earlier, later, context] });

    expect(graph.getParents(earlier)).toEqual([later]);
    expect(graph.getParents(later)).toEqual([context]);
    expect(graph.getChildren(context)).toEqual([later]);
  });

  it("does not cache a failed resolution", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    let ready = false;
    const resolver = vi.fn(() => {
      if (!ready) throw new Error("dependency not defined yet");
      return [context] as const;
    });
    const node = defineDerivedNode({
      key: "node",
      dependencies: resolver,
      derive: () => 1,
    });

    expect(() => node.dependencies).toThrowError("dependency not defined yet");

    ready = true;
    expect(node.dependencies).toEqual([context]);
    expect(node.dependencies).toBe(node.dependencies);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

describe("graph topology contract", () => {
  const build = () => {
    const root = defineContextNode({ key: "root", initialValue: 1 });
    const zeta = defineDerivedNode({
      key: "zeta",
      dependencies: [root] as const,
      derive: () => 1,
    });
    const alpha = defineDerivedNode({
      key: "alpha",
      dependencies: [root] as const,
      derive: () => 2,
    });
    const leaf = defineDerivedNode({
      key: "leaf",
      dependencies: [zeta, alpha] as const,
      derive: () => 3,
    });
    return { root, zeta, alpha, leaf };
  };

  it("returns the same frozen collection on every call", () => {
    const { root, zeta, alpha, leaf } = build();
    const graph = createGraph({ nodes: [leaf, zeta, alpha, root] });

    for (const collection of [graph.getNodes(), graph.getParents(leaf), graph.getChildren(root)]) {
      expect(Object.isFrozen(collection)).toBe(true);
    }
    expect(graph.getNodes()).toBe(graph.getNodes());
    expect(graph.getParents(leaf)).toBe(graph.getParents("leaf"));
    expect(graph.getChildren(root)).toBe(graph.getChildren("root"));
    expect(graph.getParents("missing")).toBe(graph.getParents("also-missing"));
    expect(() => (graph.getNodes() as AnyNodeDefinition[]).push(root)).toThrow();
  });

  it("keeps parent order as declared and child order sorted by key", () => {
    const { root, zeta, alpha, leaf } = build();
    const graph = createGraph({ nodes: [leaf, zeta, alpha, root] });

    expect(graph.getNodes().map((node) => node.key)).toEqual(["leaf", "zeta", "alpha", "root"]);
    expect(graph.getParents(leaf).map((node) => node.key)).toEqual(["zeta", "alpha"]);
    expect(graph.getChildren(root).map((node) => node.key)).toEqual(["alpha", "zeta"]);
  });

  it("is not affected by mutating the node array passed to createGraph", () => {
    const { root, zeta, alpha, leaf } = build();
    const nodes = [leaf, zeta, alpha, root];
    const graph = createGraph({ nodes });

    nodes.length = 0;

    expect(graph.getNodes()).toHaveLength(4);
  });

  it("resolves parents to the registered node for each key", () => {
    const registered = defineContextNode({ key: "shared", initialValue: 1 });
    const sameKeyDifferentObject = defineContextNode({
      key: "shared",
      initialValue: 1,
    });
    const child = defineDerivedNode({
      key: "child",
      dependencies: [sameKeyDifferentObject] as const,
      derive: () => 1,
    });

    const graph = createGraph({ nodes: [child, registered] });

    expect(graph.getParents(child)[0]).toBe(registered);
    expect(graph.getParents("child")[0]).toBe(registered);
  });

  it("keeps cycle errors deterministic regardless of registration order", () => {
    const create = () => {
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
      return { first, second, third };
    };
    const messageFor = (order: readonly ("first" | "second" | "third")[]) => {
      const nodes = create();
      try {
        createGraph({ nodes: order.map((name) => nodes[name]) });
      } catch (error) {
        expect(error).toBeInstanceOf(GraphValidationError);
        return (error as Error).message;
      }
      throw new Error("Expected a cycle error.");
    };

    const expected = messageFor(["first", "second", "third"]);
    expect(expected).toBe("Circular dependency detected: A -> B -> C -> A");
    expect(messageFor(["third", "second", "first"])).toBe(expected);
    expect(messageFor(["second", "third", "first"])).toBe(expected);
  });
});

describe("event matching and dependency resolution", () => {
  it("does not re-run a dependency resolver while matching event predicates", () => {
    const jobSeekerId = defineContextNode({ key: "jobSeekerId", initialValue: 123 });
    const changed = defineEvent<{ jobSeekerId: number }>("domain.changed");
    const resolver = vi.fn(() => [jobSeekerId] as const);
    const data = defineDataNode({
      key: "data",
      dependencies: resolver,
      invalidatedBy: [
        {
          event: changed,
          when: ({
            payload,
            get,
          }: EventInvalidationContext<typeof changed, readonly [typeof jobSeekerId]>) =>
            payload.jobSeekerId === get(jobSeekerId),
        },
      ] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, jobSeekerId] }));
    const callsAfterConstruction = resolver.mock.calls.length;

    runtime.publish(changed, { jobSeekerId: 999 });
    runtime.publish(changed, { jobSeekerId: 123 });
    runtime.publish(changed, { jobSeekerId: 123 });

    expect(runtime.getState(data).generation).toBe(2);
    expect(resolver).toHaveBeenCalledTimes(callsAfterConstruction);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("rejects predicate reads of undeclared dependencies", () => {
    const declared = defineContextNode({ key: "declared", initialValue: 1 });
    const undeclared = defineContextNode({ key: "undeclared", initialValue: 2 });
    const changed = defineEvent<void>("domain.changed");
    const data = defineDataNode({
      key: "data",
      dependencies: [declared] as const,
      invalidatedBy: [
        {
          event: changed,
          when: ({ get }: EventInvalidationContext<typeof changed, readonly [typeof declared]>) =>
            (get as (node: AnyNodeDefinition) => unknown)(undeclared) === 2,
        },
      ] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [data, declared, undeclared] }));

    expect(() => runtime.publish(changed, undefined)).toThrowError(
      'Node "data" event predicate cannot read undeclared dependency "undeclared".',
    );
  });
});
