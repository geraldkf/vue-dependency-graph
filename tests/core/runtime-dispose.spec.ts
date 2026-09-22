import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  refreshInterval,
  releaseAfter,
  type TimerEnvironment,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

const createTestEnvironment = () => {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, ScheduledTimer>();
  const pauseListeners = new Set<(paused: boolean) => void>();
  const environment: TimerEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { id, dueAt: now + delayMs, callback });
      return id;
    },
    clearTimeout: (handle) => {
      if (typeof handle === "number") timers.delete(handle);
    },
    random: () => 0.5,
    isPaused: () => false,
    onPauseChange: (listener) => {
      pauseListeners.add(listener);
      return () => {
        pauseListeners.delete(listener);
      };
    },
  };
  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    while (true) {
      const next = [...timers.values()]
        .filter((timer) => timer.dueAt <= now)
        .sort((left, right) =>
          left.dueAt === right.dueAt ? left.id - right.id : left.dueAt - right.dueAt,
        )[0];
      if (!next) return;
      timers.delete(next.id);
      next.callback();
    }
  };
  return {
    environment,
    advanceBy,
    timerCount: () => timers.size,
    pauseListenerCount: () => pauseListeners.size,
    emitPause: (paused: boolean) => {
      for (const listener of [...pauseListeners]) listener(paused);
    },
  };
};

describe("runtime.dispose", () => {
  it("is idempotent and safe on a runtime without policies", () => {
    const node = defineDataNode({
      key: "plain",
      initialValue: 0,
      load: async () => 1,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));

    expect(() => {
      runtime.dispose();
      runtime.dispose();
    }).not.toThrow();
  });

  it("clears pending refresh timers and stops further polling", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "interval",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(requests).toBe(1);
    expect(clock.timerCount()).toBe(1);

    runtime.dispose();

    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(10_000);
    await Promise.resolve();
    expect(requests).toBe(1);
    subscription.unsubscribe();
  });

  it("clears pending release timers so idle values are kept", async () => {
    const clock = createTestEnvironment();
    const node = defineDataNode({
      key: "release",
      initialValue: 0,
      release: releaseAfter({ durationMs: 1_000 }),
      load: async () => 42,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();
    expect(clock.timerCount()).toBe(1);

    runtime.dispose();

    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(10_000);
    expect(runtime.getState(node)).toMatchObject({
      data: 42,
      hasSuccessfulValue: true,
    });
  });

  it("does not arm new timers after disposal", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const polled = defineDataNode({
      key: "polled",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const releasable = defineDataNode({
      key: "releasable",
      initialValue: 0,
      release: releaseAfter({ durationMs: 1_000 }),
      load: async () => 7,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [polled, releasable] }), {
      timerEnvironment: clock.environment,
    });
    runtime.dispose();

    const subscription = runtime.subscribeNodes([polled, releasable]);
    await runtime.whenSettled();
    subscription.unsubscribe();

    // Loading itself still works; only the background policies are inert.
    expect(runtime.getState(polled).data).toBe(1);
    expect(runtime.getState(releasable).data).toBe(7);
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(10_000);
    expect(requests).toBe(1);
    expect(runtime.getState(releasable).hasSuccessfulValue).toBe(true);
  });

  it("detaches from the timer environment's pause signal", () => {
    const clock = createTestEnvironment();
    const node = defineDataNode({
      key: "pausable",
      initialValue: 0,
      load: async () => 1,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    expect(clock.pauseListenerCount()).toBe(1);

    runtime.dispose();

    expect(clock.pauseListenerCount()).toBe(0);
    expect(() => clock.emitPause(true)).not.toThrow();
    runtime.dispose();
    expect(clock.pauseListenerCount()).toBe(0);
  });

  it("does not schedule follow-up work when a policy refresh settles after disposal", async () => {
    const clock = createTestEnvironment();
    const refreshLoad = deferred<number>();
    let requests = 0;
    const node = defineDataNode({
      key: "in-flight",
      initialValue: 0,
      load: () => {
        requests += 1;
        return requests === 1 ? Promise.resolve(1) : refreshLoad.promise;
      },
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();

    clock.advanceBy(1_000);
    await waitForCondition(() => requests === 2, "policy refresh to start");

    runtime.dispose();
    refreshLoad.resolve(2);
    await waitForCondition(() => runtime.getState(node).data === 2, "in-flight refresh to commit");
    // Let the policy refresh's own promise chain (then/catch/finally) drain.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(10_000);
    expect(requests).toBe(2);
    subscription.unsubscribe();
  });

  it("keeps diagnostic snapshots available after disposal", async () => {
    const clock = createTestEnvironment();
    const node = defineDataNode({
      key: "snapshot",
      initialValue: 0,
      load: async () => 1,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();

    runtime.dispose();

    const snapshot = runtime.createDiagnosticSnapshot();
    expect(snapshot.nodes.map((entry) => entry.key)).toContain("snapshot");
    subscription.unsubscribe();
  });
});
