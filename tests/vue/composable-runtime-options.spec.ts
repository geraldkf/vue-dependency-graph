import { render } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
} from "../../src/core";
import { createGraphRuntimePlugin } from "../../src/vue/plugin";
import { useNode } from "../../src/vue/use-node";
import { useNodes } from "../../src/vue/use-nodes";

describe("graph composable runtime options", () => {
  it("useNode uses an explicit runtime without plugin injection", () => {
    const context = defineContextNode({
      key: "options:use-node:context",
      initialValue: 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));

    const Probe = defineComponent({
      setup() {
        const result = useNode(context, { runtime });
        return () => result.data.value;
      },
    });

    const { getByText, unmount } = render(Probe);

    expect(getByText("1")).toBeTruthy();
    expect(runtime.getSubscriptionState(context).direct).toBe(1);

    unmount();
    expect(runtime.getSubscriptionState(context).direct).toBe(0);
  });

  it("useNodes uses an explicit runtime without plugin injection", () => {
    const first = defineContextNode({
      key: "options:use-nodes:first",
      initialValue: 1,
    });
    const second = defineContextNode({
      key: "options:use-nodes:second",
      initialValue: "two",
    });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [first, second] })
    );

    const Probe = defineComponent({
      setup() {
        const { results } = useNodes([first, second], { runtime });
        return () => `${results[0].value.data}:${results[1].value.data}`;
      },
    });

    const { getByText, unmount } = render(Probe);

    expect(getByText("1:two")).toBeTruthy();
    expect(runtime.getSubscriptionState(first).direct).toBe(1);
    expect(runtime.getSubscriptionState(second).direct).toBe(1);

    unmount();
    expect(runtime.getSubscriptionState(first).direct).toBe(0);
    expect(runtime.getSubscriptionState(second).direct).toBe(0);
  });

  it("prefers the explicit runtime over an injected runtime", () => {
    const context = defineContextNode({
      key: "options:precedence:context",
      initialValue: 0,
    });
    const graph = createGraph({ nodes: [context] });
    const explicitRuntime = createGraphRuntime(graph);
    const injectedRuntime = createGraphRuntime(graph);
    explicitRuntime.setContext(context, 10);
    injectedRuntime.setContext(context, 20);

    const Probe = defineComponent({
      setup() {
        const result = useNode(context, { runtime: explicitRuntime });
        return () => result.data.value;
      },
    });

    const { getByText } = render(Probe, {
      global: {
        plugins: [createGraphRuntimePlugin(injectedRuntime)],
      },
    });

    expect(getByText("10")).toBeTruthy();
    expect(explicitRuntime.getSubscriptionState(context).direct).toBe(1);
    expect(injectedRuntime.getSubscriptionState(context).direct).toBe(0);
  });
});
