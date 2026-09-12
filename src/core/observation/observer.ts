import type { RuntimeListener } from "./types";

export interface RuntimeObserver {
  readonly onChange: (listener: RuntimeListener) => () => void;
  readonly notify: () => void;
}

export const createRuntimeObserver = (): RuntimeObserver => {
  const listeners = new Set<RuntimeListener>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Listener failures are isolated from runtime state and other listeners.
      }
    }
  };

  const onChange = (listener: RuntimeListener): (() => void) => {
    listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  };

  return Object.freeze({
    onChange,
    notify,
  });
};
