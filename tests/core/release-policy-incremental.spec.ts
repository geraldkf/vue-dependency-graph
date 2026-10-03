import { describe, expect, it, vi } from "vitest";
import { createGraph, defineDataNode, type TimerEnvironment } from "../../src/core";
import { createRuntimeReleasePolicyController } from "../../src/core/release-policies/policy-controller";
import { createNodeChangeTracker } from "../../src/core/state/change-tracker";
import { createRuntimeStateStore } from "../../src/core/state/state";
import { invalidate, succeedAttempt } from "../../src/core/state/transitions";

describe("incremental release reconciliation", () => {
  it("reconsiders only changed nodes and deduplicates transitions within a commit", () => {
    const nodes = Array.from({ length: 100 }, (_, i) =>
      defineDataNode({ key: `node:${i}`, initialValue: 0, release: 100, load: async () => 1 }),
    );
    const graph = createGraph({ nodes });
    const states = createRuntimeStateStore(graph);
    const changes = createNodeChangeTracker();
    const getNodeState = vi.fn(states.getNodeState);
    const hasSubscribers = vi.fn(() => false);
    const environment: TimerEnvironment = {
      now: () => 0,
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      random: () => 0,
      isPaused: () => false,
      onPauseChange: () => () => undefined,
    };
    const controller = createRuntimeReleasePolicyController({
      graph,
      changes,
      environment,
      getNodeState,
      hasSubscribers,
      defaultDurationMs: undefined,
      notify: () => undefined,
    });
    controller.reconcile();
    getNodeState.mockClear();
    hasSubscribers.mockClear();

    const state = states.getNodeState("node:42");
    succeedAttempt(state, 1);
    invalidate(state);
    controller.reconcile(changes.takeChanges());
    expect(getNodeState).toHaveBeenCalledExactlyOnceWith("node:42");
    expect(hasSubscribers).toHaveBeenCalledTimes(1);
    expect(environment.setTimeout).toHaveBeenCalledTimes(1);

    getNodeState.mockClear();
    controller.reconcile(changes.takeChanges());
    expect(getNodeState).not.toHaveBeenCalled();

    changes.markDemandChanged(["node:42", "not-registered", "node:42"]);
    hasSubscribers.mockReturnValue(true);
    controller.reconcile(changes.takeChanges());
    expect(getNodeState).toHaveBeenCalledExactlyOnceWith("node:42");
    expect(environment.clearTimeout).toHaveBeenCalledWith(1);

    controller.dispose();
    succeedAttempt(state, 2);
    changes.markDemandChanged(["node:42"]);
    expect(changes.takeChanges()).toEqual([]);
  });
});
