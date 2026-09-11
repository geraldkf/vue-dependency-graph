import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
} from "../../src/core";

describe("runtime observation", () => {
  it("defers listeners added during dispatch until a later transition", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const addedDuringDispatch = vi.fn();
    let registered = false;

    runtime.onChange(() => {
      if (registered) return;
      registered = true;
      runtime.onChange(addedDuringDispatch);
    });

    runtime.setContext(context, 2);
    expect(addedDuringDispatch).not.toHaveBeenCalled();

    runtime.setContext(context, 3);
    expect(addedDuringDispatch).toHaveBeenCalledOnce();
  });

  it("finishes the current dispatch snapshot when a listener is removed", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const runtime = createGraphRuntime(createGraph({ nodes: [context] }));
    const removedDuringDispatch = vi.fn();
    let stopRemovedListener = (): void => undefined;

    runtime.onChange(() => stopRemovedListener());
    stopRemovedListener = runtime.onChange(removedDuringDispatch);

    runtime.setContext(context, 2);
    expect(removedDuringDispatch).toHaveBeenCalledOnce();

    runtime.setContext(context, 3);
    expect(removedDuringDispatch).toHaveBeenCalledOnce();
  });

  it("keeps listeners isolated between runtime instances", () => {
    const context = defineContextNode({ key: "context", initialValue: 1 });
    const graph = createGraph({ nodes: [context] });
    const first = createGraphRuntime(graph);
    const second = createGraphRuntime(graph);
    const firstListener = vi.fn();

    first.onChange(firstListener);
    second.setContext(context, 2);

    expect(firstListener).not.toHaveBeenCalled();
    expect(first.getState(context).data).toBe(1);
    expect(second.getState(context).data).toBe(2);
  });
});
