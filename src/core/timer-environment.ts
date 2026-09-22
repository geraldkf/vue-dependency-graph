/**
 * Clock and timer services injected into the refresh-policy and
 * release-policy controllers. Both controllers need exactly the same
 * shape - a clock, a settable/clearable timer, a random source for
 * jitter, and a pause signal - so this is shared rather than duplicated
 * per controller. Tests inject a deterministic implementation; runtimes
 * default to `createDefaultTimerEnvironment()`, which uses real platform
 * timers.
 */
export interface TimerEnvironment {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly random: () => number;
  readonly isPaused: () => boolean;
  readonly onPauseChange: (listener: (paused: boolean) => void) => () => void;
}

export const createDefaultTimerEnvironment = (): TimerEnvironment =>
  Object.freeze({
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    random: () => Math.random(),
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  });
