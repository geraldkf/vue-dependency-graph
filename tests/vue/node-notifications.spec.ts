import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { render } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  type AnyNodeDefinition,
  type GraphRuntime,
} from "../../src/core";
import { createGraphRuntimePlugin } from "../../src/vue/plugin";
import { useNode, type UseNodeResult } from "../../src/vue/use-node";
import { useNodes, type UseNodesResult } from "../../src/vue/use-nodes";

/** A runtime whose `getState` is observable, as the composables see it. */
const observed = (runtime: GraphRuntime) => {
  const getState = vi.fn(runtime.getState);
  return { runtime: { ...runtime, getState } as GraphRuntime, getState };
};

const mount = <T>(runtime: GraphRuntime, setup: () => T): { captured: T; unmount: () => void } => {
  let captured!: T;
  const Probe = defineComponent({
    setup() {
      captured = setup();
      return () => null;
    },
  });
  const { unmount } = render(Probe, {
    // The runtime outlives the component in these tests.
    global: { plugins: [createGraphRuntimePlugin(runtime, { disposeOnUnmount: false })] },
  });
  return { captured, unmount };
};

const stateReads = (getState: ReturnType<typeof observed>["getState"], node: AnyNodeDefinition) =>
  getState.mock.calls.filter(([read]) => read.key === node.key).length;

describe("composables and per-node notifications", () => {
  it("useNode does not re-read state when an unrelated node changes", () => {
    const watched = defineContextNode({ key: "notify.watched", initialValue: 0 });
    const other = defineContextNode({ key: "notify.other", initialValue: 0 });
    const base = createGraphRuntime(createGraph({ nodes: [watched, other] }));
    const { runtime, getState } = observed(base);
    const { captured } = mount(runtime, (): UseNodeResult<typeof watched> => useNode(watched));
    getState.mockClear();

    base.setContext(other, 1);
    base.setContext(other, 2);
    expect(getState).not.toHaveBeenCalled();

    base.setContext(watched, 5);
    expect(captured.data.value).toBe(5);
    expect(stateReads(getState, watched)).toBeGreaterThan(0);
  });

  it("useNode stops listening on unmount", () => {
    const watched = defineContextNode({ key: "notify.unmount", initialValue: 0 });
    const base = createGraphRuntime(createGraph({ nodes: [watched] }));
    const { runtime, getState } = observed(base);
    const { unmount } = mount(runtime, () => useNode(watched));

    unmount();
    getState.mockClear();
    base.setContext(watched, 1);

    expect(getState).not.toHaveBeenCalled();
    expect(base.getSubscriptionState(watched).direct).toBe(0);
  });

  it("useNode catches up on a change made between its first read and its listener", () => {
    const watched = defineContextNode({ key: "notify.catchup", initialValue: 0 });
    const base = createGraphRuntime(createGraph({ nodes: [watched] }));
    const racing: GraphRuntime = {
      ...base,
      subscribeNodes: (nodes) => {
        const subscription = base.subscribeNodes(nodes);
        base.setContext(watched, 99); // lands after the first read, before the listener
        return subscription;
      },
    };

    const { captured } = mount(racing, () => useNode(watched));

    expect(captured.data.value).toBe(99);
  });

  it("useNodes updates only the node that changed and keeps the other results' identity", () => {
    const a = defineContextNode({ key: "notify.multi.a", initialValue: 1 });
    const b = defineContextNode({ key: "notify.multi.b", initialValue: 2 });
    const c = defineContextNode({ key: "notify.multi.c", initialValue: 3 });
    const base = createGraphRuntime(createGraph({ nodes: [a, b, c] }));
    const { captured } = mount(base, (): UseNodesResult<readonly [typeof a, typeof b, typeof c]> =>
      useNodes([a, b, c] as const),
    );
    const untouchedB = captured.results[1].value;
    const untouchedC = captured.results[2].value;

    base.setContext(a, 10);

    expect(captured.results[0].value.data).toBe(10);
    expect(captured.results[1].value).toBe(untouchedB);
    expect(captured.results[2].value).toBe(untouchedC);
  });

  it("useNodes does not re-read nodes that did not change, and stops on unmount", () => {
    const a = defineContextNode({ key: "notify.reads.a", initialValue: 1 });
    const b = defineContextNode({ key: "notify.reads.b", initialValue: 2 });
    const base = createGraphRuntime(createGraph({ nodes: [a, b] }));
    const { runtime, getState } = observed(base);
    const { unmount } = mount(runtime, () => useNodes([a, b] as const));
    getState.mockClear();

    base.setContext(a, 5);
    expect(stateReads(getState, a)).toBeGreaterThan(0);
    expect(stateReads(getState, b)).toBe(0);

    unmount();
    getState.mockClear();
    base.setContext(a, 6);
    base.setContext(b, 6);
    expect(getState).not.toHaveBeenCalled();
  });

  it("useNodes aggregates still follow every node", () => {
    const a = defineContextNode({ key: "notify.agg.a", initialValue: 1 });
    const b = defineContextNode({ key: "notify.agg.b", initialValue: 2 });
    const base = createGraphRuntime(createGraph({ nodes: [a, b] }));
    const { captured } = mount(base, () => useNodes([a, b] as const));

    expect(captured.isSuccess.value).toBe(true);
    base.setContext(b, 7);

    expect(captured.results[1].value.data).toBe(7);
    expect(captured.isError.value).toBe(false);
  });

  it("useNodes catches up on changes made before its listeners were registered", () => {
    const a = defineContextNode({ key: "notify.multi-catchup.a", initialValue: 1 });
    const b = defineContextNode({ key: "notify.multi-catchup.b", initialValue: 2 });
    const base = createGraphRuntime(createGraph({ nodes: [a, b] }));
    const racing: GraphRuntime = {
      ...base,
      subscribeNodes: (nodes) => {
        const subscription = base.subscribeNodes(nodes);
        base.setContext(b, 42);
        return subscription;
      },
    };

    const { captured } = mount(racing, () => useNodes([a, b] as const));

    expect(captured.results[0].value.data).toBe(1);
    expect(captured.results[1].value.data).toBe(42);
  });
});
