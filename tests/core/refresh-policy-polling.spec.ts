import { describe, expect, it } from "vitest";
import {
  GraphPollingConditionError,
  GraphPollingTimeoutError,
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  pollUntil,
  type TimerEnvironment,
} from "../../src/core";
import { deferred, waitForCondition } from "./test-helpers";

interface Progress {
  readonly state: "running" | "completed" | "failed";
  readonly request: number;
}

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
    clearTimeout: (handle) => {
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
        .filter((timer) => timer.dueAt <= now)
        .sort((left, right) =>
          left.dueAt === right.dueAt ? left.id - right.id : left.dueAt - right.dueAt,
        )[0];
      if (!next) return;
      timers.delete(next.id);
      next.callback();
    }
  };
  return { environment, advanceBy, timerCount: () => timers.size };
};

describe("poll-until refresh policy", () => {
  it("progresses until completion and then stops", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "poll-completion",
      initialValue: { state: "running", request: 0 } as Progress,
      load: async () => {
        requests += 1;
        return {
          state: requests === 3 ? "completed" : "running",
          request: requests,
        } as Progress;
      },
      refresh: pollUntil<Progress>({
        intervalMs: 100,
        timeoutMs: 1_000,
        stopWhen: (value) => value.state === "completed",
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(clock.timerCount()).toBe(1);

    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "first polling request");
    await waitForCondition(() => clock.timerCount() === 1, "second poll timer");
    clock.advanceBy(100);
    await waitForCondition(() => requests === 3, "completion request");
    await waitForCondition(
      () => runtime.getState(node).data.state === "completed",
      "completion result",
    );

    expect(runtime.getState(node).status).toBe("success");
    expect(runtime.getState(node).error).toBeNull();
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(1_000);
    await Promise.resolve();
    expect(requests).toBe(3);
    subscription.unsubscribe();
  });

  it("stops on business failure while retaining the latest value", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "poll-failure",
      initialValue: { state: "running", request: 0 } as Progress,
      load: async () => {
        requests += 1;
        return {
          state: requests === 2 ? "failed" : "running",
          request: requests,
        } as Progress;
      },
      refresh: pollUntil<Progress>({
        intervalMs: 100,
        timeoutMs: 1_000,
        stopWhen: (value) => value.state === "completed",
        failWhen: (value) => value.state === "failed",
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => runtime.getState(node).error !== null, "business failure");

    const state = runtime.getState(node);
    expect(state.data).toEqual({ state: "failed", request: 2 });
    expect(state.error).toBeInstanceOf(GraphPollingConditionError);
    expect(state.status).toBe("error");
    expect(state.freshness).toBe("stale");
    expect(state.hasSuccessfulValue).toBe(true);
    expect(clock.timerCount()).toBe(0);
    subscription.unsubscribe();
  });

  it("checks failure before completion", async () => {
    const clock = createTestEnvironment();
    const node = defineDataNode({
      key: "poll-condition-order",
      initialValue: 0,
      load: async () => 1,
      refresh: pollUntil<number>({
        intervalMs: 100,
        timeoutMs: 1_000,
        failWhen: () => true,
        stopWhen: () => true,
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(runtime.getState(node).error).toBeInstanceOf(GraphPollingConditionError);
    expect(clock.timerCount()).toBe(0);
  });

  it("stops on timeout after preserving the latest progress", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "poll-timeout",
      initialValue: 0,
      load: async () => ++requests,
      refresh: pollUntil<number>({
        intervalMs: 100,
        timeoutMs: 200,
        stopWhen: () => false,
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => clock.timerCount() === 1, "second timeout poll");
    clock.advanceBy(100);
    await waitForCondition(() => runtime.getState(node).error !== null, "polling timeout");

    const state = runtime.getState(node);
    expect(state.data).toBe(3);
    expect(state.error).toBeInstanceOf(GraphPollingTimeoutError);
    expect((state.error as GraphPollingTimeoutError).timeoutMs).toBe(200);
    expect(state.hasSuccessfulValue).toBe(true);
    expect(clock.timerCount()).toBe(0);
    subscription.unsubscribe();
  });

  it("turns a predicate exception into a terminal polling error", async () => {
    const clock = createTestEnvironment();
    const cause = new Error("predicate failed");
    const node = defineDataNode({
      key: "poll-predicate-error",
      initialValue: 0,
      load: async () => 1,
      refresh: pollUntil<number>({
        intervalMs: 100,
        timeoutMs: 1_000,
        stopWhen: () => {
          throw cause;
        },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    runtime.subscribeNodes([node]);
    await runtime.whenSettled();

    const error = runtime.getState(node).error;
    expect(error).toBeInstanceOf(GraphPollingConditionError);
    expect(error?.cause).toBe(cause);
    expect(clock.timerCount()).toBe(0);
  });

  it("starts a new polling session after dependency invalidation", async () => {
    const clock = createTestEnvironment();
    const jobId = defineContextNode({ key: "poll-job", initialValue: 1 });
    const obsoleteLoad = deferred<Progress>();
    let requests = 0;
    const node = defineDataNode({
      key: "generation-poll",
      dependencies: [jobId] as const,
      initialValue: { state: "running", request: 0 } as Progress,
      load: async ({ get }) => {
        requests += 1;
        const currentJob = get(jobId);
        if (requests === 2) return obsoleteLoad.promise;
        return {
          state: currentJob === 2 ? "completed" : "running",
          request: requests,
        } as Progress;
      },
      refresh: pollUntil<Progress>({
        intervalMs: 100,
        timeoutMs: 1_000,
        stopWhen: (value) => value.state === "completed",
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [jobId, node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    clock.advanceBy(100);
    await waitForCondition(() => requests === 2, "obsolete poll to start");

    runtime.setContext(jobId, 2);
    await runtime.whenSettled();
    expect(runtime.getState(node).data).toEqual({
      state: "completed",
      request: 3,
    });

    obsoleteLoad.resolve({ state: "failed", request: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getState(node).data).toEqual({
      state: "completed",
      request: 3,
    });
    expect(runtime.getState(node).error).toBeNull();
    expect(clock.timerCount()).toBe(0);
    subscription.unsubscribe();
  });

  it("stops polling on final unsubscribe", async () => {
    const clock = createTestEnvironment();
    let requests = 0;
    const node = defineDataNode({
      key: "poll-unsubscribe",
      initialValue: 0,
      load: async () => ++requests,
      refresh: pollUntil<number>({
        intervalMs: 100,
        timeoutMs: 1_000,
        stopWhen: () => false,
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });

    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    subscription.unsubscribe();
    expect(clock.timerCount()).toBe(0);
    clock.advanceBy(1_000);
    await Promise.resolve();
    expect(requests).toBe(1);
  });
});
