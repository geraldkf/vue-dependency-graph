import { describe, expect, it } from "vitest";
import {
  GraphRefreshRetryExhaustedError,
  createGraph,
  createGraphRuntime,
  defineDataNode,
  pollUntil,
  refreshInterval,
  type TimerEnvironment,
} from "../../src/core";
import { waitForCondition } from "./test-helpers";

interface Timer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

const createEnvironment = (randomValues: readonly number[] = [0.5]) => {
  let now = 0;
  let paused = false;
  let nextId = 1;
  let randomIndex = 0;
  const timers = new Map<number, Timer>();
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
    random: () => {
      const value = randomValues[randomIndex] ?? randomValues.at(-1) ?? 0.5;
      randomIndex += 1;
      return value;
    },
    isPaused: () => paused,
    onPauseChange: (listener) => {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
  };
  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    while (true) {
      const next = [...timers.values()]
        .filter((timer) => timer.dueAt <= now)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!next) return;
      timers.delete(next.id);
      next.callback();
    }
  };
  const setPaused = (value: boolean): void => {
    paused = value;
    for (const listener of [...pauseListeners]) listener(value);
  };
  const nextDelay = (): number | undefined => {
    const next = [...timers.values()].sort((left, right) => left.dueAt - right.dueAt)[0];
    return next ? next.dueAt - now : undefined;
  };
  return {
    environment,
    advanceBy,
    setPaused,
    nextDelay,
    timerCount: () => timers.size,
    randomCalls: () => randomIndex,
  };
};

describe("refresh policy retry and pause", () => {
  it("retries interval failures with a fixed delay and resets after success", async () => {
    const clock = createEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "fixed-retry",
      initialValue: 0,
      load: async () => {
        requests += 1;
        if (requests === 2) throw new Error("transient");
        return requests;
      },
      refresh: refreshInterval({
        intervalMs: 100,
        retry: { strategy: "fixed", maxRetries: 2, delayMs: 25 },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => clock.nextDelay() === 25, "fixed retry timer");
    clock.advanceBy(25);
    await waitForCondition(() => runtime.getState(node).data === 3, "retry success");
    await waitForCondition(() => clock.nextDelay() === 100, "normal interval reset");
    expect(runtime.getState(node).error).toBeNull();
    subscription.unsubscribe();
  });

  it("uses capped exponential backoff with deterministic jitter", async () => {
    const clock = createEnvironment([1, 0]);
    let requests = 0;
    const node = defineDataNode({
      key: "exponential-retry",
      initialValue: 0,
      load: async () => {
        requests += 1;
        if (requests > 1 && requests < 4) throw new Error(`failure-${requests}`);
        return requests;
      },
      refresh: refreshInterval({
        intervalMs: 10,
        retry: {
          strategy: "exponential",
          maxRetries: 3,
          initialDelayMs: 100,
          multiplier: 3,
          maxDelayMs: 200,
          jitterRatio: 0.25,
        },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(10);
    await waitForCondition(() => clock.nextDelay() === 125, "first jittered retry");
    clock.advanceBy(125);
    await waitForCondition(() => clock.nextDelay() === 150, "capped second retry");
    clock.advanceBy(150);
    await waitForCondition(() => runtime.getState(node).data === 4, "exponential recovery");
    expect(clock.randomCalls()).toBe(2);
    subscription.unsubscribe();
  });

  it("does not consult randomness when jitter is zero", async () => {
    const clock = createEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "zero-jitter",
      initialValue: 0,
      load: async () => {
        requests += 1;
        if (requests === 2) throw new Error("failure");
        return requests;
      },
      refresh: refreshInterval({
        intervalMs: 10,
        retry: { strategy: "fixed", maxRetries: 1, delayMs: 20 },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(10);
    await waitForCondition(() => clock.nextDelay() === 20, "zero-jitter retry");
    expect(clock.randomCalls()).toBe(0);
    subscription.unsubscribe();
  });

  it("exposes retry exhaustion while retaining successful data", async () => {
    const clock = createEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "retry-exhaustion",
      initialValue: 0,
      load: async () => {
        requests += 1;
        if (requests > 1) throw new Error("still failing");
        return 1;
      },
      refresh: refreshInterval({
        intervalMs: 10,
        retry: { strategy: "fixed", maxRetries: 1, delayMs: 20 },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(10);
    await waitForCondition(() => clock.nextDelay() === 20, "exhaustion retry");
    clock.advanceBy(20);
    await waitForCondition(
      () => runtime.getState(node).error instanceof GraphRefreshRetryExhaustedError,
      "retry exhaustion",
    );

    const state = runtime.getState(node);
    expect(state.data).toBe(1);
    expect(state.hasSuccessfulValue).toBe(true);
    expect(state.freshness).toBe("stale");
    expect((state.error as GraphRefreshRetryExhaustedError).attempts).toBe(2);
    expect(clock.timerCount()).toBe(0);
    subscription.unsubscribe();
  });

  it("pauses a pending interval and resumes its remaining delay once", async () => {
    const clock = createEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "pause-interval",
      initialValue: 0,
      load: async () => ++requests,
      refresh: refreshInterval({ intervalMs: 100 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(40);
    clock.setPaused(true);
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(1_000);
    expect(requests).toBe(1);

    clock.setPaused(false);
    clock.setPaused(false);
    expect(clock.nextDelay()).toBe(60);
    clock.advanceBy(59);
    expect(requests).toBe(1);
    clock.advanceBy(1);
    await waitForCondition(() => requests === 2, "single resumed refresh");
    expect(requests).toBe(2);
    subscription.unsubscribe();
  });

  it("excludes paused duration from polling timeout", async () => {
    const clock = createEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "pause-timeout",
      initialValue: 0,
      load: async () => ++requests,
      refresh: pollUntil<number>({
        intervalMs: 50,
        timeoutMs: 100,
        stopWhen: () => false,
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(25);
    clock.setPaused(true);
    clock.advanceBy(1_000);
    clock.setPaused(false);
    expect(clock.nextDelay()).toBe(25);

    clock.advanceBy(25);
    await waitForCondition(() => requests === 2, "resumed polling request");
    expect(runtime.getState(node).error).toBeNull();
    await waitForCondition(() => clock.nextDelay() === 50, "next active poll");
    clock.advanceBy(50);
    await waitForCondition(() => requests === 3, "timeout polling request");
    await waitForCondition(() => runtime.getState(node).error !== null, "active timeout");
    subscription.unsubscribe();
  });
});
