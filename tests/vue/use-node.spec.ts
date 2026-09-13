import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { render } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  type GraphRuntime,
} from "../../src/core";
import { createGraphRuntimePlugin } from "../../src/vue/plugin";
import { useNode, type UseNodeResult } from "../../src/vue/use-node";

const mountProbe = (
  runtime: GraphRuntime,
  node: Parameters<typeof useNode>[0]
): { captured: UseNodeResult<typeof node>; unmount: () => void } => {
  let captured!: UseNodeResult<typeof node>;
  const Probe = defineComponent({
    setup() {
      captured = useNode(node);
      return () => null;
    },
  });
  const { unmount } = render(Probe, {
    global: { plugins: [createGraphRuntimePlugin(runtime)] },
  });
  return { captured, unmount };
};

describe("useNode", () => {
  it("mount creates a subscription", () => {
    const context = defineContextNode({ key: "d-ctx1", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    expect(runtime.getSubscriptionState(context).direct).toBe(0);
    mountProbe(runtime, context);
    expect(runtime.getSubscriptionState(context).direct).toBe(1);
  });

  it("unmount releases the subscription", () => {
    const context = defineContextNode({ key: "d-ctx2", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const { unmount } = mountProbe(runtime, context);
    expect(runtime.getSubscriptionState(context).direct).toBe(1);

    unmount();
    expect(runtime.getSubscriptionState(context).direct).toBe(0);
  });

  it("reacts to status and data changes", async () => {
    const context = defineContextNode({ key: "d-ctx3", initialValue: 1 });
    const data = defineDataNode({
      key: "d-data3",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => get(context),
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [context, data] })
    );

    const { captured } = mountProbe(runtime, data);

    // Subscribing doesn't synchronously start the load — the scheduler's
    // flush is microtask-queued — so status is still "idle" right after
    // mount, reflecting the node's untouched initial state.
    expect(captured.status.value).toBe("idle");
    expect(captured.data.value).toBe(0);

    await runtime.whenSettled();
    expect(captured.status.value).toBe("success");
    expect(captured.data.value).toBe(1);

    runtime.setContext(context, 2);
    await runtime.whenSettled();
    expect(captured.data.value).toBe(2);
  });

  it("two consumers on the same node share one load", async () => {
    const context = defineContextNode({ key: "d-ctx4", initialValue: 1 });
    const load = vi.fn(async ({ get }) => get(context));
    const data = defineDataNode({
      key: "d-data4",
      dependencies: [context] as const,
      initialValue: 0,
      load,
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [context, data] })
    );

    // Two independent mounted consumers of the same node. This confirms
    // useNode doesn't accidentally break the core's existing execution
    // dedup (already covered by core-level tests) — it isn't re-testing
    // the dedup mechanism itself, only that the Vue layer doesn't defeat it.
    mountProbe(runtime, data);
    mountProbe(runtime, data);

    await runtime.whenSettled();

    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getSubscriptionState(data).direct).toBe(2);
  });

  it("throws when called outside an active effect scope", () => {
    const context = defineContextNode({ key: "d-ctx5", initialValue: 1 });

    expect(() => useNode(context)).toThrow(
      /useNode\(\) must be called inside setup\(\)/
    );
  });
});
