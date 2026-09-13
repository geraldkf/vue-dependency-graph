import { describe, expect, it } from "vitest";
import { createExecutionConcurrencyLimiter } from "../../src/core/execution/concurrency-limiter";

describe("execution concurrency limiter", () => {
  it.each([0, -1, Number.NaN])(
    "rejects an invalid maximum of %s",
    maxConcurrent => {
      expect(() => createExecutionConcurrencyLimiter(maxConcurrent)).toThrow(
        "maxConcurrent must be at least 1"
      );
    }
  );

  it("acquires immediately while capacity is available and queues beyond it", async () => {
    const limiter = createExecutionConcurrencyLimiter(2);
    const first = new AbortController();
    const second = new AbortController();
    const third = new AbortController();

    await limiter.acquire(first.signal);
    await limiter.acquire(second.signal);

    let thirdAcquired = false;
    const thirdAcquisition = limiter.acquire(third.signal).then(() => {
      thirdAcquired = true;
    });

    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    limiter.release();
    await thirdAcquisition;
    expect(thirdAcquired).toBe(true);

    limiter.release();
    limiter.release();
  });

  it("grants queued acquisitions in FIFO order", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    const first = new AbortController();
    const second = new AbortController();
    const third = new AbortController();
    const acquired: string[] = [];

    await limiter.acquire(first.signal);

    const secondAcquisition = limiter.acquire(second.signal).then(() => {
      acquired.push("second");
    });
    const thirdAcquisition = limiter.acquire(third.signal).then(() => {
      acquired.push("third");
    });

    limiter.release();
    await secondAcquisition;
    expect(acquired).toEqual(["second"]);

    limiter.release();
    await thirdAcquisition;
    expect(acquired).toEqual(["second", "third"]);

    limiter.release();
  });

  it("removes an aborted waiter and grants the slot to the next waiter", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    const first = new AbortController();
    const aborted = new AbortController();
    const next = new AbortController();

    await limiter.acquire(first.signal);

    const abortedAcquisition = limiter.acquire(aborted.signal);
    const nextAcquisition = limiter.acquire(next.signal);
    aborted.abort();

    await expect(abortedAcquisition).rejects.toMatchObject({
      name: "AbortError",
    });

    limiter.release();
    await expect(nextAcquisition).resolves.toBeUndefined();

    limiter.release();
  });

  it("rejects an already-aborted signal without consuming capacity", async () => {
    const limiter = createExecutionConcurrencyLimiter(1);
    const aborted = new AbortController();
    const available = new AbortController();
    aborted.abort();

    await expect(limiter.acquire(aborted.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(limiter.acquire(available.signal)).resolves.toBeUndefined();

    limiter.release();
  });
});
