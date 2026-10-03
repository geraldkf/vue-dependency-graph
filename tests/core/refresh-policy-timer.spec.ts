import { describe, expect, it, vi } from "vitest";
import { createPolicyTimer } from "../../src/core/refresh-policies/timer";
import type { TimerEnvironment } from "../../src/core/timer-environment";

const createClock = () => {
  let now = 0;
  const callbacks: (() => void)[] = [];
  const clearTimeout = vi.fn();
  const environment: TimerEnvironment = {
    now: () => now,
    setTimeout: (callback) => callbacks.push(callback),
    clearTimeout,
    random: () => 0,
    isPaused: () => false,
    onPauseChange: () => () => undefined,
  };
  return { environment, callbacks, clearTimeout, advance: (time: number) => (now = time) };
};

describe("refresh policy timer cancellation", () => {
  it("preserves the remaining delay across pause and ignores the old queued callback", () => {
    const clock = createClock();
    const timer = createPolicyTimer<"retry">(clock.environment);
    const work = vi.fn();
    timer.arm(100, "retry", work);
    clock.advance(40);
    timer.pause();
    expect(clock.clearTimeout).toHaveBeenCalledWith(1);
    expect(timer.getState()).toEqual({ status: "pending", purpose: "retry", remainingDelayMs: 60 });
    clock.advance(1000);
    timer.resume(work);
    expect(timer.getState()).toMatchObject({ status: "armed", purpose: "retry", dueAt: 1060 });
    clock.callbacks[0]?.();
    expect(work).not.toHaveBeenCalled();
    expect(timer.getState().status).toBe("armed");
    clock.callbacks[1]?.();
    clock.callbacks[1]?.();
    expect(work).toHaveBeenCalledExactlyOnceWith("retry");
    expect(timer.getState()).toEqual({ status: "idle" });
  });

  it("cancels pending work and protects a newly armed timer from canceled callbacks", () => {
    const clock = createClock();
    const timer = createPolicyTimer<"interval" | "retry">(clock.environment);
    const work = vi.fn();
    timer.defer(50, "retry");
    timer.clear();
    timer.resume(work);
    expect(clock.callbacks).toHaveLength(0);
    timer.pause();
    timer.arm(20, "interval", work);
    timer.arm(30, "retry", work);
    timer.defer(30, "retry");
    expect(clock.callbacks).toHaveLength(1);
    timer.clear();
    timer.arm(30, "retry", work);
    clock.callbacks[0]?.();
    expect(work).not.toHaveBeenCalled();
    clock.callbacks[1]?.();
    expect(work).toHaveBeenCalledExactlyOnceWith("retry");
  });
});
