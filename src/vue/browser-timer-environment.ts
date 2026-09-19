import type { TimerEnvironment } from "../core";

export interface BrowserTimerEnvironmentOptions {
  readonly pauseWhenHidden?: boolean;
  readonly pauseWhenOffline?: boolean;
}

export const createBrowserTimerEnvironment = (
  options?: BrowserTimerEnvironmentOptions
): TimerEnvironment => {
  const pauseWhenHidden = options?.pauseWhenHidden ?? true;
  const pauseWhenOffline = options?.pauseWhenOffline ?? true;
  const isPaused = (): boolean =>
    (pauseWhenHidden && document.visibilityState === "hidden") ||
    (pauseWhenOffline && !navigator.onLine);

  return Object.freeze({
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>
      ),
    random: () => Math.random(),
    isPaused,
    onPauseChange: (listener: (paused: boolean) => void) => {
      let previous = isPaused();
      const notifyWhenChanged = (): void => {
        const next = isPaused();
        if (next === previous) return;
        previous = next;
        listener(next);
      };
      document.addEventListener("visibilitychange", notifyWhenChanged);
      globalThis.addEventListener("online", notifyWhenChanged);
      globalThis.addEventListener("offline", notifyWhenChanged);
      return () => {
        document.removeEventListener("visibilitychange", notifyWhenChanged);
        globalThis.removeEventListener("online", notifyWhenChanged);
        globalThis.removeEventListener("offline", notifyWhenChanged);
      };
    },
  });
};
