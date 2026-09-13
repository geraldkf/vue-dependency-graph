import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { render } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  type AnyNodeDefinition,
  type GraphRuntime,
} from "../../src/core";
import { createGraphRuntimePlugin } from "../../src/vue/plugin";
import { useNodes, type UseNodesResult } from "../../src/vue/use-nodes";

const mountProbe = <const TNodes extends readonly AnyNodeDefinition[]>(
  runtime: GraphRuntime,
  nodes: TNodes
): { captured: UseNodesResult<TNodes>; unmount: () => void } => {
  let captured!: UseNodesResult<TNodes>;
  const Probe = defineComponent({
    setup() {
      captured = useNodes(nodes);
      return () => null;
    },
  });
  const { unmount } = render(Probe, {
    global: { plugins: [createGraphRuntimePlugin(runtime)] },
  });
  return { captured, unmount };
};

describe("useNodes", () => {
  it("mount subscribes to every node, unmount releases every subscription", () => {
    const a = defineContextNode({ key: "n-a", initialValue: 1 });
    const b = defineContextNode({ key: "n-b", initialValue: 2 });
    const runtime = createGraphRuntime(createGraph({ nodes: [a, b] }));

    expect(runtime.getSubscriptionState(a).direct).toBe(0);
    expect(runtime.getSubscriptionState(b).direct).toBe(0);

    const { unmount } = mountProbe(runtime, [a, b]);
    expect(runtime.getSubscriptionState(a).direct).toBe(1);
    expect(runtime.getSubscriptionState(b).direct).toBe(1);

    unmount();
    expect(runtime.getSubscriptionState(a).direct).toBe(0);
    expect(runtime.getSubscriptionState(b).direct).toBe(0);
  });

  it("runtime values line up with the typed tuple order", async () => {
    const contextA = defineContextNode({ key: "n-ctxA", initialValue: 1 });
    const contextB = defineContextNode({ key: "n-ctxB", initialValue: 2 });
    const dataA = defineDataNode({
      key: "n-dataA",
      dependencies: [contextA] as const,
      initialValue: 0,
      load: async ({ get }) => get(contextA) * 10,
    });
    const dataB = defineDataNode({
      key: "n-dataB",
      dependencies: [contextB] as const,
      initialValue: 0,
      load: async ({ get }) => get(contextB) * 100,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [contextA, contextB, dataA, dataB] })
    );

    const { captured } = mountProbe(runtime, [dataA, dataB]);
    await runtime.whenSettled();

    expect(captured.results[0].value.data).toBe(10);
    expect(captured.results[1].value.data).toBe(200);
  });

  it("aggregate reflects partial failure correctly", async () => {
    const context = defineContextNode({ key: "n-ctx-fail", initialValue: 1 });
    const okNode = defineDataNode({
      key: "n-ok",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const failingNode = defineDataNode({
      key: "n-fail",
      dependencies: [context] as const,
      initialValue: 0,
      load: async () => {
        throw new Error("load failed");
      },
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [context, okNode, failingNode] })
    );

    const { captured } = mountProbe(runtime, [okNode, failingNode]);
    await runtime.whenSettled();

    expect(captured.results[0].value.hasSuccessfulValue).toBe(true);
    expect(captured.results[1].value.error).not.toBeNull();
    expect(captured.isError.value).toBe(true);
    expect(captured.isSuccess.value).toBe(false);
    expect(captured.errors.value).toHaveLength(1);
    expect(captured.errors.value[0]?.message).toBe("load failed");
  });
});
