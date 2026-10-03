import type { NodeStateRecord } from "./state";

interface TrackedState {
  readonly key: string;
  readonly pending: Set<string>;
}

// Weak keys keep this bookkeeping from extending a runtime state's lifetime.
const trackedStates = new WeakMap<NodeStateRecord, TrackedState>();

/** Records a transition without notifying observers or running policy work. */
export const markStateChanged = (state: NodeStateRecord): void => {
  const tracked = trackedStates.get(state);
  if (tracked) tracked.pending.add(tracked.key);
};

/** One consumer owns and drains a deduplicated set of changed node keys. */
export const createNodeChangeTracker = () => {
  const states = new Map<string, NodeStateRecord>();
  const pending = new Set<string>();
  return Object.freeze({
    track: (key: string, state: NodeStateRecord): void => {
      states.set(key, state);
      trackedStates.set(state, { key, pending });
    },
    markDemandChanged: (keys: Iterable<string>): void => {
      for (const key of keys) if (states.has(key)) pending.add(key);
    },
    takeChanges: (): readonly string[] => {
      const keys = [...pending];
      pending.clear();
      return keys;
    },
    dispose: (): void => {
      for (const state of states.values()) trackedStates.delete(state);
      states.clear();
      pending.clear();
    },
  });
};

export type NodeChangeTracker = ReturnType<typeof createNodeChangeTracker>;
