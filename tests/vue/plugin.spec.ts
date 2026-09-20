import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, onScopeDispose } from "vue";
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

  describe("runtime disposal", () => {
    const makeDisposableRuntime = () => {
      const runtime = makeTestRuntime();
      const dispose = vi.fn(() => runtime.dispose());
      return { runtime: { ...runtime, dispose } as GraphRuntime, dispose };
    };
    const Empty = defineComponent({ setup: () => () => null });

    it("disposes the runtime when the app unmounts", () => {
      const { runtime, dispose } = makeDisposableRuntime();

      const { unmount } = render(Empty, {
        global: { plugins: [createGraphRuntimePlugin(runtime)] },
      });
      expect(dispose).not.toHaveBeenCalled();

      unmount();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("leaves the runtime alone when disposeOnUnmount is false", () => {
      const { runtime, dispose } = makeDisposableRuntime();

      const { unmount } = render(Empty, {
        global: {
          plugins: [
            createGraphRuntimePlugin(runtime, { disposeOnUnmount: false }),
          ],
        },
      });
      unmount();

      expect(dispose).not.toHaveBeenCalled();
    });

    it("does not dispose the runtime because a component inside the app unmounts", () => {
      const { runtime, dispose } = makeDisposableRuntime();
      const Probe = defineComponent({
        setup() {
          useGraphRuntime();
          return () => null;
        },
      });
      const Host = defineComponent({
        props: { show: { type: Boolean, default: true } },
        setup: props => () => (props.show ? h(Probe) : null),
      });

      const { rerender, unmount } = render(Host, {
        global: { plugins: [createGraphRuntimePlugin(runtime)] },
      });
      rerender({ show: false });
      expect(dispose).not.toHaveBeenCalled();

      unmount();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("disposes a runtime only once per unmount, and disposal stays idempotent", () => {
      const runtime = makeTestRuntime();

      const { unmount } = render(Empty, {
        global: { plugins: [createGraphRuntimePlugin(runtime)] },
      });
      runtime.dispose();

      expect(() => unmount()).not.toThrow();
    });
  });
});
