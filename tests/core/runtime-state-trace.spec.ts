import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  pollUntil,
  refreshInterval,
  type TimerEnvironment,
} from "../../src/core";
import { createStateTracer } from "./state-trace-helpers";
import { deferred, waitForCondition } from "./test-helpers";

/**
 * Golden traces of node *state* - every change to `status`, `freshness`,
 * `generation`, `hasSuccessfulValue`, `error` and `data` that a listener can
 * observe - for scenarios that reach every state transition the runtime has:
 * begin/complete/fail execution, invalidation, context and mutation writes,
 * rollback, release, and policy failure.
 *
 * They exist so state transitions can be refactored without changing what any
 * node's state does. Diagnostics (see runtime-golden-trace.spec.ts) cannot
 * see these fields. Every notification is also checked against the state
 * invariants in `state-trace-helpers.ts`, and any violation fails the test.
 */

const createClock = () => {
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
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= now)
        .sort(([leftId, left], [rightId, right]) =>
          left.dueAt === right.dueAt ? leftId - rightId : left.dueAt - right.dueAt,
        )[0];
      if (!next) return;
      timers.delete(next[0]);
      next[1].callback();
    }
  };
  return { environment, advanceBy, timerCount: () => timers.size };
};

const abortError = (): Error => new DOMException("aborted", "AbortError");

/** A loader that honours its signal: rejects with an AbortError when aborted. */
const cooperativeLoad = (signal: AbortSignal): Promise<number> =>
  new Promise<number>((_resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()));
  });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const expectTrace = (tracer: ReturnType<typeof createStateTracer>): void => {
  // No listener may ever observe a state the invariants forbid...
  expect(tracer.violations).toEqual([]);
  // ...and the states a node moves through are pinned step by step.
  expect({ trace: tracer.lines, violations: tracer.violations }).toMatchSnapshot();
};

describe("runtime state golden traces", () => {
  it("load, context invalidation, event invalidation, transaction and abort", async () => {
    const changed = defineEvent<void>("changed");
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [ctx] as const,
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx) * 2,
    });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [data] as const,
      derive: ({ get }) => get(data) + 1,
    });
    const slowLoad = deferred<number>();
    const slow = defineDataNode({
      key: "slow",
      initialValue: 0,
      load: () => slowLoad.promise,
    });
    const nodes = [data, derived, slow, ctx];
    const runtime = createGraphRuntime(createGraph({ nodes }));
    const tracer = createStateTracer(runtime, nodes);

    tracer.setStep("subscribe");
    const subscription = runtime.subscribeNodes([derived]);
    await runtime.whenSettled();

    tracer.setStep("setContext");
    runtime.setContext(ctx, 2);
    await runtime.whenSettled();

    tracer.setStep("publish");
    runtime.publish(changed, undefined);
    await runtime.whenSettled();

    tracer.setStep("transaction");
    await runtime.transaction((transaction) => {
      transaction.setContext(ctx, 3);
      transaction.publish(changed, undefined);
    });
    await runtime.whenSettled();
    subscription.unsubscribe();

    tracer.setStep("abort on unsubscribe");
    const slowSubscription = runtime.subscribeNodes([slow]);
    await waitForCondition(() => runtime.getState(slow).status === "loading", "slow load to start");
    slowSubscription.unsubscribe();
    slowLoad.resolve(1);
    await runtime.whenSettled();

    expectTrace(tracer);
  });

  it("failed load, then recovery", async () => {
    let fail = true;
    const flaky = defineDataNode({
      key: "flaky",
      initialValue: 0,
      load: async () => {
        if (fail) throw new Error("load failed");
        return 5;
      },
    });
    const dependent = defineDerivedNode({
      key: "dependent",
      dependencies: [flaky] as const,
      derive: ({ get }) => get(flaky) + 1,
    });
    const nodes = [flaky, dependent];
    const runtime = createGraphRuntime(createGraph({ nodes }));
    const tracer = createStateTracer(runtime, nodes);

    tracer.setStep("failing load");
    await runtime.execute([dependent]).catch(() => undefined);

    tracer.setStep("recovering load");
    fail = false;
    await runtime.execute([dependent]);

    expectTrace(tracer);
  });

  it("failed refresh, refresh again, and invalidation while in error", async () => {
    let fail = false;
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => {
        if (fail) throw new Error("refresh failed");
        return get(ctx);
      },
    });
    const nodes = [node, ctx];
    const runtime = createGraphRuntime(createGraph({ nodes }));
    const tracer = createStateTracer(runtime, nodes);

    tracer.setStep("initial load");
    await runtime.execute([node]);

    tracer.setStep("failing refresh");
    fail = true;
    await runtime.refresh([node]).catch(() => undefined);

    tracer.setStep("refresh again after failure");
    fail = false;
    await runtime.refresh([node]);

    tracer.setStep("failing refresh (second)");
    fail = true;
    await runtime.refresh([node]).catch(() => undefined);

    tracer.setStep("context invalidation while in error");
    runtime.setContext(ctx, 2);

    expectTrace(tracer);
  });

  it("mutations: optimistic update, success effects, preserved-stale write, unknown and rejected failures", async () => {
    const parent = defineDataNode({ key: "parent", initialValue: 0, load: async () => 1 });
    const child = defineDataNode({
      key: "child",
      dependencies: [parent] as const,
      initialValue: 0,
      load: async ({ get }) => get(parent) * 10,
    });
    const counter = defineDataNode({ key: "counter", initialValue: 0, load: async () => 100 });
    const guarded = defineDataNode({ key: "guarded", initialValue: 0, load: async () => 50 });
    const nodes = [parent, child, counter, guarded];
    const runtime = createGraphRuntime(createGraph({ nodes }));
    const tracer = createStateTracer(runtime, nodes);
    await runtime.execute([child, counter, guarded]);

    const succeed = defineMutation({ key: "succeed", execute: async () => "ok" });
    const fail = defineMutation({
      key: "fail",
      execute: async () => {
        throw new Error("remote failed");
      },
    });

    tracer.setStep("optimistic + success update");
    await runtime.mutate(succeed, undefined, {
      optimistic: (effects) => effects.update(counter, (current) => current + 1),
      onSuccess: (effects) => effects.update(counter, (current) => current + 10),
    });

    tracer.setStep("success: update descendant and invalidate its ancestor");
    await runtime.mutate(succeed, undefined, {
      onSuccess: (effects) => {
        effects.update(child, (current) => current + 1);
        effects.invalidate([parent]);
      },
    });

    tracer.setStep("unknown failure keeps the optimistic value and marks it stale");
    await runtime
      .mutate(fail, undefined, {
        optimistic: (effects) => effects.update(counter, (current) => current + 1000),
      })
      .catch(() => undefined);

    tracer.setStep("rejected failure rolls the optimistic update back");
    await runtime
      .mutate(fail, undefined, {
        optimistic: (effects) => effects.update(guarded, (current) => current + 7),
        classifyFailure: () => "rejected",
      })
      .catch(() => undefined);

    expectTrace(tracer);
  });

  it("release policy releases an idle value", async () => {
    const clock = createClock();
    const node = defineDataNode({
      key: "released",
      initialValue: -1,
      release: 500,
      load: async () => 9,
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      timerEnvironment: clock.environment,
    });
    const tracer = createStateTracer(runtime, [node]);

    tracer.setStep("load");
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    tracer.setStep("unsubscribe and release");
    subscription.unsubscribe();
    clock.advanceBy(500);

    expectTrace(tracer);
  });

  it("refresh policy failure transition: retries exhausted", async () => {
    const clock = createClock();
    let fails = false;
    let requests = 0;
    const interval = defineDataNode({
      key: "interval",
      initialValue: 0,
      load: async () => {
        requests += 1;
        if (fails) throw new Error("interval failed");
        return 1;
      },
      refresh: refreshInterval({
        intervalMs: 1_000,
        retry: { strategy: "fixed", maxRetries: 1, delayMs: 100 },
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [interval] }), {
      timerEnvironment: clock.environment,
    });
    const tracer = createStateTracer(runtime, [interval]);

    tracer.setStep("initial load");
    const subscription = runtime.subscribeNodes([interval]);
    await runtime.whenSettled();

    tracer.setStep("policy attempt fails");
    fails = true;
    clock.advanceBy(1_000);
    await waitForCondition(() => requests === 2, "first policy attempt");
    await waitForCondition(() => clock.timerCount() === 1, "retry timer");

    tracer.setStep("retry fails and retries are exhausted");
    clock.advanceBy(100);
    await waitForCondition(() => requests === 3, "retry attempt");
    await waitForCondition(
      () => runtime.getState(interval).error?.name === "GraphRefreshRetryExhaustedError",
      "retry exhaustion",
    );
    subscription.unsubscribe();

    expectTrace(tracer);
  });

  it("refresh policy failure transition: polling timeout", async () => {
    const clock = createClock();
    let requests = 0;
    const poll = defineDataNode({
      key: "poll",
      initialValue: 0,
      load: async () => ++requests,
      refresh: pollUntil<number>({
        intervalMs: 500,
        timeoutMs: 1_200,
        stopWhen: () => false,
      }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [poll] }), {
      timerEnvironment: clock.environment,
    });
    const tracer = createStateTracer(runtime, [poll]);

    tracer.setStep("initial load");
    const subscription = runtime.subscribeNodes([poll]);
    await runtime.whenSettled();

    tracer.setStep("polling until timeout");
    for (let expected = 2; expected <= 3; expected += 1) {
      await waitForCondition(() => clock.timerCount() === 1, "poll timer");
      clock.advanceBy(500);
      await waitForCondition(() => requests === expected, `poll attempt ${expected}`);
    }
    await waitForCondition(() => clock.timerCount() === 1, "final poll timer");
    clock.advanceBy(500);
    await waitForCondition(() => runtime.getState(poll).status === "error", "polling timeout");
    subscription.unsubscribe();

    expectTrace(tracer);
  });

  it("a refresh drops the previous failure as soon as it supersedes the node", async () => {
    let fail = false;
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: async () => {
        if (fail) throw new Error("boom");
        return 1;
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    await runtime.execute([node]);
    fail = true;
    await runtime.refresh([node]).catch(() => undefined);
    expect(runtime.getState(node)).toMatchObject({ status: "error" });

    const firstNotification: unknown[] = [];
    const stop = runtime.onChange(() => {
      if (firstNotification.length === 0) {
        firstNotification.push(runtime.getState(node));
      }
    });
    fail = false;
    await runtime.refresh([node]);
    stop();

    // Marking the node stale for the refresh is the same transition as any
    // other invalidation: the value stays, the old error does not.
    expect(firstNotification[0]).toMatchObject({
      status: "success",
      freshness: "stale",
      error: null,
      hasSuccessfulValue: true,
    });
  });

  it("aborted attempts return the node to not-running unless something superseded them", async () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    // never loaded; loader honours the signal
    const cooperative = defineDataNode({
      key: "cooperative",
      initialValue: 0,
      load: ({ signal }) => cooperativeLoad(signal),
    });
    // never loaded; loader ignores the signal and resolves after the abort
    const ignoringLoad = deferred<number>();
    const ignoring = defineDataNode({
      key: "ignoring",
      initialValue: 0,
      load: () => ignoringLoad.promise,
    });
    // has a value; aborted while refreshing
    const refreshingLoad = deferred<number>();
    let refreshingLoads = 0;
    const refreshing = defineDataNode({
      key: "refreshing",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => {
        refreshingLoads += 1;
        if (refreshingLoads === 1) return get(ctx);
        return refreshingLoad.promise;
      },
    });
    // superseded by an invalidation while running
    const supersededLoad = deferred<number>();
    const superseded = defineDataNode({
      key: "superseded",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: () => supersededLoad.promise,
    });
    // has a value; a mutation writes to it while a refresh is running
    const writtenRefreshLoad = deferred<number>();
    let writtenLoads = 0;
    const written = defineDataNode({
      key: "written",
      initialValue: 0,
      load: async () => {
        writtenLoads += 1;
        if (writtenLoads === 1) return 1;
        return writtenRefreshLoad.promise;
      },
    });
    const save = defineMutation({ key: "save", execute: async () => "ok" });
    const nodes = [cooperative, ignoring, refreshing, superseded, written, ctx];
    const runtime = createGraphRuntime(createGraph({ nodes }));
    const tracer = createStateTracer(runtime, nodes);

    tracer.setStep("abort while loading (cooperative loader)");
    const cooperativeSubscription = runtime.subscribeNodes([cooperative]);
    await waitForCondition(
      () => runtime.getState(cooperative).status === "loading",
      "cooperative load to start",
    );
    await flush();
    cooperativeSubscription.unsubscribe();
    await runtime.whenSettled();

    tracer.setStep("abort while loading (loader ignores the signal)");
    const ignoringSubscription = runtime.subscribeNodes([ignoring]);
    await waitForCondition(
      () => runtime.getState(ignoring).status === "loading",
      "ignoring load to start",
    );
    await flush();
    ignoringSubscription.unsubscribe();
    ignoringLoad.resolve(1);
    await runtime.whenSettled();

    tracer.setStep("abort while refreshing");
    const refreshingSubscription = runtime.subscribeNodes([refreshing]);
    await runtime.whenSettled();
    runtime.setContext(ctx, 2);
    await waitForCondition(
      () => runtime.getState(refreshing).status === "refreshing",
      "refresh to start",
    );
    await flush();
    refreshingSubscription.unsubscribe();
    refreshingLoad.resolve(99);
    await runtime.whenSettled();

    tracer.setStep("superseded by invalidation while running");
    const supersededExecution = runtime.execute([superseded]).catch(() => undefined);
    await waitForCondition(
      () => runtime.getState(superseded).status === "loading",
      "superseded load to start",
    );
    await flush();
    runtime.setContext(ctx, 3);
    supersededLoad.resolve(5);
    await supersededExecution;
    await flush();

    tracer.setStep("superseded by a mutation write while refreshing");
    await runtime.execute([written]);
    const writtenRefresh = runtime.refresh([written]).catch(() => undefined);
    await waitForCondition(
      () => runtime.getState(written).status === "refreshing",
      "written refresh to start",
    );
    await flush();
    await runtime.mutate(save, undefined, {
      onSuccess: (effects) => effects.update(written, () => 7),
    });
    writtenRefreshLoad.resolve(99);
    await writtenRefresh;
    await flush();

    expectTrace(tracer);
  });

  it("an attempt cancelled while queued returns the node to not-running", async () => {
    const firstLoad = deferred<number>();
    const first = defineDataNode({
      key: "first",
      initialValue: 0,
      load: () => firstLoad.promise,
    });
    const queued = defineDataNode({
      key: "queued",
      initialValue: 0,
      load: async () => 2,
    });
    const nodes = [first, queued];
    const runtime = createGraphRuntime(createGraph({ nodes }), {
      maxConcurrentLoads: 1,
    });
    const tracer = createStateTracer(runtime, nodes);

    tracer.setStep("one running, one queued");
    const subscription = runtime.subscribeNodes([first, queued]);
    await waitForCondition(
      () =>
        runtime.getState(first).status === "loading" &&
        runtime.getState(queued).status === "loading",
      "both attempts to begin",
    );
    await flush();

    tracer.setStep("unsubscribe cancels both");
    subscription.unsubscribe();
    firstLoad.resolve(1);
    await runtime.whenSettled();

    tracer.setStep("resubscribe loads normally");
    const again = runtime.subscribeNodes([first, queued]);
    await runtime.whenSettled();
    again.unsubscribe();

    expectTrace(tracer);
  });

  it("a node aborted while loading loads again when resubscribed", async () => {
    let loads = 0;
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: ({ signal }) => {
        loads += 1;
        return loads === 1 ? cooperativeLoad(signal) : Promise.resolve(42);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));

    const first = runtime.subscribeNodes([node]);
    await waitForCondition(() => loads === 1, "first load to start");
    first.unsubscribe();
    await runtime.whenSettled();
    expect(runtime.getState(node)).toMatchObject({
      status: "idle",
      freshness: "stale",
      hasSuccessfulValue: false,
    });

    const second = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(runtime.getState(node)).toMatchObject({
      status: "success",
      freshness: "fresh",
      data: 42,
    });
    second.unsubscribe();
  });
});
