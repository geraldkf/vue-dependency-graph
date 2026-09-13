import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockLoader } from "../../src/playground/mock-loader";

describe("createMockLoader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments callCount on every load", async () => {
    const loader = createMockLoader({ delayMs: 100 });

    const first = loader.load(() => 1);
    expect(loader.callCount.value).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toBe(1);

    const second = loader.load(() => 2);
    expect(loader.callCount.value).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    await expect(second).resolves.toBe(2);
  });

  it("waits the configured delay before resolving", async () => {
    const loader = createMockLoader({ delayMs: 500 });
    let resolved = false;

    void loader.load(() => "value").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("rejects when shouldFail is toggled on", async () => {
    const loader = createMockLoader({ delayMs: 10 });
    loader.shouldFail.value = true;

    const promise = loader.load(() => "value");
    // Attach the rejection assertion before advancing fake timers, not
    // after — otherwise the promise can reject during the timer advance,
    // before anything is listening, and vitest reports an unhandled
    // rejection even though it's handled a line later.
    const assertion = expect(promise).rejects.toThrow("Mock loader failure");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("resolves again once shouldFail is toggled back off", async () => {
    const loader = createMockLoader({ delayMs: 10 });
    loader.shouldFail.value = true;

    const failing = loader.load(() => "value");
    const failingAssertion = expect(failing).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    await failingAssertion;

    loader.shouldFail.value = false;
    const succeeding = loader.load(() => "value");
    await vi.advanceTimersByTimeAsync(10);
    await expect(succeeding).resolves.toBe("value");
  });

  it("uses produce() to supply the value rather than a fixed value of its own", async () => {
    const loader = createMockLoader({ delayMs: 0 });
    let counter = 0;
    const produce = (): number => {
      counter += 1;
      return counter;
    };

    const first = loader.load(produce);
    await vi.advanceTimersByTimeAsync(0);
    await expect(first).resolves.toBe(1);

    const second = loader.load(produce);
    await vi.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toBe(2);
  });
});
