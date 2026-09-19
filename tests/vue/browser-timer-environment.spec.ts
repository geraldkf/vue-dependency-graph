import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserTimerEnvironment } from "../../src/vue";

describe("browser refresh policy environment", () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState"
  );
  const originalOnline = Object.getOwnPropertyDescriptor(navigator, "onLine");

  afterEach(() => {
    if (originalVisibility) {
      Object.defineProperty(document, "visibilityState", originalVisibility);
    }
    if (originalOnline) {
      Object.defineProperty(navigator, "onLine", originalOnline);
    }
  });

  const setVisibility = (value: DocumentVisibilityState): void => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value,
    });
  };

  const setOnline = (value: boolean): void => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value,
    });
  };

  it("pauses while hidden or offline by default", () => {
    const environment = createBrowserTimerEnvironment();

    setVisibility("visible");
    setOnline(true);
    expect(environment.isPaused()).toBe(false);

    setVisibility("hidden");
    expect(environment.isPaused()).toBe(true);

    setVisibility("visible");
    setOnline(false);
    expect(environment.isPaused()).toBe(true);
  });

  it("supports opting out of visibility and network pause signals", () => {
    setVisibility("hidden");
    setOnline(false);
    const environment = createBrowserTimerEnvironment({
      pauseWhenHidden: false,
      pauseWhenOffline: false,
    });

    expect(environment.isPaused()).toBe(false);
  });

  it("notifies only when the combined pause state changes and cleans up", () => {
    setVisibility("visible");
    setOnline(true);
    const listener = vi.fn();
    const environment = createBrowserTimerEnvironment();
    const dispose = environment.onPauseChange(listener);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenLastCalledWith(true);

    setOnline(false);
    globalThis.dispatchEvent(new Event("offline"));
    expect(listener).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);

    setOnline(true);
    globalThis.dispatchEvent(new Event("online"));
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(2);

    dispose();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
