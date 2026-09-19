import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  staleAfter,
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
  const environment: TimerEnvironment = {
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

describe("stale-after refresh policy", () => {
  it("refreshes a subscribed successful node after its duration", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "stale-after",
      initialValue: 0,
      load: async () => ++requests,
      refresh: staleAfter({ durationMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(requests).toBe(1);
    expect(clock.nextDelay()).toBe(1_000);

    clock.advanceBy(999);
    expect(requests).toBe(1);
    clock.advanceBy(1);
    await waitForCondition(() => requests === 2, "policy refresh to start");
    await waitForCondition(
      () => runtime.getState(node).data === 2,
      "policy refresh to commit"
    );
    await waitForCondition(
      () => clock.nextDelay() === 1_000,
      "next stale-after timer after refresh settlement"
    );
    subscription.unsubscribe();
  });

  it("uses remaining freshness after resubscription", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "resubscribe",
      initialValue: 0,
      load: async () => ++requests,
      refresh: staleAfter({ durationMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const first = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    first.unsubscribe();
    expect(clock.timerCount()).toBe(0);

    clock.advanceBy(600);
    const second = runtime.subscribeNodes([node]);
    expect(clock.nextDelay()).toBe(400);
    clock.advanceBy(400);
    await waitForCondition(() => requests === 2, "resubscribed refresh");
    second.unsubscribe();
  });

  it("clears timers on final unsubscribe", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "unsubscribed-timer",
      initialValue: 0,
      load: async () => ++requests,
      refresh: staleAfter({ durationMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(100);
    await Promise.resolve();
    expect(requests).toBe(1);
  });

  it("aborts policy-only work after final unsubscribe", async () => {
    const clock = createTestEnvironment();
    const secondLoad = deferred<number>();
    let requests = 0;
    let policySignal: AbortSignal | undefined;
    const node = defineDataNode({
      key: "abort-policy-work",
      initialValue: 0,
      load: async ({ signal }) => {
        requests += 1;
        if (requests === 1) return 1;
        policySignal = signal;
        return secondLoad.promise;
      },
      refresh: staleAfter({ durationMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "policy load to start");
    subscription.unsubscribe();
    expect(policySignal?.aborted).toBe(true);

    secondLoad.resolve(2);
    await Promise.resolve();
    expect(runtime.getState(node).data).toBe(1);
  });

  it("preserves shared caller-owned refresh work after unsubscribe", async () => {
    const clock = createTestEnvironment();
    const secondLoad = deferred<number>();
    let requests = 0;
    let sharedSignal: AbortSignal | undefined;
    const node = defineDataNode({
      key: "shared-policy-work",
      initialValue: 0,
      load: async ({ signal }) => {
        requests += 1;
        if (requests === 1) return 1;
        sharedSignal = signal;
        return secondLoad.promise;
      },
      refresh: staleAfter({ durationMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "policy load to start");

    const manualRefresh = runtime.refresh([node]);
    subscription.unsubscribe();
    expect(sharedSignal?.aborted).toBe(false);

    secondLoad.resolve(2);
    await manualRefresh;
    expect(runtime.getState(node).data).toBe(2);
  });
});
