import {
  createGraph,
  createGraphRuntime,
  defineDataNode,
  pollUntil,
  type GraphRuntime,
  type NodeRuntimeState,
  type NodeSubscription,
  type RefreshPolicyEnvironment,
} from "../../core";

export type PollingProgressState =
  | "running"
  | "completed"
  | "failed";

export interface PollingProgress {
  readonly operationId: string;
  readonly percent: number;
  readonly state: PollingProgressState;
}

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
}

export interface PollingProgressHarness {
  readonly runtime: GraphRuntime;
  readonly getState: () => NodeRuntimeState<PollingProgress>;
  readonly getRequestCount: () => number;
  readonly getMaximumConcurrentRequests: () => number;
  readonly getActiveRequestCount: () => number;
  readonly getRetryAttempt: () => number;
  readonly getNextDelay: () => number | undefined;
  readonly getOutstandingTimerCount: () => number;
  readonly isPaused: () => boolean;
  readonly subscribe: () => NodeSubscription;
  readonly advanceBy: (durationMs: number) => void;
  readonly complete: () => void;
  readonly fail: () => void;
  readonly failNextRequest: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
}

export const createPollingProgressHarness = (): PollingProgressHarness => {
  let now = 0;
  let paused = false;
  let nextTimerId = 1;
  const timers = new Map<number, ScheduledTimer>();
  const pauseListeners = new Set<(paused: boolean) => void>();
  const state = {
    operationId: "operation-1",
    responseState: "running" as PollingProgressState,
    percent: 0,
    requestCount: 0,
    activeRequests: 0,
    maximumConcurrentRequests: 0,
    retryAttempt: 0,
    failNextRequest: false,
  };
  const pollingProgressNode = defineDataNode({
    key: "playground.pollingProgress",
    initialValue: {
      operationId: "operation-1",
      percent: 0,
      state: "running",
    } as PollingProgress,
    load: async () => {
      state.requestCount += 1;
      state.activeRequests += 1;
      state.maximumConcurrentRequests = Math.max(
        state.maximumConcurrentRequests,
        state.activeRequests
      );
      try {
        if (state.failNextRequest) {
          state.failNextRequest = false;
          state.retryAttempt += 1;
          throw new Error("Deterministic transient request failure.");
        }
        state.retryAttempt = 0;
        if (state.responseState === "running") {
          state.percent = Math.min(90, state.percent + 25);
        }
        return {
          operationId: state.operationId,
          percent: state.percent,
          state: state.responseState,
        } satisfies PollingProgress;
      } finally {
        state.activeRequests -= 1;
      }
    },
    refresh: pollUntil<PollingProgress>({
      intervalMs: 1_000,
      timeoutMs: 4_000,
      stopWhen: value => value.state === "completed",
      failWhen: value => value.state === "failed",
      retry: { strategy: "fixed", maxRetries: 2, delayMs: 500 },
    }),
  });
  const pollingProgressGraph = createGraph({ nodes: [pollingProgressNode] });

  const environment: RefreshPolicyEnvironment = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { id, dueAt: now + delayMs, callback });
      return id;
    },
    clearTimeout: handle => {
      if (typeof handle === "number") timers.delete(handle);
    },
    random: () => 0.5,
    isPaused: () => paused,
    onPauseChange: listener => {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
  };
  const runtime = createGraphRuntime(pollingProgressGraph, {
    refreshPolicyEnvironment: environment,
  });

  const advanceBy = (durationMs: number): void => {
    now += durationMs;
    while (true) {
      const timer = [...timers.values()]
        .filter(candidate => candidate.dueAt <= now)
        .sort((left, right) =>
          left.dueAt === right.dueAt
            ? left.id - right.id
            : left.dueAt - right.dueAt
        )[0];
      if (!timer) return;
      timers.delete(timer.id);
      timer.callback();
    }
  };

  const setPaused = (value: boolean): void => {
    if (paused === value) return;
    paused = value;
    for (const listener of [...pauseListeners]) listener(value);
  };

  return {
    runtime,
    getState: () => runtime.getState(pollingProgressNode),
    getRequestCount: () => state.requestCount,
    getMaximumConcurrentRequests: () => state.maximumConcurrentRequests,
    getActiveRequestCount: () => state.activeRequests,
    getRetryAttempt: () => state.retryAttempt,
    getNextDelay: () => {
      const next = [...timers.values()].sort(
        (left, right) => left.dueAt - right.dueAt
      )[0];
      return next ? next.dueAt - now : undefined;
    },
    getOutstandingTimerCount: () => timers.size,
    isPaused: () => paused,
    subscribe: () => runtime.subscribeNodes([pollingProgressNode]),
    advanceBy,
    complete: () => {
      state.responseState = "completed";
      state.percent = 100;
    },
    fail: () => {
      state.responseState = "failed";
    },
    failNextRequest: () => {
      state.failNextRequest = true;
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
  };
};
