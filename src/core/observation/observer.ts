import type { RuntimeListener } from "./types";

export interface RuntimeObserver {
  readonly onChange: (listener: RuntimeListener) => () => void;
  readonly notify: () => void;
}

export interface RuntimeObserverOptions {
  /**
   * Called with the thrown value when a listener throws. The failure is
   * always isolated - it never reaches the remaining listeners or the code
   * that triggered the notification - and this callback is how it is
   * reported. If the callback itself throws, that is isolated too.
   */
  readonly onListenerError?: (error: unknown) => void;
}

export const createRuntimeObserver = (
  options?: RuntimeObserverOptions,
): RuntimeObserver => {
  const listeners = new Set<RuntimeListener>();
  const onListenerError = options?.onListenerError;

  const notify = (): void => {
    for (const listener of [...listeners]) {
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
