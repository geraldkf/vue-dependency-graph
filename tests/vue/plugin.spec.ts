import { describe, expect, it } from "vitest";
import { defineComponent, onScopeDispose } from "vue";
import { render } from "@testing-library/vue";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  type GraphRuntime,
} from "../../src/core";
import {
  GraphRuntimeKey,
  createGraphRuntimePlugin,
  useGraphRuntime,
} from "../../src/vue/plugin";

const makeTestRuntime = (): GraphRuntime => {
  const context = defineContextNode({ key: "probe-context", initialValue: 1 });
  return createGraphRuntime(createGraph({ nodes: [context] }));
};

describe("Vue plugin and injection", () => {
  it("useGraphRuntime throws when no runtime has been provided", () => {
    const Probe = defineComponent({
      setup() {
        useGraphRuntime();
        return () => null;
      },
    });

    expect(() => render(Probe)).toThrow(/No GraphRuntime found/);
  });

  it("resolves the runtime provided via global.provide", () => {
    const runtime = makeTestRuntime();
    let captured: GraphRuntime | undefined;

    const Probe = defineComponent({
      setup() {
        captured = useGraphRuntime();
        return () => null;
      },
    });

    render(Probe, {
      global: { provide: { [GraphRuntimeKey]: runtime } },
    });

    expect(captured).toBe(runtime);
  });

  it("resolves the runtime installed via createGraphRuntimePlugin", () => {
    const runtime = makeTestRuntime();
    let captured: GraphRuntime | undefined;

    const Probe = defineComponent({
      setup() {
        captured = useGraphRuntime();
        return () => null;
      },
    });

    render(Probe, {
      global: { plugins: [createGraphRuntimePlugin(runtime)] },
    });

    expect(captured).toBe(runtime);
  });

  it("confirms render() creates a real effect scope that onScopeDispose fires within", () => {
    // This is the check the plan called for before V3/V4 rely on
    // onScopeDispose to release subscriptions: confirm the test harness
    // itself creates a genuine effect scope, not just that our own code
    // compiles against onScopeDispose.
    let disposed = false;

    const Probe = defineComponent({
      setup() {
        onScopeDispose(() => {
          disposed = true;
        });
        return () => null;
      },
    });

    const { unmount } = render(Probe);
    expect(disposed).toBe(false);
    unmount();
    expect(disposed).toBe(true);
  });
});
