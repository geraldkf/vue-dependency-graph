import type { NodeStateRecord } from "./state";

interface TrackedState {
  readonly key: string;
  readonly pending: Set<string>;
}

// Weak keys keep this bookkeeping from extending a runtime state's lifetime.
// A state can have several consumers (release policies, refresh policies,
// per-node listeners), each with its own pending set, so each transition
// records into every one of them.
const trackedStates = new WeakMap<NodeStateRecord, TrackedState[]>();

/** Records a transition without notifying observers or running policy work. */
export const markStateChanged = (state: NodeStateRecord): void => {
  const tracked = trackedStates.get(state);
  if (tracked) for (const entry of tracked) entry.pending.add(entry.key);
};

/** One consumer owns and drains a deduplicated set of changed node keys. */
export const createNodeChangeTracker = () => {
  const states = new Map<string, NodeStateRecord>();
  const pending = new Set<string>();

  const release = (state: NodeStateRecord): void => {
    const remaining = trackedStates.get(state)?.filter((entry) => entry.pending !== pending);
    if (remaining && remaining.length > 0) trackedStates.set(state, remaining);
    else trackedStates.delete(state);
  };

  return Object.freeze({
    track: (key: string, state: NodeStateRecord): void => {
      if (states.has(key)) return;
      states.set(key, state);
      const entry: TrackedState = { key, pending };
      const existing = trackedStates.get(state);
      if (existing) existing.push(entry);
      else trackedStates.set(state, [entry]);
    },
    /** Stops recording changes for one key and forgets any pending change. */
    untrack: (key: string): void => {
      const state = states.get(key);
      if (!state) return;
      states.delete(key);
      pending.delete(key);
      release(state);
    },
    markDemandChanged: (keys: Iterable<string>): void => {
      for (const key of keys) if (states.has(key)) pending.add(key);
    },
    hasChanges: (): boolean => pending.size > 0,
    takeChanges: (): readonly string[] => {
      const keys = [...pending];
      pending.clear();
      return keys;
    },
    dispose: (): void => {
      for (const state of states.values()) release(state);
      states.clear();
      pending.clear();
    },
  });
};

export type NodeChangeTracker = ReturnType<typeof createNodeChangeTracker>;
