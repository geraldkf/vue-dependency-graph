import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
} from "../../src/core";
import { createRuntimeObserver } from "../../src/core/observation/observer";

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

  describe("listener failures", () => {
    it("isolates a throwing listener and reports it to onListenerError", () => {
      const reported: unknown[] = [];
      const observer = createRuntimeObserver({
        onListenerError: error => reported.push(error),
      });
      const failure = new Error("listener failure");
      const before = vi.fn();
      const after = vi.fn();
      observer.onChange(before);
      observer.onChange(() => {
        throw failure;
      });
      observer.onChange(after);

      expect(() => observer.notify()).not.toThrow();

      expect(before).toHaveBeenCalledOnce();
      expect(after).toHaveBeenCalledOnce();
      expect(reported).toEqual([failure]);
    });

    it("reports each failing listener separately", () => {
      const reported: unknown[] = [];
      const observer = createRuntimeObserver({
        onListenerError: error => reported.push(error),
      });
      observer.onChange(() => {
        throw new Error("first");
      });
      observer.onChange(() => {
        throw "second";
      });

      observer.notify();

      expect(reported).toHaveLength(2);
      expect((reported[0] as Error).message).toBe("first");
      expect(reported[1]).toBe("second");
    });

    it("stays isolated when the error reporter itself throws", () => {
      const observer = createRuntimeObserver({
        onListenerError: () => {
          throw new Error("reporter failure");
        },
      });
      const after = vi.fn();
      observer.onChange(() => {
        throw new Error("listener failure");
      });
      observer.onChange(after);

      expect(() => observer.notify()).not.toThrow();
      expect(after).toHaveBeenCalledOnce();
    });

    it("isolates a throwing listener when no reporter is given", () => {
      const observer = createRuntimeObserver();
      const after = vi.fn();
      observer.onChange(() => {
        throw new Error("listener failure");
      });
      observer.onChange(after);

      expect(() => observer.notify()).not.toThrow();
      expect(after).toHaveBeenCalledOnce();
    });
  });
});
