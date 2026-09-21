import { describe, expect, it } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  createInMemoryGraphDiagnostics,
  defineContextNode,
  defineDataNode,
  type AnyNodeDefinition,
  type GraphDiagnosticEvent,
} from "../../src/core";
import { buildCoordination } from "../core/coordination-harness";
import { waitForCondition } from "../core/test-helpers";

/**
 * Attempts must end when their work is no longer wanted - unsubscribed,
 * superseded, or cancelled while queued - whether or not the loader honours
 * its abort signal. An attempt that lingers keeps its concurrency slot, its
 * place in the active attempt table, and the scheduler flush awaiting it.
 * A loader that ignores the signal and never settles must not be able to
 * stall the rest of the runtime.
 */

const abortError = (): Error => new DOMException("aborted", "AbortError");

/** Honours the signal: rejects as soon as it aborts. */
const cooperativeLoad = (signal: AbortSignal): Promise<number> =>
  new Promise<number>((_resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    signal.addEventListener("abort", () => reject(abortError()));
  });

/** Ignores the signal and never settles. */
const hangingLoad = (): Promise<number> => new Promise<number>(() => undefined);

/** `getActiveAttempts()` is an iterator over the active attempt table. */
const attemptCount = (state: {
  readonly getActiveAttempts: () => Iterable<unknown>;
}): number => [...state.getActiveAttempts()].length;

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

const terminalLoadEvents = (
  events: readonly GraphDiagnosticEvent[],
  nodeKey: string,
): readonly string[] =>
  events
    .filter(
      event =>
        "nodeKey" in event &&
        event.nodeKey === nodeKey &&
        /^node\.load\.(succeeded|failed|aborted|discarded)$/.test(event.type),
    )
    .map(event => event.type);

describe("the active attempt table empties", () => {
  it.each([
    ["succeeds", () => Promise.resolve(1)],
    ["fails", () => Promise.reject(new Error("load failed"))],
  ] as const)("when a load %s", async (_name, load) => {
    const node = defineDataNode({ key: "node", initialValue: 0, load });
    const { coordination, state } = buildCoordination([node]);

    const subscription = coordination.subscriptions.subscribeNodes([node]);
    await coordination.scheduler.whenSettled();

    expect(attemptCount(state)).toBe(0);
    subscription.unsubscribe();
  });

  it.each([
    ["honours its signal", ({ signal }: { signal: AbortSignal }) => cooperativeLoad(signal)],
    ["ignores its signal and never settles", hangingLoad],
  ] as const)("as soon as the last subscriber leaves a load that %s", async (_name, load) => {
    const node = defineDataNode({ key: "node", initialValue: 0, load });
    const { coordination, state } = buildCoordination([node]);
    const subscription = coordination.subscriptions.subscribeNodes([node]);
    await waitForCondition(() => attemptCount(state) === 1, "the attempt to start");
    await flush();

    subscription.unsubscribe();
    await coordination.scheduler.whenSettled();

    expect(attemptCount(state)).toBe(0);
    expect(state.getNodeState("node")).toMatchObject({ status: "idle", hasSuccessfulValue: false });
  });

  it("when a queued attempt is cancelled, and the slot it waited for is not lost", async () => {
    const stuck = defineDataNode({ key: "stuck", initialValue: 0, load: hangingLoad });
    const queued = defineDataNode({ key: "queued", initialValue: 0, load: async () => 2 });
    const later = defineDataNode({ key: "later", initialValue: 0, load: async () => 3 });
    const { coordination, state } = buildCoordination([stuck, queued, later], {
      maxConcurrentLoads: 1,
    });

    const subscription = coordination.subscriptions.subscribeNodes([stuck, queued]);
    await waitForCondition(
      () => state.getNodeState("queued").status === "loading",
      "both attempts to begin",
    );
    await flush();
    expect(attemptCount(state)).toBe(2);

    subscription.unsubscribe();
    await coordination.scheduler.whenSettled();
    expect(attemptCount(state)).toBe(0);

    // With one slot in total, this only loads if the abandoned attempt gave its slot back.
    const again = coordination.subscriptions.subscribeNodes([later]);
    await coordination.scheduler.whenSettled();
    expect(state.getNodeState("later")).toMatchObject({ status: "success", data: 3 });
    again.unsubscribe();
  });

  it("after many attempts that end in every way at once", async () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 0 });
    let mode: "ok" | "fail" | "cooperative" | "hang" = "ok";
    const nodes: AnyNodeDefinition[] = ["a", "b", "c", "d"].map(key =>
      defineDataNode({
        key,
        dependencies: [ctx] as const,
        initialValue: 0,
        load: async ({ get, signal }) => {
          const value = get(ctx);
          if (mode === "fail") throw new Error("load failed");
          if (mode === "cooperative") return cooperativeLoad(signal);
          if (mode === "hang") return hangingLoad();
          return value;
        },
      }),
    );
    const { coordination, state, metrics } = buildCoordination([ctx, ...nodes], {
      maxConcurrentLoads: 2,
    });
    const modes = ["ok", "fail", "cooperative", "hang", "ok"] as const;

    for (let cycle = 0; cycle < 300; cycle += 1) {
      mode = modes[cycle % modes.length]!;
      const subscription = coordination.subscriptions.subscribeNodes(nodes);
      await flush();
      subscription.unsubscribe();
      await coordination.scheduler.whenSettled();
    }

    expect(attemptCount(state)).toBe(0);
    expect(coordination.scheduler.getSchedulerState()).toMatchObject({
      isScheduled: false,
      isRunning: false,
    });
    expect(metrics().activeLoads).toBe(0);
  });
});

describe("a loader that ignores its abort signal", () => {
  it("does not stop the rest of the runtime from loading once its node is unsubscribed", async () => {
    const hanging = defineDataNode({ key: "hanging", initialValue: 0, load: hangingLoad });
    const other = defineDataNode({ key: "other", initialValue: 0, load: async () => 42 });
    const runtime = createGraphRuntime(createGraph({ nodes: [hanging, other] }));

    const first = runtime.subscribeNodes([hanging]);
    await waitForCondition(() => runtime.getState(hanging).status === "loading", "the load to start");
    await flush();
    first.unsubscribe();
    const second = runtime.subscribeNodes([other]);
    await runtime.whenSettled();

    expect(runtime.getState(other)).toMatchObject({ status: "success", data: 42 });
    expect(runtime.getSchedulerState().isRunning).toBe(false);
    second.unsubscribe();
  });

  it("releases its concurrency slot when abandoned", async () => {
    const hanging = defineDataNode({ key: "hanging", initialValue: 0, load: hangingLoad });
    const other = defineDataNode({ key: "other", initialValue: 0, load: async () => 7 });
    const runtime = createGraphRuntime(createGraph({ nodes: [hanging, other] }), {
      maxConcurrentLoads: 1,
    });

    const first = runtime.subscribeNodes([hanging]);
    await waitForCondition(() => runtime.getState(hanging).status === "loading", "the load to start");
    await flush();
    first.unsubscribe();
    await runtime.execute([other]);

    expect(runtime.getState(other)).toMatchObject({ status: "success", data: 7 });
  });

  it("is abandoned when its node is invalidated, so the reload is not stuck behind it", async () => {
    const ctx = defineContextNode({ key: "ctx", initialValue: 1 });
    let loads = 0;
    const node = defineDataNode({
      key: "node",
      dependencies: [ctx] as const,
      initialValue: 0,
      load: ({ get }) => {
        loads += 1;
        const value = get(ctx);
        return loads === 1 ? hangingLoad() : Promise.resolve(value * 10);
      },
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node, ctx] }));

    const subscription = runtime.subscribeNodes([node]);
    await waitForCondition(() => loads === 1, "the first load to start");
    runtime.setContext(ctx, 2);
    await runtime.whenSettled();

    expect(runtime.getState(node)).toMatchObject({ status: "success", data: 20 });
    subscription.unsubscribe();
  });

  it("returns its node to idle at once, without waiting for the loader", async () => {
    const node = defineDataNode({ key: "node", initialValue: 0, load: hangingLoad });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
    const subscription = runtime.subscribeNodes([node]);
    await waitForCondition(() => runtime.getState(node).status === "loading", "the load to start");
    await flush();

    subscription.unsubscribe();
    await runtime.whenSettled();

    expect(runtime.getState(node)).toMatchObject({ status: "idle", hasSuccessfulValue: false });
  });

  it("ignores whatever the loader eventually produces, and reports one terminal event", async () => {
    const collector = createInMemoryGraphDiagnostics({ capacity: 200 });
    let resolveLate: ((value: number) => void) | undefined;
    const node = defineDataNode({
      key: "node",
      initialValue: 0,
      load: () =>
        new Promise<number>(resolve => {
          resolveLate = resolve;
        }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [node] }), {
      diagnostics: { sink: collector },
    });
    const subscription = runtime.subscribeNodes([node]);
    await waitForCondition(() => resolveLate !== undefined, "the load to start");
    await flush();
    subscription.unsubscribe();
    await runtime.whenSettled();

    resolveLate!(99);
    await flush();

    expect(runtime.getState(node)).toMatchObject({ status: "idle", hasSuccessfulValue: false, data: 0 });
    expect(terminalLoadEvents(collector.getEvents(), "node")).toEqual(["node.load.aborted"]);
    expect(runtime.createDiagnosticSnapshot().metrics?.activeLoads).toBe(0);
  });

  it("does not cause an unhandled rejection when it fails after being abandoned", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      let rejectLate: ((error: Error) => void) | undefined;
      const node = defineDataNode({
        key: "node",
        initialValue: 0,
        load: () =>
          new Promise<number>((_resolve, reject) => {
            rejectLate = reject;
          }),
      });
      const runtime = createGraphRuntime(createGraph({ nodes: [node] }));
      const subscription = runtime.subscribeNodes([node]);
      await waitForCondition(() => rejectLate !== undefined, "the load to start");
      await flush();
      subscription.unsubscribe();
      await runtime.whenSettled();

      rejectLate!(new Error("failed after being abandoned"));
      await flush();
      await flush();

      expect(unhandled).toEqual([]);
      expect(runtime.getState(node).status).toBe("idle");
    } finally {
      process.off("unhandledRejection", record);
    }
  });
});
