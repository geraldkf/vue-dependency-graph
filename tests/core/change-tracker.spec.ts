import { describe, expect, it } from "vitest";
import { createGraph, defineDataNode } from "../../src/core";
import { createNodeChangeTracker } from "../../src/core/state/change-tracker";
import { createRuntimeStateStore } from "../../src/core/state/state";
import { invalidate, succeedAttempt } from "../../src/core/state/transitions";

const setup = () => {
  const nodes = ["a", "b", "c"].map((key) =>
    defineDataNode({ key, initialValue: 0, load: async () => 1 }),
  );
  const store = createRuntimeStateStore(createGraph({ nodes }));
  return { store, state: (key: string) => store.getNodeState(key) };
};

describe("node change tracker", () => {
  it("records a transition only for tracked states, deduplicated", () => {
    const { state } = setup();
    const tracker = createNodeChangeTracker();
    tracker.track("a", state("a"));

    succeedAttempt(state("a"), 1);
    invalidate(state("a"));
    succeedAttempt(state("b"), 1);

    expect(tracker.hasChanges()).toBe(true);
    expect(tracker.takeChanges()).toEqual(["a"]);
    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.takeChanges()).toEqual([]);
  });

  it("lets several trackers record the same transition independently", () => {
    const { state } = setup();
    const first = createNodeChangeTracker();
    const second = createNodeChangeTracker();
    first.track("a", state("a"));
    second.track("a", state("a"));

    succeedAttempt(state("a"), 1);

    expect(first.takeChanges()).toEqual(["a"]);
    expect(second.hasChanges()).toBe(true);
    expect(second.takeChanges()).toEqual(["a"]);
  });

  it("stops one tracker without affecting another tracking the same state", () => {
    const { state } = setup();
    const first = createNodeChangeTracker();
    const second = createNodeChangeTracker();
    first.track("a", state("a"));
    second.track("a", state("a"));

    first.dispose();
    succeedAttempt(state("a"), 1);

    expect(first.takeChanges()).toEqual([]);
    expect(second.takeChanges()).toEqual(["a"]);
  });

  it("untrack stops recording one key and drops its pending change", () => {
    const { state } = setup();
    const tracker = createNodeChangeTracker();
    tracker.track("a", state("a"));
    tracker.track("b", state("b"));
    succeedAttempt(state("a"), 1);
    succeedAttempt(state("b"), 1);

    tracker.untrack("a");
    succeedAttempt(state("a"), 2);

    expect(tracker.takeChanges()).toEqual(["b"]);
    expect(() => tracker.untrack("a")).not.toThrow();
    expect(() => tracker.untrack("never-tracked")).not.toThrow();
  });

  it("tracking the same key twice is harmless", () => {
    const { state } = setup();
    const tracker = createNodeChangeTracker();
    tracker.track("a", state("a"));
    tracker.track("a", state("a"));

    succeedAttempt(state("a"), 1);
    tracker.untrack("a");
    succeedAttempt(state("a"), 2);

    expect(tracker.takeChanges()).toEqual([]);
  });

  it("markDemandChanged only records tracked keys", () => {
    const { state } = setup();
    const tracker = createNodeChangeTracker();
    tracker.track("a", state("a"));

    tracker.markDemandChanged(["a", "b", "not-registered", "a"]);

    expect(tracker.takeChanges()).toEqual(["a"]);
  });

  it("dispose clears pending changes and stops recording", () => {
    const { state } = setup();
    const tracker = createNodeChangeTracker();
    tracker.track("a", state("a"));
    succeedAttempt(state("a"), 1);

    tracker.dispose();
    succeedAttempt(state("a"), 2);

    expect(tracker.hasChanges()).toBe(false);
    expect(tracker.takeChanges()).toEqual([]);
  });
});
