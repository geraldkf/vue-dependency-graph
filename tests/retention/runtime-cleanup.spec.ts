import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  refreshInterval,
  releaseAfter,
  type GraphRuntime,
  type TimerEnvironment,
} from "../../src/core";
import { createBrowserTimerEnvironment, useNode } from "../../src/vue";

/**
 * Structural cleanup: after the work is over, the runtime's registries are
 * back to where they started - no subscriptions, timers, listeners, or
 * in-flight attempts, and bounded diagnostics. Complements the garbage
 * collection checks, which look at what stays reachable.
 */

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
  return { environment, advanceBy, timerCount: () => timers.size };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const expectQuiescent = (runtime: GraphRuntime): void => {
  const snapshot = runtime.createDiagnosticSnapshot();
  expect(snapshot.subscriptions.filter((entry) => entry.total !== 0)).toEqual([]);
  expect(snapshot.scheduler).toMatchObject({ isScheduled: false, isRunning: false });
  expect(snapshot.metrics?.activeLoads).toBe(0);
};

describe("subscriptions and scheduling", () => {
  const buildGraph = () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const a = defineDataNode({
      key: "a",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx),
    });
    const b = defineDataNode({
      key: "b",
      dependencies: [a] as const,
      initialValue: 0,
      load: async ({ get }) => get(a) + 1,
    });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [b] as const,
      derive: ({ get }) => get(b) * 2,
    });
    return { ctx, a, b, derived };
  };

  it("returns to a quiescent state after many subscribe, change, and unsubscribe cycles", async () => {
    const { ctx, a, b, derived } = buildGraph();
    const clock = fakeClock();
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx, a, b, derived] }), {
      timerEnvironment: clock.environment,
      diagnostics: { sink: createInMemoryGraphDiagnostics({ capacity: 100 }) },
    });
    const targets = [[derived], [b], [a, derived], [a, b, derived]] as const;

    for (let cycle = 0; cycle < 1_000; cycle += 1) {
      const subscription = runtime.subscribeNodes(targets[cycle % targets.length]!);
      if (cycle % 3 === 0) runtime.setContext(ctx, cycle);
      if (cycle % 7 === 0) await flush();
      subscription.unsubscribe();
    }
    await runtime.whenSettled();

    expectQuiescent(runtime);
    expect(clock.timerCount()).toBe(0);
  });

  it("counts each subscription once, however many times it is unsubscribed", async () => {
    const { ctx, a, b, derived } = buildGraph();
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx, a, b, derived] }));

    const first = runtime.subscribeNodes([a]);
    const second = runtime.subscribeNodes([a]);
    first.unsubscribe();
    first.unsubscribe();
    first.unsubscribe();

    expect(runtime.getSubscriptionState(a).direct).toBe(1);
    expect(runtime.hasSubscribers(a)).toBe(true);
    second.unsubscribe();
    expect(runtime.getSubscriptionState(a)).toMatchObject({ direct: 0, required: 0, total: 0 });
    expect(runtime.hasSubscribers(a)).toBe(false);
    await runtime.whenSettled();
  });

  it("gives ancestors back when a descendant unsubscribes", async () => {
    const { ctx, a, b, derived } = buildGraph();
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx, a, b, derived] }));

    const subscription = runtime.subscribeNodes([derived]);
    expect(runtime.getSubscriptionState(a).required).toBeGreaterThan(0);
    subscription.unsubscribe();

    for (const node of [ctx, a, b, derived]) {
      expect(runtime.getSubscriptionState(node)).toMatchObject({
        direct: 0,
        required: 0,
        total: 0,
      });
    }
    await runtime.whenSettled();
  });
});

describe("policy timers", () => {
  it("clears refresh and retry timers on unsubscribe, and leaves only the release timer", async () => {
    const clock = fakeClock();
    let fails = false;
    const interval = defineDataNode({
      key: "interval",
      initialValue: 0,
      load: async () => {
        if (fails) throw new Error("interval failed");
        return 1;
      },
      refresh: refreshInterval({
        intervalMs: 1_000,
        retry: { strategy: "fixed", maxRetries: 3, delayMs: 100 },
      }),
    });
    const released = defineDataNode({
      key: "released",
      initialValue: 0,
      release: releaseAfter({ durationMs: 500 }),
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [interval, released] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([interval, released]);
    await runtime.whenSettled();
    expect(clock.timerCount()).toBe(1); // the interval timer

    fails = true;
    clock.advanceBy(1_000);
    await flush();
    expect(clock.timerCount()).toBe(1); // the retry timer replaced it

    subscription.unsubscribe();
    await runtime.whenSettled();
    expect(clock.timerCount()).toBe(1); // only the release timer of the idle node

    clock.advanceBy(500);
    expect(runtime.getState(released).hasSuccessfulValue).toBe(false);
    expect(clock.timerCount()).toBe(0);
  });

  it("clears the release timer when the node is subscribed again, and re-arms it after", async () => {
    const clock = fakeClock();
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      release: releaseAfter({ durationMs: 500 }),
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const first = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    first.unsubscribe();
    expect(clock.timerCount()).toBe(1);

    const second = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(10_000);
    expect(runtime.getState(node).hasSuccessfulValue).toBe(true);

    second.unsubscribe();
    expect(clock.timerCount()).toBe(1);
    runtime.dispose();
    expect(clock.timerCount()).toBe(0);
  });

  it("does not accumulate timers over many subscribe and unsubscribe cycles", async () => {
    const clock = fakeClock();
    const interval = defineDataNode({
      key: "interval",
      initialValue: 0,
      load: async () => 1,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const released = defineDataNode({
      key: "released",
      initialValue: 0,
      release: releaseAfter({ durationMs: 500 }),
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [interval, released] }), {
      timerEnvironment: clock.environment,
    });

    let peak = 0;
    for (let cycle = 0; cycle < 300; cycle += 1) {
      const subscription = runtime.subscribeNodes([interval, released]);
      await runtime.whenSettled();
      peak = Math.max(peak, clock.timerCount());
      subscription.unsubscribe();
      peak = Math.max(peak, clock.timerCount());
    }

    // One refresh timer per node with a policy, one release timer per node.
    expect(peak).toBeLessThanOrEqual(2);
    clock.advanceBy(10_000);
    expect(clock.timerCount()).toBe(0);
  });
});

describe("change listeners", () => {
  it("stops calling a listener once it is removed, however many were added and removed", () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx] }));
    const removed = vi.fn();
    const kept = vi.fn();

    runtime.onChange(kept);
    for (let count = 0; count < 5_000; count += 1) {
      const stop = runtime.onChange(removed);
      stop();
      stop();
    }
    runtime.setContext(ctx, 1);

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });
});

describe("browser timer environment listeners", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const watchPauseListeners = () => {
    const events = new Set(["visibilitychange", "online", "offline"]);
    const net = { value: 0 };
    const count =
      (delta: number) =>
      (type: string): void => {
        if (events.has(type)) net.value += delta;
      };
    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const windowAdd = vi.spyOn(globalThis, "addEventListener");
    const windowRemove = vi.spyOn(globalThis, "removeEventListener");
    documentAdd.mockImplementation(((type: string) => count(1)(type)) as never);
    windowAdd.mockImplementation(((type: string) => count(1)(type)) as never);
    documentRemove.mockImplementation(((type: string) => count(-1)(type)) as never);
    windowRemove.mockImplementation(((type: string) => count(-1)(type)) as never);
    return net;
  };

  const runtimeWithPolicy = (): GraphRuntime => {
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: async () => 1,
      refresh: refreshInterval({ intervalMs: 60_000 }),
    });
    return createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: createBrowserTimerEnvironment(),
    });
  };

  it("removes every listener a runtime added when it is disposed", () => {
    const net = watchPauseListeners();

    const runtimes = Array.from({ length: 25 }, runtimeWithPolicy);
    expect(net.value).toBe(25 * 3);
    for (const runtime of runtimes) {
      runtime.dispose();
      runtime.dispose();
    }

    expect(net.value).toBe(0);
  });

  it("leaves three listeners behind for a runtime that is never disposed", () => {
    // The reason owners must dispose: nothing else removes these.
    const net = watchPauseListeners();

    const runtime = runtimeWithPolicy();

    expect(net.value).toBe(3);
    runtime.dispose();
    expect(net.value).toBe(0);
  });
});

describe("diagnostics stay bounded", () => {
  it("retains no more events than its capacity, however much work the runtime does", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 50 });
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [ctx, node] }), {
      diagnostics: { sink: collector },
    });
    const subscription = runtime.subscribeNodes([node]);

    for (let change = 1; change <= 500; change += 1) {
      runtime.setContext(ctx, change);
      if (change % 50 === 0) await runtime.whenSettled();
    }
    await runtime.whenSettled();
    subscription.unsubscribe();

    const snapshot = runtime.createDiagnosticSnapshot();
    expect(collector.getEvents().length).toBeLessThanOrEqual(50);
    expect(snapshot.diagnostics.retainedEventCount).toBeLessThanOrEqual(50);
    expect(snapshot.diagnostics.droppedEventCount).toBeGreaterThan(1_000);
    expect(snapshot.metrics?.activeLoads).toBe(0);
  });
});

describe("Vue components", () => {
  it("release their subscriptions when they unmount, across many mounts", async () => {
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: async () => 1,
      refresh: refreshInterval({ intervalMs: 60_000 }),
    });
    const clock = fakeClock();
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const Reader = defineComponent({
      setup() {
        const { data } = useNode(node, { runtime });
        return () => h("span", String(data.value));
      },
    });

    for (let mount = 0; mount < 200; mount += 1) {
      const app = createApp(Reader);
      app.mount(document.createElement("div"));
      if (mount % 10 === 0) await runtime.whenSettled();
      app.unmount();
    }
    await runtime.whenSettled();

    expect(runtime.getSubscriptionState(node)).toMatchObject({ direct: 0, required: 0, total: 0 });
    expect(runtime.hasSubscribers(node)).toBe(false);
    expect(clock.timerCount()).toBe(0);
    runtime.dispose();
  });
});
