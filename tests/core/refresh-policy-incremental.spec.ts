import { describe, expect, it, vi } from "vitest";
import {
  createGraph,
  createGraphRuntime,
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
  staleAfter,
  type TimerEnvironment,
} from "../../src/core";
import { createRuntimeRefreshPolicyController } from "../../src/core/refresh-policies/policy-controller";
import { createNodeChangeTracker } from "../../src/core/state/change-tracker";
import { createRuntimeStateStore } from "../../src/core/state/state";
import { invalidate, succeedAttempt } from "../../src/core/state/transitions";
import { waitForCondition } from "./test-helpers";

const createClock = () => {
  const timers = new Map<number, { dueAt: number; callback: () => void }>();
  let now = 0;
  let nextId = 1;
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
  return { environment, timerCount: () => timers.size };
};

describe("incremental refresh-policy reconciliation", () => {
  it("reconsiders only changed nodes, and everything when no keys are given", () => {
    const nodes = Array.from({ length: 100 }, (_, index) =>
      defineDataNode({
        key: `node:${index}`,
        initialValue: 0,
        load: async () => 1,
        refresh: staleAfter({ durationMs: 1_000 }),
      }),
    );
    const graph = createGraph({ nodes });
    const states = createRuntimeStateStore(graph);
    const changes = createNodeChangeTracker();
    const getNodeState = vi.fn(states.getNodeState);
    const hasSubscribers = vi.fn(() => true);
    const { environment } = createClock();
    const controller = createRuntimeRefreshPolicyController({
      graph,
      environment,
      changes,
      getNodeState,
      hasSubscribers,
      refreshPolicyNode: async () => undefined,
      failPolicyNode: () => undefined,
    });
    getNodeState.mockClear();

    const state = states.getNodeState("node:42");
    succeedAttempt(state, 1);
    invalidate(state);
    controller.reconcile(changes.takeChanges());
    expect(getNodeState.mock.calls.every(([key]) => key === "node:42")).toBe(true);
    expect(getNodeState).toHaveBeenCalled();

    getNodeState.mockClear();
    controller.reconcile(changes.takeChanges());
    expect(getNodeState).not.toHaveBeenCalled();

    controller.reconcile();
    expect(getNodeState.mock.calls.length).toBeGreaterThanOrEqual(100);
  });

  it("records demand changes for policy nodes and ignores other keys", () => {
    const node = defineDataNode({
      key: "demand",
      initialValue: 0,
      load: async () => 1,
      refresh: staleAfter({ durationMs: 1_000 }),
    });
    const graph = createGraph({ nodes: [node] });
    const states = createRuntimeStateStore(graph);
    const changes = createNodeChangeTracker();
    const getNodeState = vi.fn(states.getNodeState);
    createRuntimeRefreshPolicyController({
      graph,
      environment: createClock().environment,
      changes,
      getNodeState,
      hasSubscribers: () => true,
      refreshPolicyNode: async () => undefined,
      failPolicyNode: () => undefined,
    });

    changes.markDemandChanged(["demand", "not-registered"]);

    expect(changes.takeChanges()).toEqual(["demand"]);
  });

  it("stops recording once the controller is disposed", () => {
    const node = defineDataNode({
      key: "disposed",
      initialValue: 0,
      load: async () => 1,
      refresh: staleAfter({ durationMs: 1_000 }),
    });
    const graph = createGraph({ nodes: [node] });
    const states = createRuntimeStateStore(graph);
    const changes = createNodeChangeTracker();
    const controller = createRuntimeRefreshPolicyController({
      graph,
      environment: createClock().environment,
      changes,
      getNodeState: states.getNodeState,
      hasSubscribers: () => true,
      refreshPolicyNode: async () => undefined,
      failPolicyNode: () => undefined,
    });

    controller.dispose();
    succeedAttempt(states.getNodeState("disposed"), 1);

    expect(changes.takeChanges()).toEqual([]);
  });

  it("arms a timer only for demanded policy nodes, including ones demanded through a dependent", async () => {
    const clock = createClock();
    const root = defineContextNode({ key: "incremental.root", initialValue: 0 });
    const policyNodes = Array.from({ length: 50 }, (_, index) =>
      defineDataNode({
        key: `incremental.data:${index}`,
        dependencies: [root],
        initialValue: 0,
        load: async ({ get }) => get(root),
        refresh: staleAfter({ durationMs: 1_000 }),
      }),
    );
    const leaves = policyNodes.map((parent, index) =>
      defineDerivedNode({
        key: `incremental.leaf:${index}`,
        dependencies: [parent],
        derive: ({ get }) => get(parent),
      }),
    );
    const runtime = createGraphRuntime(createGraph({ nodes: [root, ...policyNodes, ...leaves] }), {
      timerEnvironment: clock.environment,
    });

    // Demand reaches the policy node only as a required ancestor of the leaf.
    const subscription = runtime.subscribeNodes([leaves[7]!]);
    await runtime.whenSettled();
    await waitForCondition(() => clock.timerCount() === 1, "one stale-after timer");
    expect(runtime.getState(leaves[7]!).data).toBe(0);
    expect(clock.timerCount()).toBe(1);

    subscription.unsubscribe();
    expect(clock.timerCount()).toBe(0);
    runtime.shutdown();
  });

  it("re-arms the timer after the node reloads for a new context value", async () => {
    const clock = createClock();
    const root = defineContextNode({ key: "rearm.root", initialValue: 0 });
    const node = defineDataNode({
      key: "rearm.data",
      dependencies: [root],
      initialValue: 0,
      load: async ({ get }) => get(root),
      refresh: staleAfter({ durationMs: 1_000 }),
    });
    const runtime = createGraphRuntime(createGraph({ nodes: [root, node] }), {
      timerEnvironment: clock.environment,
    });
    const subscription = runtime.subscribeNodes([node]);
    await runtime.whenSettled();
    expect(clock.timerCount()).toBe(1);

    runtime.setContext(root, 1);
    expect(clock.timerCount()).toBe(0);
    await runtime.whenSettled();
    await waitForCondition(() => clock.timerCount() === 1, "timer re-armed after reload");

    subscription.unsubscribe();
    runtime.shutdown();
  });
});
