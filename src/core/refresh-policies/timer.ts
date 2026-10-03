import type { TimerEnvironment } from "../timer-environment";

export type PolicyTimerState<TPurpose extends string> =
  | { readonly status: "idle" }
  | {
      readonly status: "armed";
      readonly purpose: TPurpose;
      readonly dueAt: number;
      readonly handle: unknown;
    }
  | { readonly status: "pending"; readonly purpose: TPurpose; readonly remainingDelayMs: number };

/** Owns one timer and invalidates callbacks after cancellation or pause. */
export const createPolicyTimer = <TPurpose extends string>(environment: TimerEnvironment) => {
  let state: PolicyTimerState<TPurpose> = { status: "idle" };
  let token = 0;
  const clear = (): void => {
    token += 1;
    if (state.status === "armed") environment.clearTimeout(state.handle);
    state = { status: "idle" };
  };
  const defer = (remainingDelayMs: number, purpose: TPurpose): void => {
    if (state.status !== "armed") state = { status: "pending", purpose, remainingDelayMs };
  };
  const pause = (): void => {
    if (state.status !== "armed") return;
    const { purpose, dueAt } = state;
    clear();
    defer(Math.max(0, dueAt - environment.now()), purpose);
  };
  const arm = (delayMs: number, purpose: TPurpose, work: (purpose: TPurpose) => void): void => {
    if (state.status === "armed") return;
    const currentToken = ++token;
    const dueAt = environment.now() + delayMs;
    const handle = environment.setTimeout(() => {
      if (token !== currentToken || state.status !== "armed") return;
      state = { status: "idle" };
      work(purpose);
    }, delayMs);
    state = { status: "armed", purpose, dueAt, handle };
  };
  const resume = (work: (purpose: TPurpose) => void): void => {
    if (state.status === "pending") arm(state.remainingDelayMs, state.purpose, work);
  };
  return Object.freeze({ getState: () => state, clear, defer, arm, pause, resume });
};
