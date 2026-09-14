import type { RefreshPolicyEnvironment } from "./types";

export const createDefaultRefreshPolicyEnvironment = (): RefreshPolicyEnvironment =>
  Object.freeze({
    now: () => Date.now(),
    setTimeout: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
    random: () => Math.random(),
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  });
