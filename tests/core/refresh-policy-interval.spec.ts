import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  refreshInterval,
  type RefreshPolicyEnvironment,
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
  const environment: RefreshPolicyEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextId++;
      timers.set(id, { id, dueAt: now + delayMs, callback });
      return id;
    },
    clearTimeout: handle => {
      if (typeof handle === "number") timers.delete(handle);
    },
    random: () => 0.5,
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  };
  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    while (true) {
      const next = [...timers.values()]
        .filter(timer => timer.dueAt <= now)
        .sort((left, right) =>
          left.dueAt === right.dueAt
            ? left.id - right.id
            : left.dueAt - right.dueAt
        )[0];
      if (!next) return;
      timers.delete(next.id);
      next.callback();
    }
  };
  const nextDelay = (): number | undefined => {
    const next = [...timers.values()].sort(
      (left, right) => left.dueAt - right.dueAt
    )[0];
    return next ? next.dueAt - now : undefined;
  };
  return { environment, advanceBy, nextDelay, timerCount: () => timers.size };
};

describe("fixed interval refresh policy", () => {
  it("refreshes repeatedly after each successful attempt settles", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "interval",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      refreshPolicyEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(requests).toBe(1);
    expect(clock.nextDelay()).toBe(100);

    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "first interval refresh");
    await waitForCondition(
      () => runtime.getState(node).data === 2,
      "first interval result"
    );
    await waitForCondition(
      () => clock.nextDelay() === 100,
      "next interval after first refresh settlement"
    );

    clock.advanceBy(100);
    await waitForCondition(() => requests === 3, "second interval refresh");
    await waitForCondition(
      () => runtime.getState(node).data === 3,
      "second interval result"
    );
    await waitForCondition(
      () => clock.nextDelay() === 100,
      "next interval after second refresh settlement"
    );
    subscription.unsubscribe();
  });

  it("does not overlap interval requests and waits a full interval after settlement", async () => {
    const clock = createTestEnvironment();
    const secondLoad = deferred<number>();
    let requests = 0;
    let active = 0;
    let maximumActive = 0;
    const node = defineDataNode({
      key: "slow-interval",
      initialValue: 0,
      load: async () => {
        requests += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        try {
          return requests === 1 ? 1 : await secondLoad.promise;
        } finally {
          active -= 1;
        }
      },
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      refreshPolicyEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "slow interval refresh");
    expect(clock.timerCount()).toBe(0);

    clock.advanceBy(1_000);
    await Promise.resolve();
    expect(requests).toBe(2);
    expect(maximumActive).toBe(1);

    secondLoad.resolve(2);
    await waitForCondition(
      () => runtime.getState(node).data === 2,
      "slow refresh result"
    );
    await waitForCondition(
      () => clock.nextDelay() === 100,
      "interval after slow refresh settlement"
    );
    subscription.unsubscribe();
  });

  it("starts a clean interval after resubscription", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "interval-resubscribe",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      refreshPolicyEnvironment: clock.environment,
    });

    const first = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(60);
    first.unsubscribe();
    expect(clock.timerCount()).toBe(0);

    clock.advanceBy(1_000);
    const second = runtime.subscribeNodes([node]);
    expect(clock.nextDelay()).toBe(100);
    clock.advanceBy(99);
    expect(requests).toBe(1);
    clock.advanceBy(1);
    await waitForCondition(() => requests === 2, "resubscribed interval refresh");
    second.unsubscribe();
  });

  it("restarts the interval after a context invalidation reload settles", async () => {
    const clock = createTestEnvironment();
    const context = defineContextNode({ key: "interval-context", initialValue: 1 });
    let requests = 0;
    const node = defineDataNode({
      key: "context-interval",
      dependencies: [context] as const,
      initialValue: 0,
      load: async ({ get }) => {
        requests += 1;
        return get(context) * 10 + requests;
      },
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [context, node] }), {
      refreshPolicyEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(60);
    runtime.setContext(context, 2);
    await runtime.whenSettled();

    expect(requests).toBe(2);
    expect(clock.nextDelay()).toBe(100);
    clock.advanceBy(99);
    expect(requests).toBe(2);
    clock.advanceBy(1);
    await waitForCondition(() => requests === 3, "post-context interval refresh");
    subscription.unsubscribe();
  });

  it("keeps interval sessions independent across runtimes", async () => {
    const firstClock = createTestEnvironment();
    const secondClock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "independent-interval",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const graph = createGraph({ nodes: [node] });
    const firstRuntime = createGraphRuntime(graph, {
      refreshPolicyEnvironment: firstClock.environment,
    });
    const secondRuntime = createGraphRuntime(graph, {
      refreshPolicyEnvironment: secondClock.environment,
    });

    const first = firstRuntime.subscribeNodes([node]);
    const second = secondRuntime.subscribeNodes([node]);
    await Promise.all([firstRuntime.whenSettled(), secondRuntime.whenSettled()]);
    expect(requests).toBe(2);

    firstClock.advanceBy(100);
    await waitForCondition(() => requests === 3, "first runtime interval refresh");
    expect(secondClock.timerCount()).toBe(1);

    secondClock.advanceBy(100);
    await waitForCondition(() => requests === 4, "second runtime interval refresh");
    first.unsubscribe();
    second.unsubscribe();
  });
});
