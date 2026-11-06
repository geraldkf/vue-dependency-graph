import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "../../src/core";
import { createRuntimeSubscriptionController } from "../../src/core/subscriptions/subscriptions";

const buildLeaves = (count: number) => {
  const root = defineContextNode({ key: "demand.root", initialValue: 0 });
  const leaves = Array.from({ length: count }, (_, index) =>
    defineDerivedNode({
      key: `demand.leaf:${index}`,
      dependencies: [root],
      derive: ({ get }) => get(root),
    }),
  );
  return { root, leaves, graph: createGraph({ nodes: [root, ...leaves] }) };
};

describe("directly subscribed nodes", () => {
  const createController = (graph: ReturnType<typeof buildLeaves>["graph"]) =>
    createRuntimeSubscriptionController({
      graph,
      resolveRegisteredNode: (node) => node,
      notify: () => undefined,
      afterSubscribe: () => undefined,
      afterUnsubscribe: () => undefined,
    });

  it("lists direct subscribers in graph order, whatever order they subscribed in", () => {
    const { leaves, graph } = buildLeaves(5);
    const controller = createController(graph);

    controller.subscribeNodes([leaves[3]!]);
    controller.subscribeNodes([leaves[0]!, leaves[4]!]);
    controller.subscribeNodes([leaves[1]!]);

    expect(controller.getDirectlySubscribedNodes().map((node) => node.key)).toEqual([
      "demand.leaf:0",
      "demand.leaf:1",
      "demand.leaf:3",
      "demand.leaf:4",
    ]);
  });

  it("does not list nodes that are only required by a subscription", () => {
    const { root, leaves, graph } = buildLeaves(2);
    const controller = createController(graph);

    controller.subscribeNodes([leaves[0]!]);

    expect(controller.hasSubscribers(root)).toBe(true);
    expect(controller.getDirectlySubscribedNodes()).toEqual([leaves[0]]);
  });

  it("keeps a node listed until its last direct subscription ends", () => {
    const { leaves, graph } = buildLeaves(2);
    const controller = createController(graph);
    const first = controller.subscribeNodes([leaves[0]!]);
    const second = controller.subscribeNodes([leaves[0]!]);

    first.unsubscribe();
    expect(controller.getDirectlySubscribedNodes()).toEqual([leaves[0]]);
    second.unsubscribe();
    expect(controller.getDirectlySubscribedNodes()).toEqual([]);
  });

  it("empties the list on shutdown", () => {
    const { leaves, graph } = buildLeaves(2);
    const controller = createController(graph);
    controller.subscribeNodes([leaves[0]!, leaves[1]!]);

    controller.shutdown();

    expect(controller.getDirectlySubscribedNodes()).toEqual([]);
  });

  it("shuts down with a very large number of subscriptions to one node", () => {
    const { leaves, graph } = buildLeaves(1);
    let removedDirect = 0;
    const withHook = createRuntimeSubscriptionController({
      graph,
      resolveRegisteredNode: (node) => node,
      notify: () => undefined,
      afterSubscribe: () => undefined,
      afterUnsubscribe: () => undefined,
      onRemoved: (direct) => {
        removedDirect = direct.length;
      },
    });

    const total = 200_000;
    for (let index = 0; index < total; index += 1) withHook.subscribeNodes([leaves[0]!]);

    expect(() => withHook.shutdown()).not.toThrow();
    expect(removedDirect).toBe(total);
  }, 30_000);
});

describe("scheduling from the demand index", () => {
  it("loads demanded nodes in graph order regardless of subscription order", async () => {
    const root = defineContextNode({ key: "order.root", initialValue: 0 });
    const loadOrder: string[] = [];
    const nodes = Array.from({ length: 5 }, (_, index) =>
      defineDataNode({
        key: `order.data:${index}`,
        dependencies: [root],
        initialValue: 0,
        load: async () => {
          loadOrder.push(`order.data:${index}`);
          return index;
        },
      }),
    );
    const runtime = createGraphRuntime(createGraph({ nodes: [root, ...nodes] }), {
      maxConcurrentLoads: 1,
    });

    runtime.subscribeNodes([nodes[4]!]);
    runtime.subscribeNodes([nodes[1]!, nodes[3]!]);
    runtime.subscribeNodes([nodes[0]!]);
    await runtime.whenSettled();

    expect(loadOrder).toEqual(["order.data:0", "order.data:1", "order.data:3", "order.data:4"]);
  });

  it("stops scheduling a node once its direct subscription ends", async () => {
    const root = defineContextNode({ key: "stop.root", initialValue: 0 });
    let loads = 0;
    const node = defineDataNode({
      key: "stop.data",
      dependencies: [root],
      initialValue: 0,
      load: async ({ get }) => {
        loads += 1;
        return get(root);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [root, node] }));
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(loads).toBe(1);

    subscription.unsubscribe();
    runtime.setContext(root, 1);
    await runtime.whenSettled();

    expect(loads).toBe(1);
  });
});
