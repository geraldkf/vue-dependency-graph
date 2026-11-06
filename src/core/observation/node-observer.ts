import { createNodeChangeTracker } from "../state/change-tracker";
import type { NodeStateRecord } from "../state/state";
import type { RuntimeListener } from "./types";

export interface RuntimeNodeObserver {
  /** Registers a listener for one node key. Returns an idempotent unsubscribe. */
  readonly onNodeChange: (key: string, listener: RuntimeListener) => () => void;
  /**
   * Calls the listeners of every node whose state changed since the last
   * dispatch. Called by the runtime after its global listeners, once per
   * notification.
   */
  readonly dispatch: () => void;
  readonly dispose: () => void;
}

export interface RuntimeNodeObserverOptions {
  readonly getNodeState: (key: string) => NodeStateRecord;
  /** Same contract as the global observer's: failures are isolated and reported here. */
  readonly onListenerError?: (error: unknown) => void;
}

/**
 * Per-node change notification. A node is only tracked while it has at least
 * one listener, so a runtime with no node listeners pays nothing, and a
 * notification costs time proportional to the nodes that changed - not to the
 * number of listeners.
 */
export const createRuntimeNodeObserver = ({
  getNodeState,
  onListenerError,
}: RuntimeNodeObserverOptions): RuntimeNodeObserver => {
  const listenersByKey = new Map<string, Set<RuntimeListener>>();
  const changes = createNodeChangeTracker();

  const onNodeChange = (key: string, listener: RuntimeListener): (() => void) => {
    let listeners = listenersByKey.get(key);
    if (!listeners) {
      listeners = new Set();
      listenersByKey.set(key, listeners);
      changes.track(key, getNodeState(key));
    }
    listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = listenersByKey.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        listenersByKey.delete(key);
        changes.untrack(key);
      }
    };
  };

  const dispatch = (): void => {
    if (!changes.hasChanges()) return;
    for (const key of changes.takeChanges()) {
      const listeners = listenersByKey.get(key);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        // A listener removed by an earlier one in this dispatch is not called.
        if (!listeners.has(listener)) continue;
        try {
          listener();
        } catch (error) {
          try {
            onListenerError?.(error);
          } catch {
            // Reporting is observational; it must not break isolation either.
          }
        }
      }
    }
  };

  const dispose = (): void => {
    listenersByKey.clear();
    changes.dispose();
  };

  return Object.freeze({ onNodeChange, dispatch, dispose });
};
