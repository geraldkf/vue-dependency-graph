import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  defineEvent,
  defineMutation,
  defineQuery,
  normalizeDiagnosticEvents,
  refreshInterval,
  releaseAfter,
  type GraphDiagnosticEvent,
  type TimerEnvironment,
} from "../../src/core";
import { waitForCondition } from "./test-helpers";

/**
 * Golden trace of the runtime's full diagnostic stream for one scenario that
 * exercises every scheduler/execution reason and every capability the runtime
 * composes (subscriptions, scheduler, execution, invalidation, events,
 * transactions, operations, mutations, refresh policies).
 *
 * It exists to make structural refactors of `runtime.ts` safe: moving wiring
 * between modules must not change *which* events are emitted, in *what order*,
 * or how they are attributed (`operationId`, `causeId`, `reason`). Identifiers
 * are normalised, so the snapshot is stable and only changes when behaviour
 * does. If a change here is intended, review the snapshot diff line by line.
 */

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
};

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
    clearTimeout: handle => {
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

describe("runtime golden diagnostic trace", () => {
  it("emits a stable, fully attributed event stream across all runtime capabilities", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 2_000 });
    const clock = createClock();
    let diagnosticsNow = 0;

    const changed = defineEvent<void>("changed");
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const data = defineDataNode({
      key: "data",
      dependencies: [ctx] as const,
      invalidatedBy: [changed] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx),
    });
    const derived = defineDerivedNode({
      key: "derived",
      dependencies: [data] as const,
      derive: ({ get }) => get(data) * 10,
    });
    let sourceValue = 1;
    const source = defineDataNode({
      key: "source",
      initialValue: 0,
      load: async () => sourceValue,
    });
    const child = defineDataNode({
      key: "child",
      dependencies: [source] as const,
      initialValue: 0,
      load: async ({ get }) => get(source) + 100,
    });
    let polls = 0;
    const polled = defineDataNode({
      key: "polled",
      initialValue: 0,
      load: async () => ++polls,
      refresh: refreshInterval({ intervalMs: 1_000 }),
    });
    const released = defineDataNode({
      key: "released",
      initialValue: 0,
      release: releaseAfter({ durationMs: 500 }),
      load: async () => 9,
    });
    const page = defineQuery({ key: "page", nodes: { data, derived } });
    const save = defineMutation({
      key: "save",
      execute: async () => "saved",
    });

    const runtime = createGraphRuntime(
      createGraph({
        nodes: [data, derived, source, child, polled, released, ctx],
      }),
      {
        timerEnvironment: clock.environment,
        diagnostics: {
          sink: collector,
          environment: {
            now: () => ++diagnosticsNow,
            createRuntimeId: () => "golden-runtime",
          },
        },
      },
    );

    // subscription -> scheduler, with dependency-ordered loads
    const subscription = runtime.subscribeNodes([data, derived, child, polled]);
    await runtime.whenSettled();

    // context-invalidation via an immediate write
    runtime.setContext(ctx, 2);
    await runtime.whenSettled();

    // typed event publication
    runtime.publish(changed, undefined);
    await runtime.whenSettled();

    // transaction-owned context write + event
    await runtime.transaction(transaction => {
      transaction.setContext(ctx, 3);
      transaction.publish(changed, undefined);
    });
    await runtime.whenSettled();

    // refresh whose changed result invalidates descendants (changed-result)
    sourceValue = 2;
    await runtime.refresh([source]);
    await runtime.whenSettled();

    // refresh-policy timer firing
    clock.advanceBy(1_000);
    await waitForCondition(() => polls === 2, "policy refresh to run");
    await runtime.whenSettled();

    // caller-owned operations
    await runtime.execute([derived]);
    await runtime.prefetch([child]);
    await runtime.refresh([data]);
    await runtime.prefetchQuery(page);
    await runtime.refreshQuery(page);
    await runtime.whenSettled();

    // mutation: optimistic update, then success effects (invalidate + publish)
    await runtime.mutate(save, undefined, {
      optimistic: effects => effects.update(data, current => current + 1),
      onSuccess: effects => {
        effects.invalidate([source]);
        effects.publish(changed, undefined);
      },
    });
    await runtime.whenSettled();

    subscription.unsubscribe();
    await runtime.whenSettled();

    // release policy: an idle value is released after its timer fires
    const releasedSubscription = runtime.subscribeNodes([released]);
    await runtime.whenSettled();
    releasedSubscription.unsubscribe();
    clock.advanceBy(500);
    await runtime.whenSettled();
    runtime.dispose();

    const events: readonly GraphDiagnosticEvent[] = normalizeDiagnosticEvents(
      collector.getEvents(),
    );

    // Guard the trace's own coverage: every execution reason must appear, so
    // the snapshot cannot silently stop covering an attribution path.
    const reasons = new Set(
      events.flatMap(event => ("reason" in event ? [event.reason] : [])),
    );
    for (const reason of [
      "explicit",
      "subscription",
      "prefetch",
      "refresh",
      "query-prefetch",
      "query-refresh",
      "context-invalidation",
      "changed-result",
      "refresh-policy",
      "dependency",
    ]) {
      expect(reasons, `missing reason "${reason}"`).toContain(reason);
    }
    expect(events.map(event => event.type)).toContain("node.value-released");
    expect(collector.getEvents().length).toBeLessThan(2_000);

    expect(
      events.map(event => JSON.stringify(sortKeys(event))),
    ).toMatchSnapshot();
  });
});
