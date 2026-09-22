import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  type AnyNodeDefinition,
  type GraphDiagnosticEvent,
  type GraphRuntime,
} from "../../src/core";
import { createRuntimeDiagnosticEmitter } from "../../src/core/diagnostics/diagnostic-emitter";
import { createSchedulerDiagnostics } from "../../src/core/composition/scheduler-diagnostics";
import { createSchedulerRequestTracker } from "../../src/core/scheduling/request-tracker";
import { computeTimeline } from "../../src/devtools/protocol/timeline";
import { buildCoordination } from "./coordination-harness";

/**
 * The scheduler coalesces requests made in the same synchronous turn into one
 * flush, but a flush does not wait for its loads: work requested while earlier
 * loads are still in flight is served by a new, overlapping flush. These tests
 * pin that behaviour and every race it creates. Loaders are controlled by hand
 * (no wall-clock time), so each ordering is exact and repeatable.
 */

const abortError = (): Error => new DOMException("aborted", "AbortError");

/** Lets every pending microtask, and anything they schedule, run. */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

interface Call<T> {
  readonly signal: AbortSignal;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

/**
 * A loader the test settles by hand. It records every call. By default it
 * honours its abort signal; `ignoresSignal` makes it behave like a loader that
 * does not, whose late result the runtime must ignore.
 */
const controlled = <T>(options?: { readonly ignoresSignal?: boolean }) => {
  const calls: Call<T>[] = [];
  const load = ({ signal }: { readonly signal: AbortSignal }): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      calls.push({ signal, resolve, reject });
      if (!options?.ignoresSignal) {
        signal.addEventListener("abort", () => reject(abortError()));
      }
    });
  return { calls, load };
};

const failureNodeKeys = (runtime: GraphRuntime): readonly string[] => {
  const error = runtime.getSchedulerState().error as
    | (Error & { failures?: readonly { nodeKey: string }[] })
    | null;
  return error?.failures?.map(failure => failure.nodeKey) ?? [];
};

const eventsOf = (
  events: readonly GraphDiagnosticEvent[],
  type: string,
): readonly GraphDiagnosticEvent[] => events.filter(event => event.type === type);

const build = (nodes: readonly AnyNodeDefinition[], options?: { maxConcurrentLoads?: number }) => {
  const collector = createInMemoryGraphDiagnostics({ capacity: 2_000 });
  const runtime = createGraphRuntime(createGraph({ nodes }), {
    diagnostics: { sink: collector },
    ...(options?.maxConcurrentLoads === undefined
      ? {}
      : { maxConcurrentLoads: options.maxConcurrentLoads }),
  });
  return { runtime, events: () => collector.getEvents() };
};

const settled = async (runtime: GraphRuntime): Promise<boolean> => {
  let done = false;
  void runtime.whenSettled().then(() => {
    done = true;
  });
  await flush();
  return done;
};

describe("independent work is not held up by a slow load", () => {
  it("starts a newly subscribed node's load while another load is in flight", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, fastNode]);

    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush();

    expect(runtime.getState(fastNode)).toMatchObject({ status: "success", data: 2 });
    expect(runtime.getState(slowNode).status).toBe("loading");
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    expect(runtime.getState(slowNode)).toMatchObject({ status: "success", data: 1 });
    first.unsubscribe();
    second.unsubscribe();
  });

  it("reloads an unrelated subscribed node when its context changes mid-flight", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const fastNode = defineDataNode({
      key: "fast",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx) * 10,
    });
    const { runtime } = build([slowNode, ctx, fastNode]);
    const fastSubscription = runtime.subscribeNodes([fastNode]);
    await runtime.whenSettled();
    const slowSubscription = runtime.subscribeNodes([slowNode]);
    await flush();

    runtime.setContext(ctx, 5);
    await flush();

    expect(runtime.getState(fastNode)).toMatchObject({ status: "success", data: 50 });
    expect(runtime.getState(slowNode).status).toBe("loading");
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    fastSubscription.unsubscribe();
    slowSubscription.unsubscribe();
  });

  it("serves several mounts during one slow load, loading a shared node once", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    let fastLoads = 0;
    const fastNode = defineDataNode({
      key: "fast",
      initialValue: 0,
      load: async () => {
        fastLoads += 1;
        return 2;
      },
    });
    const { runtime } = build([slowNode, fastNode]);
    const subscriptions = [runtime.subscribeNodes([slowNode])];
    await flush();

    for (let mount = 0; mount < 4; mount += 1) {
      subscriptions.push(runtime.subscribeNodes([fastNode]));
      await flush();
      expect(runtime.getState(fastNode).status).toBe("success");
    }

    expect(fastLoads).toBe(1);
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });

  it("still shows a same-call sibling as soon as it is ready", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, fastNode]);

    const subscription = runtime.subscribeNodes([slowNode, fastNode]);
    await flush();

    expect(runtime.getState(fastNode).status).toBe("success");
    expect(runtime.getState(slowNode).status).toBe("loading");
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    subscription.unsubscribe();
  });

  it("makes a dependent wait for its slow parent while unrelated nodes go ahead", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    let childLoads = 0;
    const childNode = defineDataNode({
      key: "child",
      dependencies: [slowNode] as const,
      initialValue: 0,
      load: async ({ get }) => {
        childLoads += 1;
        return get(slowNode) + 100;
      },
    });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, childNode, fastNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();

    const second = runtime.subscribeNodes([childNode, fastNode]);
    await flush();

    // The independent sibling is not held up...
    expect(runtime.getState(fastNode).status).toBe("success");
    // ...but the dependent cannot start until its parent has a value: the
    // runtime resolves ancestors before invoking a node's own loader, so
    // `child` has not been touched yet (still its never-loaded shape),
    // rather than showing a "loading" status with nothing to load from.
    expect(runtime.getState(childNode)).toMatchObject({ status: "idle", hasSuccessfulValue: false });
    expect(childLoads).toBe(0);
    expect(slow.calls).toHaveLength(1); // reused, not reloaded, by the second flush

    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    expect(runtime.getState(childNode)).toMatchObject({ status: "success", data: 101 });
    expect(childLoads).toBe(1);
    expect(slow.calls).toHaveLength(1);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("keeps a slow load's failure away from independent nodes; its dependent is blocked, not touched", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const childNode = defineDataNode({
      key: "child",
      dependencies: [slowNode] as const,
      initialValue: 0,
      load: async ({ get }) => get(slowNode),
    });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, childNode, fastNode]);
    const first = runtime.subscribeNodes([childNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush();

    slow.calls[0]!.reject(new Error("slow failed"));
    await runtime.whenSettled();

    expect(runtime.getState(fastNode)).toMatchObject({ status: "success", data: 2 });
    expect(runtime.getState(slowNode).status).toBe("error");
    // A node blocked by a failed ancestor is never itself executed (existing
    // execution semantics, unrelated to overlapping flushes): its own state
    // is left exactly as it was.
    expect(runtime.getState(childNode)).toMatchObject({ status: "idle", hasSuccessfulValue: false });
    const error = runtime.getSchedulerState().error as (Error & { failures?: readonly { nodeKey: string; kind: string }[] }) | null;
    expect(error?.failures?.some(failure => failure.nodeKey === "child" && failure.kind === "blocked")).toBe(true);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("queues behind a full concurrency limit in order, and moves on when a slot is freed by abort", async () => {
    const first = controlled<number>();
    const firstNode = defineDataNode({ key: "first", initialValue: 0, load: first.load });
    const secondLoads: string[] = [];
    const secondNode = defineDataNode({
      key: "second",
      initialValue: 0,
      load: async () => {
        secondLoads.push("second");
        return 2;
      },
    });
    const thirdNode = defineDataNode({
      key: "third",
      initialValue: 0,
      load: async () => {
        secondLoads.push("third");
        return 3;
      },
    });
    const { runtime } = build([firstNode, secondNode, thirdNode], { maxConcurrentLoads: 1 });
    const holder = runtime.subscribeNodes([firstNode]);
    await flush();
    const later = runtime.subscribeNodes([secondNode]);
    await flush();
    const latest = runtime.subscribeNodes([thirdNode]);
    await flush();

    // Both are waiting for the single slot, not blocked behind a flush.
    expect(runtime.getState(secondNode).status).toBe("loading");
    expect(runtime.getState(thirdNode).status).toBe("loading");
    expect(secondLoads).toEqual([]);

    holder.unsubscribe(); // aborts the holder and frees the slot
    await runtime.whenSettled();

    expect(secondLoads).toEqual(["second", "third"]);
    expect(runtime.getState(secondNode)).toMatchObject({ status: "success", data: 2 });
    expect(runtime.getState(thirdNode)).toMatchObject({ status: "success", data: 3 });
    later.unsubscribe();
    latest.unsubscribe();
  });
});

describe("work is never started twice", () => {
  it("does not restart a node that is already loading when later flushes run", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const otherNode = defineDataNode({ key: "other", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, otherNode]);
    const subscription = runtime.subscribeNodes([slowNode]);
    await flush();

    for (let round = 0; round < 6; round += 1) {
      runtime.subscribeNodes([otherNode]).unsubscribe();
      await flush();
    }

    expect(slow.calls).toHaveLength(1);
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    expect(slow.calls).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("does not double-load when a second flush is requested before the first one has registered its attempts", async () => {
    let loads = 0;
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: async () => {
        loads += 1;
        return 1;
      },
    });
    const other = defineDataNode({ key: "other", initialValue: 0, load: async () => 2 });
    const { runtime } = build([node, other]);

    const first = runtime.subscribeNodes([node]);
    // Runs right after the first flush starts, before its attempts exist.
    let second: { unsubscribe: () => void } | undefined;
    queueMicrotask(() => {
      queueMicrotask(() => {
        second = runtime.subscribeNodes([other]);
      });
    });
    await runtime.whenSettled();

    expect(loads).toBe(1);
    expect(runtime.getState(other)).toMatchObject({ status: "success", data: 2 });
    first.unsubscribe();
    second?.unsubscribe();
  });

  it("shares one attempt between an explicit execute and the scheduler", async () => {
    const slow = controlled<number>();
    const node = defineDataNode({ key: "node", initialValue: 0, load: slow.load });
    const { runtime } = build([node]);
    const subscription = runtime.subscribeNodes([node]);
    await flush();

    const explicit = runtime.execute([node]);
    await flush();
    expect(slow.calls).toHaveLength(1);
    slow.calls[0]!.resolve(7);
    await explicit;
    await runtime.whenSettled();

    expect(slow.calls).toHaveLength(1);
    expect(runtime.getState(node)).toMatchObject({ status: "success", data: 7 });
    subscription.unsubscribe();
  });

  it("loads a node once when it is subscribed by several callers in the same turn", async () => {
    let loads = 0;
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: async () => {
        loads += 1;
        return 1;
      },
    });
    const { runtime, events } = build([node]);

    const subscriptions = [1, 2, 3, 4, 5].map(() => runtime.subscribeNodes([node]));
    await runtime.whenSettled();

    expect(loads).toBe(1);
    expect(eventsOf(events(), "scheduler.requested")).toHaveLength(1);
    expect(eventsOf(events(), "scheduler.started")).toHaveLength(1);
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });
});

describe("invalidation and supersession races", () => {
  it.each([
    ["honours its signal", false],
    ["ignores its signal", true],
  ])("applies only the newest attempt when a node is invalidated mid-flight and its loader %s", async (_name, ignoresSignal) => {
    const loader = controlled<number>({ ignoresSignal });
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: ({ get, signal }) => {
        const value = get(ctx);
        return loader.load({ signal }).then(result => result + value);
      },
    });
    const { runtime } = build([ctx, node]);
    const subscription = runtime.subscribeNodes([node]);
    await flush();
    expect(loader.calls).toHaveLength(1);

    runtime.setContext(ctx, 2);
    await flush();
    expect(loader.calls).toHaveLength(2); // the new attempt starts at once

    // The old attempt's result arrives last and must be ignored.
    loader.calls[1]!.resolve(10);
    await flush();
    loader.calls[0]!.resolve(1000);
    await runtime.whenSettled();

    expect(runtime.getState(node)).toMatchObject({ status: "success", data: 12 });
    subscription.unsubscribe();
  });

  it("applies only the latest value after a burst of invalidations resolves out of order", async () => {
    const loader = controlled<number>({ ignoresSignal: true });
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: -1,
      load: ({ get, signal }) => {
        const seen = get(ctx);
        return loader.load({ signal }).then(() => seen);
      },
    });
    const { runtime, events } = build([ctx, node]);
    const subscription = runtime.subscribeNodes([node]);
    await flush();
    for (let change = 1; change <= 5; change += 1) {
      runtime.setContext(ctx, change);
      await flush();
    }
    expect(loader.calls).toHaveLength(6);

    for (const call of [...loader.calls].reverse()) {
      call.resolve(0);
      await flush();
    }
    await runtime.whenSettled();

    expect(runtime.getState(node)).toMatchObject({ status: "success", data: 5 });
    expect(runtime.createDiagnosticSnapshot().metrics?.activeLoads).toBe(0);
    expect(eventsOf(events(), "node.load.succeeded")).toHaveLength(1);
    subscription.unsubscribe();
  });

  it("lets the last unsubscribe abort a load while another flush is in flight", async () => {
    const aborted = controlled<number>();
    const slow = controlled<number>();
    const abortedNode = defineDataNode({ key: "aborted", initialValue: 0, load: aborted.load });
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const { runtime } = build([abortedNode, slowNode]);
    const first = runtime.subscribeNodes([abortedNode]);
    await flush();
    const second = runtime.subscribeNodes([slowNode]);
    await flush();

    first.unsubscribe();
    await flush();

    expect(aborted.calls[0]!.signal.aborted).toBe(true);
    expect(runtime.getState(abortedNode)).toMatchObject({ status: "idle", hasSuccessfulValue: false });
    expect(runtime.getSchedulerState().isRunning).toBe(true); // the slow flush is still going
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    expect(runtime.getSchedulerState()).toMatchObject({ isScheduled: false, isRunning: false });
    second.unsubscribe();
  });

  it.each([
    ["honours its signal", false],
    ["ignores its signal", true],
  ])("reloads a node unsubscribed and resubscribed in the same turn when its loader %s", async (_name, ignoresSignal) => {
    const loader = controlled<number>({ ignoresSignal });
    const node = defineDataNode({ key: "node", initialValue: 0, load: loader.load });
    const { runtime } = build([node]);
    const first = runtime.subscribeNodes([node]);
    await flush();

    first.unsubscribe();
    const second = runtime.subscribeNodes([node]);
    await flush();

    expect(loader.calls).toHaveLength(2);
    loader.calls[1]!.resolve(42);
    await runtime.whenSettled();
    expect(runtime.getState(node)).toMatchObject({ status: "success", data: 42 });
    second.unsubscribe();
  });

  it("coalesces a subscription and a context change made in the same turn into one flush", async () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    let loads = 0;
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => {
        loads += 1;
        return get(ctx);
      },
    });
    const { runtime, events } = build([ctx, node]);

    const subscription = runtime.subscribeNodes([node]);
    runtime.setContext(ctx, 9);
    await runtime.whenSettled();

    expect(loads).toBe(1);
    expect(runtime.getState(node).data).toBe(9);
    expect(eventsOf(events(), "scheduler.requested")).toHaveLength(1);
    subscription.unsubscribe();
  });
});

describe("whenSettled and scheduler state across overlapping flushes", () => {
  it("resolves only after every overlapping flush has finished", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime } = build([slowNode, fastNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush(); // the fast flush has finished; the slow one has not

    expect(await settled(runtime)).toBe(false);
    slow.calls[0]!.resolve(1);
    expect(await settled(runtime)).toBe(true);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("resolves immediately when idle, and releases every waiter together", async () => {
    const slow = controlled<number>();
    const node = defineDataNode({ key: "node", initialValue: 0, load: slow.load });
    const { runtime } = build([node]);
    expect(await settled(runtime)).toBe(true);

    const subscription = runtime.subscribeNodes([node]);
    await flush();
    const resolved: number[] = [];
    for (const id of [1, 2, 3]) void runtime.whenSettled().then(() => resolved.push(id));
    await flush();
    expect(resolved).toEqual([]);

    slow.calls[0]!.resolve(1);
    await flush();
    expect(resolved).toEqual([1, 2, 3]);
    subscription.unsubscribe();
  });

  it("keeps a waiter waiting when a new flush starts before the first one finishes", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const late = controlled<number>();
    const lateNode = defineDataNode({ key: "late", initialValue: 0, load: late.load });
    const { runtime } = build([slowNode, lateNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    let done = false;
    void runtime.whenSettled().then(() => {
      done = true;
    });
    const second = runtime.subscribeNodes([lateNode]);
    await flush();

    slow.calls[0]!.resolve(1);
    await flush();
    expect(done).toBe(false); // the later flush is still in flight

    late.calls[0]!.resolve(2);
    await flush();
    expect(done).toBe(true);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("reports scheduled, then running while any flush is in flight, then idle", async () => {
    const slow = controlled<number>();
    const node = defineDataNode({ key: "node", initialValue: 0, load: slow.load });
    const { runtime } = build([node]);
    const seen: string[] = [];
    runtime.onChange(() => {
      const { isScheduled, isRunning } = runtime.getSchedulerState();
      const label = `${isScheduled ? "scheduled" : ""}${isRunning ? "running" : ""}` || "idle";
      if (seen[seen.length - 1] !== label) seen.push(label);
    });

    const subscription = runtime.subscribeNodes([node]);
    expect(runtime.getSchedulerState()).toMatchObject({ isScheduled: true, isRunning: false });
    await flush();
    expect(runtime.getSchedulerState()).toMatchObject({ isScheduled: false, isRunning: true });
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    expect(runtime.getSchedulerState()).toMatchObject({ isScheduled: false, isRunning: false });
    expect(seen).toEqual(expect.arrayContaining(["scheduled", "running", "idle"]));
    subscription.unsubscribe();
  });

  it.each([
    ["the failing flush finishes first", "failFirst"],
    ["the failing flush finishes last", "failLast"],
  ] as const)("reports the most recently finished flush's outcome when %s", async (_name, order) => {
    const bad = controlled<number>();
    const good = controlled<number>();
    const badNode = defineDataNode({ key: "bad", initialValue: 0, load: bad.load });
    const goodNode = defineDataNode({ key: "good", initialValue: 0, load: good.load });
    const { runtime } = build([badNode, goodNode]);
    const first = runtime.subscribeNodes([badNode]);
    await flush();
    const second = runtime.subscribeNodes([goodNode]);
    await flush();

    if (order === "failFirst") {
      bad.calls[0]!.reject(new Error("bad failed"));
      await flush();
      expect(failureNodeKeys(runtime)).toContain("bad");
      good.calls[0]!.resolve(1);
      await runtime.whenSettled();
      expect(runtime.getSchedulerState().error).toBeNull();
    } else {
      good.calls[0]!.resolve(1);
      await flush();
      expect(runtime.getSchedulerState().error).toBeNull();
      bad.calls[0]!.reject(new Error("bad failed"));
      await runtime.whenSettled();
      expect(failureNodeKeys(runtime)).toContain("bad");
    }
    first.unsubscribe();
    second.unsubscribe();
  });
});

describe("attribution and diagnostics of overlapping flushes", () => {
  it("keeps a running flush's attribution when another request arrives mid-flight", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    const fastNode = defineDataNode({
      key: "fast",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: async ({ get }) => get(ctx),
    });
    const { runtime, events } = build([slowNode, ctx, fastNode]);
    const fastSubscription = runtime.subscribeNodes([fastNode]);
    await runtime.whenSettled();
    const slowSubscription = runtime.subscribeNodes([slowNode]);
    await flush();

    runtime.setContext(ctx, 2); // a different reason, while the slow flush runs
    await flush();
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    const completed = eventsOf(events(), "scheduler.completed");
    const slowFlush = completed.find(event => "reason" in event && event.reason === "subscription");
    const contextFlush = completed.find(event => "reason" in event && event.reason === "context-invalidation");
    expect(slowFlush).toBeDefined();
    expect(contextFlush).toBeDefined();
    // Each flush's cause points at whatever requested *it* - the slow flush's
    // own subscription, the fast flush's own context change - never at the
    // other's. Overlap must not let one flush's request overwrite another's
    // attribution before it starts.
    const causeOf = (event: typeof slowFlush) => (event && "causeId" in event ? event.causeId : undefined);
    expect(causeOf(slowFlush)).toBeTruthy();
    expect(causeOf(contextFlush)).toBeTruthy();
    expect(causeOf(slowFlush)).not.toBe(causeOf(contextFlush));
    expect(slowFlush?.operationId).not.toBe(contextFlush?.operationId);
    fastSubscription.unsubscribe();
    slowSubscription.unsubscribe();
  });

  it("emits one requested, started, and completed event per flush, paired by operation", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime, events } = build([slowNode, fastNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush();
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    const idsOf = (type: string) =>
      eventsOf(events(), type).map(event => event.operationId).sort();
    expect(idsOf("scheduler.requested")).toHaveLength(2);
    expect(idsOf("scheduler.started")).toEqual(idsOf("scheduler.requested"));
    expect(idsOf("scheduler.completed")).toEqual(idsOf("scheduler.requested"));
    expect(new Set(idsOf("scheduler.requested")).size).toBe(2);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("stamps each load's events with the operation of the flush that started it", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime, events } = build([slowNode, fastNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush();
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    const startedBy = (nodeKey: string) =>
      events().find(event => event.type === "node.load.started" && "nodeKey" in event && event.nodeKey === nodeKey)?.operationId;
    const flushOf = (nodeKey: string) =>
      eventsOf(events(), "scheduler.started").find(event => "nodeKeys" in event && event.nodeKeys.includes(nodeKey))?.operationId;
    expect(startedBy("slow")).toBe(flushOf("slow"));
    expect(startedBy("fast")).toBe(flushOf("fast"));
    expect(startedBy("slow")).not.toBe(startedBy("fast"));
    first.unsubscribe();
    second.unsubscribe();
  });

  it("shows overlapping flushes as separate operations in the devtools timeline", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const fastNode = defineDataNode({ key: "fast", initialValue: 0, load: async () => 2 });
    const { runtime, events } = build([slowNode, fastNode]);
    const first = runtime.subscribeNodes([slowNode]);
    await flush();
    const second = runtime.subscribeNodes([fastNode]);
    await flush();
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();

    const entries = computeTimeline(events());
    const schedulerOperations = new Set(
      entries.filter(entry => entry.type.startsWith("scheduler.")).map(entry => entry.operationId),
    );
    expect(schedulerOperations.size).toBe(2);
    expect(entries.some(entry => entry.isFailure)).toBe(false);
    first.unsubscribe();
    second.unsubscribe();
  });
});

describe("storms and reentrancy", () => {
  it("returns to a quiescent runtime after a storm of changes during a slow load", async () => {
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const fastNode = defineDataNode({
      key: "fast",
      dependencies: [ctx] as const,
      initialValue: -1,
      load: async ({ get }) => get(ctx),
    });
    const { runtime, events } = build([slowNode, ctx, fastNode]);
    const fastSubscription = runtime.subscribeNodes([fastNode]);
    const slowSubscription = runtime.subscribeNodes([slowNode]);
    await flush();

    for (let change = 1; change <= 200; change += 1) {
      runtime.setContext(ctx, change);
      if (change % 3 === 0) await flush();
    }
    await flush();
    expect(runtime.getState(fastNode)).toMatchObject({ status: "success", data: 200 });

    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    const snapshot = runtime.createDiagnosticSnapshot();
    expect(snapshot.scheduler).toMatchObject({ isScheduled: false, isRunning: false });
    expect(snapshot.metrics?.activeLoads).toBe(0);
    expect(eventsOf(events(), "scheduler.started").length).toBeLessThanOrEqual(
      eventsOf(events(), "scheduler.requested").length,
    );
    expect(eventsOf(events(), "scheduler.completed")).toHaveLength(
      eventsOf(events(), "scheduler.started").length,
    );
    fastSubscription.unsubscribe();
    slowSubscription.unsubscribe();
  });

  it("serves work requested by a change listener while a flush is starting, exactly once", async () => {
    const first = defineDataNode({ key: "first", initialValue: 0, load: async () => 1 });
    let secondLoads = 0;
    const second = defineDataNode({
      key: "second",
      initialValue: 0,
      load: async () => {
        secondLoads += 1;
        return 2;
      },
    });
    const { runtime } = build([first, second]);
    let secondSubscription: { unsubscribe: () => void } | undefined;
    runtime.onChange(() => {
      if (runtime.getSchedulerState().isRunning && secondSubscription === undefined) {
        secondSubscription = runtime.subscribeNodes([second]);
      }
    });

    const subscription = runtime.subscribeNodes([first]);
    await runtime.whenSettled();

    expect(secondLoads).toBe(1);
    expect(runtime.getState(second)).toMatchObject({ status: "success", data: 2 });
    subscription.unsubscribe();
    secondSubscription?.unsubscribe();
  });

  it("serves a change made by a loader while other flushes are running", async () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    const slow = controlled<number>();
    const slowNode = defineDataNode({ key: "slow", initialValue: 0, load: slow.load });
    const followerNode = defineDataNode({
      key: "follower",
      dependencies: [ctx] as const,
      initialValue: -1,
      load: async ({ get }) => get(ctx),
    });
    const triggerNode = defineDataNode({
      key: "trigger",
      initialValue: 0,
      load: async () => {
        // A loader that writes a context: the write must be served promptly.
        Promise.resolve().then(() => runtimeRef?.setContext(ctx, 7));
        return 1;
      },
    });
    const { runtime } = build([ctx, slowNode, followerNode, triggerNode]);
    const runtimeRef: GraphRuntime | undefined = runtime;
    const followerSubscription = runtime.subscribeNodes([followerNode]);
    const slowSubscription = runtime.subscribeNodes([slowNode]);
    await flush();

    const triggerSubscription = runtime.subscribeNodes([triggerNode]);
    await flush();

    expect(runtime.getState(followerNode)).toMatchObject({ status: "success", data: 7 });
    slow.calls[0]!.resolve(1);
    await runtime.whenSettled();
    followerSubscription.unsubscribe();
    slowSubscription.unsubscribe();
    triggerSubscription.unsubscribe();
  });

  it("does not leave a stalled flush behind when the runtime is disposed mid-flight", async () => {
    const slow = controlled<number>();
    const node = defineDataNode({ key: "node", initialValue: 0, load: slow.load });
    const { runtime } = build([node]);
    const subscription = runtime.subscribeNodes([node]);
    await flush();

    runtime.dispose();
    subscription.unsubscribe();
    await runtime.whenSettled();

    expect(runtime.getSchedulerState().isRunning).toBe(false);
  });
});

describe("aborted attempts are never reused", () => {
  it("starts a new attempt instead of joining one that is already aborted", async () => {
    const loader = controlled<number>({ ignoresSignal: true });
    const node = defineDataNode({ key: "node", initialValue: 0, load: loader.load });
    const { coordination, state } = buildCoordination([node]);
    const running = coordination.execution.execute([node], "explicit");
    await flush();
    expect(loader.calls).toHaveLength(1);

    // An attempt that is aborted but still registered, with the same generation.
    const attempt = [...state.getActiveAttempts()][0]![1];
    attempt.controller.abort();
    const again = coordination.execution.execute([node], "explicit");
    await flush();

    expect(loader.calls).toHaveLength(2);
    loader.calls[1]!.resolve(5);
    await again;
    await running;
    expect(state.getNodeState("node")).toMatchObject({ status: "success", data: 5 });
  });

});

describe("scheduler-diagnostics attribution does not leak between flushes", () => {
  it("resets the request tracker so a flush with no fresh request falls back to the default reason", () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 200 });
    const diagnostics = createRuntimeDiagnosticEmitter({ sink: collector });
    const schedulerRequest = createSchedulerRequestTracker("subscription");
    const schedulerDiagnostics = createSchedulerDiagnostics({ diagnostics, schedulerRequest });
    const node: AnyNodeDefinition = defineDataNode({ key: "n", initialValue: 0, load: async () => 1 });

    schedulerRequest.request("context-invalidation", "cause-a");
    schedulerDiagnostics.onRequested();
    const first = schedulerDiagnostics.beginFlush([node]);
    first.complete(null);

    // Nothing calls schedulerRequest.request() again before the next flush -
    // exactly what the shared tracker looks like once beginFlush has reset it.
    schedulerDiagnostics.onRequested();
    const second = schedulerDiagnostics.beginFlush([node]);
    second.complete(null);

    const started = eventsOf(collector.getEvents(), "scheduler.started");
    expect(started.map(event => ("reason" in event ? event.reason : undefined))).toEqual([
      "context-invalidation",
      "subscription",
    ]);
    expect(started.map(event => ("causeId" in event ? event.causeId : undefined))).toEqual([
      "cause-a",
      undefined,
    ]);
  });
});
