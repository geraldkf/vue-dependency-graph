import { createPinia, defineStore, disposePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createApp, defineComponent, h, markRaw, onScopeDispose } from "vue";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  refreshInterval,
  releaseAfter,
  type GraphRuntime,
  type TimerEnvironment,
} from "../../src/core";
import { createBrowserTimerEnvironment, createGraphRuntimePlugin } from "../../src/vue";
import { expectCollected, expectRetained, makeValue, weakRefTo } from "./gc-helpers";

/**
 * Retention: once the runtime has finished with a value, nothing may keep it
 * reachable. Each check holds only a WeakRef to a value the runtime saw, lets
 * the runtime move on, forces garbage collection, and expects the value gone -
 * so a registry, closure, diagnostic event or in-flight bookkeeping that
 * still referenced it would fail the test.
 *
 * Values that the runtime is *supposed* to keep (the current value of a node,
 * or of a context) are asserted as retained, so a test cannot pass just
 * because collection was too eager.
 */

type Tracked = WeakRef<object>;

const fakeClock = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  const environment: TimerEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { dueAt: now + delayMs, callback });
      return id;
    },
    clearTimeout: (handle) => {
      if (typeof handle === "number") timers.delete(handle);
    },
    random: () => 0.5,
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  };
  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    for (const [id, timer] of [...timers]) {
      if (timer.dueAt > now) continue;
      timers.delete(id);
      timer.callback();
    }
  };
  return { environment, advanceBy };
};

/** A loader whose every result is tracked, and whose latest one is current. */
const trackedLoader =
  (tracked: Tracked[], label = "value") =>
  async () => {
    const value = makeValue(label);
    tracked.push(weakRefTo(value));
    return value;
  };

describe("garbage collection harness", () => {
  it("collects what nothing references and keeps what something does", async () => {
    const kept = makeValue("kept");
    const keptRef = weakRefTo(kept);
    const droppedRef = (() => weakRefTo(makeValue("dropped")))();

    await expectCollected(droppedRef, "an unreferenced object");
    await expectRetained(keptRef, "a referenced object");
    expect(kept.label).toBe("kept");
  });
});

describe("values are released when the runtime is done with them", () => {
  it("frees a value when its release policy fires", async () => {
    const clock = fakeClock();
    const tracked: Tracked[] = [];
    const node = defineDataNode({
      key: "released",
      initialValue: null as object | null,
      release: releaseAfter({ durationMs: 100 }),
      load: trackedLoader(tracked),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();
    clock.advanceBy(100);

    expect(runtime.getState(node).hasSuccessfulValue).toBe(false);
    await expectCollected(tracked[0]!, "a released value");
  });

  it("keeps an unsubscribed value when the node has no release policy", async () => {
    const tracked: Tracked[] = [];
    const node = defineDataNode({
      key: "kept",
      initialValue: null as object | null,
      load: trackedLoader(tracked),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    await expectRetained(tracked[0]!, "an unsubscribed value without a release policy");
    expect(runtime.getState(node).hasSuccessfulValue).toBe(true);
  });

  it.each([
    ["without diagnostics", false],
    ["with diagnostics on", true],
  ])("frees values a refresh replaces, %s", async (_name, diagnosticsOn) => {
    const tracked: Tracked[] = [];
    const node = defineDataNode({
      key: "refreshed",
      initialValue: null as object | null,
      load: trackedLoader(tracked),
    });
    const collector = createInMemoryGraphDiagnostics({ capacity: 500 });
    const runtime = createGraphRuntime(
      createGraph({ nodes: [node] }),
      diagnosticsOn ? { diagnostics: { sink: collector } } : undefined,
    );
    await runtime.execute([node]);
    await runtime.refresh([node]);
    await runtime.refresh([node]);
    runtime.createDiagnosticSnapshot();

    await expectCollected(tracked[0]!, "the first value");
    await expectCollected(tracked[1]!, "the second value");
    await expectRetained(tracked[2]!, "the current value");
  });

  it("frees derived values a recomputation replaces", async () => {
    const tracked: Tracked[] = [];
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [ctx] as const,
      derive: ({ get }) => {
        const value = makeValue(`derived-${get(ctx)}`);
        tracked.push(weakRefTo(value));
        return value;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [derived, ctx] }));
    await runtime.execute([derived]);
    runtime.setContext(ctx, 1);
    await runtime.execute([derived]);
    runtime.setContext(ctx, 2);
    await runtime.execute([derived]);

    await expectCollected(tracked[0]!, "the first derived value");
    await expectCollected(tracked[1]!, "the second derived value");
    await expectRetained(tracked[2]!, "the current derived value");
  });

  it("frees a published event payload once it has been processed", async () => {
    const changed = defineEvent<object>("changed");
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx, node] }), {
      diagnostics: { sink: createInMemoryGraphDiagnostics({ capacity: 500 }) },
    });
    await runtime.execute([node]);
    const payload = ((): Tracked => {
      const value = makeValue("payload");
      runtime.publish(changed, value);
      return weakRefTo(value);
    })();
    await runtime.execute([node]);

    await expectCollected(payload, "an event payload");
  });
});

describe("abandoned and superseded work is not retained", () => {
  it.each(["aborted", "superseded"] as const)(
    "does not keep the late result of an attempt that was %s",
    async (kind) => {
      const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
      let resolveLate: ((value: object) => void) | undefined;
      const node = defineDataNode({
        key: "late",
        dependencies: [ctx] as const,
        initialValue: null as object | null,
        load: () =>
          new Promise<object>((resolve) => {
            resolveLate = resolve;
          }),
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [node, ctx] }));
      const running =
        kind === "aborted"
          ? (() => {
              const subscription = runtime.subscribeNodes([node]);
              return { end: () => subscription.unsubscribe(), done: Promise.resolve() };
            })()
          : {
              end: () => runtime.setContext(ctx, 2),
              done: runtime.execute([node]).catch(() => undefined),
            };
      await new Promise((resolve) => setTimeout(resolve, 5));
      running.end();
      const late = ((): Tracked => {
        const value = makeValue("late result");
        resolveLate!(value);
        resolveLate = undefined;
        return weakRefTo(value);
      })();
      await running.done;
      await runtime.whenSettled();

      await expectCollected(late, `the late result of an ${kind} attempt`);
    },
  );
});

describe("mutations and transactions leave nothing behind", () => {
  it("frees optimistic values, replaced values, and rolled-back values", async () => {
    const original: Tracked[] = [];
    const tracked: Tracked[] = [];
    const track = (label: string): object => {
      const value = makeValue(label);
      tracked.push(weakRefTo(value));
      return value;
    };
    const node = defineDataNode({
      key: "node",
      initialValue: null as object | null,
      load: trackedLoader(original, "original"),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    const succeed = defineMutation({ key: "succeed", execute: async () => "ok" });
    const fail = defineMutation({
      key: "fail",
      execute: async () => {
        throw new Error("remote failed");
      },
    });

    await runtime.mutate(succeed, undefined, {
      optimistic: (effects) => effects.update(node, () => track("optimistic")),
      onSuccess: (effects) => effects.update(node, () => track("confirmed")),
    });
    await runtime
      .mutate(fail, undefined, {
        optimistic: (effects) => effects.update(node, () => track("rolled back")),
        classifyFailure: () => "rejected",
      })
      .catch(() => undefined);

    await expectCollected(original[0]!, "the value before the mutation");
    await expectCollected(tracked[0]!, "the optimistic value");
    await expectCollected(tracked[2]!, "the rolled-back optimistic value");
    await expectRetained(tracked[1]!, "the confirmed value, which is now current");
  });

  it("frees staged transaction values that are discarded or replaced", async () => {
    const ctx = defineContextNode<object>({ key: "ctx", initialValue: makeValue("initial") });
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx] }));
    const tracked: Tracked[] = [];
    const stage = (
      label: string,
      transaction: { setContext: (node: typeof ctx, value: object) => void },
    ): void => {
      const value = makeValue(label);
      tracked.push(weakRefTo(value));
      transaction.setContext(ctx, value);
    };

    await runtime.transaction((transaction) => stage("committed", transaction));
    await runtime
      .transaction((transaction) => {
        stage("discarded", transaction);
        throw new Error("transaction failed");
      })
      .catch(() => undefined);
    await runtime.transaction((transaction) => stage("replacing", transaction));

    await expectCollected(tracked[0]!, "a committed value that was later replaced");
    await expectCollected(tracked[1]!, "a discarded staged value");
    await expectRetained(tracked[2]!, "the current context value");
  });
});

describe("a runtime's lifetime is bounded by its owner", () => {
  const loadThroughBrowserEnvironment = async (dispose: boolean): Promise<Tracked> => {
    const tracked: Tracked[] = [];
    const node = defineDataNode({
      key: "node",
      initialValue: null as object | null,
      load: trackedLoader(tracked),
      refresh: refreshInterval({ intervalMs: 60_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: createBrowserTimerEnvironment(),
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();
    if (dispose) runtime.dispose();
    return tracked[0]!;
  };

  it("frees everything once a runtime using the browser environment is disposed", async () => {
    await expectCollected(await loadThroughBrowserEnvironment(true), "a disposed runtime's value");
  });

  it("keeps an undisposed browser-environment runtime reachable from document listeners", async () => {
    // Why disposal matters: the browser environment registers listeners on
    // `document` and `window`, which hold the runtime's policies and through
    // them its state. Nothing but `dispose()` removes them.
    await expectRetained(
      await loadThroughBrowserEnvironment(false),
      "an undisposed runtime's value",
    );
  });

  it("frees a runtime when the Vue app that installed the plugin unmounts", async () => {
    const value = await (async (): Promise<Tracked> => {
      const tracked: Tracked[] = [];
      const node = defineDataNode({
        key: "node",
        initialValue: null as object | null,
        load: trackedLoader(tracked),
        refresh: refreshInterval({ intervalMs: 60_000 }),
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
        timerEnvironment: createBrowserTimerEnvironment(),
      });
      const app = createApp(defineComponent({ setup: () => () => h("div") }));
      app.use(createGraphRuntimePlugin(runtime));
      app.mount(document.createElement("div"));
      const subscription = runtime.subscribeNodes([node]);
      await runtime.whenSettled();
      subscription.unsubscribe();
      app.unmount();
      return tracked[0]!;
    })();

    await expectCollected(value, "a value of a runtime whose app unmounted");
  });

  it("frees a store-owned runtime when its Pinia instance is disposed", async () => {
    const value = await (async (): Promise<Tracked> => {
      const tracked: Tracked[] = [];
      const node = defineDataNode({
        key: "node",
        initialValue: null as object | null,
        load: trackedLoader(tracked),
        refresh: refreshInterval({ intervalMs: 60_000 }),
      });
      const graph = createGraph({ nodes: [node] });
      // The store pattern the documentation recommends.
      const useStore = defineStore("retention", () => {
        const runtime: GraphRuntime = markRaw(
          createGraphRuntime(graph, { timerEnvironment: createBrowserTimerEnvironment() }),
        );
        onScopeDispose(() => runtime.dispose());
        return { runtime };
      });
      const pinia = createPinia();
      const { runtime } = useStore(pinia);
      const subscription = runtime.subscribeNodes([node]);
      await runtime.whenSettled();
      subscription.unsubscribe();
      disposePinia(pinia);
      return tracked[0]!;
    })();

    await expectCollected(value, "a value of a runtime whose Pinia instance was disposed");
  });
});
