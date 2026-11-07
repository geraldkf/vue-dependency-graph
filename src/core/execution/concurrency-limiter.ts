export interface ExecutionConcurrencyLimiter {
  readonly acquire: (signal: AbortSignal, onQueued?: () => void) => Promise<void>;
  readonly release: () => void;
}

interface QueuedAcquisition {
  readonly grant: () => boolean;
}

const createAbortError = (message: string): Error => {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
};

export const createExecutionConcurrencyLimiter = (
  maxConcurrent: number,
): ExecutionConcurrencyLimiter => {
  if (Number.isNaN(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be at least 1.");
  }

  let active = 0;
  // A Set keeps insertion order and removes in constant time, so aborting a
  // long queue of waiters is linear, not quadratic.
  const queue = new Set<QueuedAcquisition>();

  const acquire = (signal: AbortSignal, onQueued?: () => void): Promise<void> => {
    if (signal.aborted) {
      return Promise.reject(createAbortError("Aborted before acquiring a concurrency slot."));
    }

    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }

    onQueued?.();
    return new Promise<void>((resolve, reject) => {
      let queued = true;

      const onAbort = (): void => {
        if (!queued) return;
        queued = false;
        queue.delete(entry);
        reject(createAbortError("Aborted while waiting for a concurrency slot."));
      };

      const entry: QueuedAcquisition = {
        grant: (): boolean => {
          if (!queued) return false;

          queued = false;
          signal.removeEventListener("abort", onAbort);

          if (signal.aborted) {
            reject(createAbortError("Aborted while waiting for a concurrency slot."));
            return false;
          }

          active += 1;
          resolve();
          return true;
        },
      };

      signal.addEventListener("abort", onAbort, { once: true });
      queue.add(entry);
    });
  };

  const release = (): void => {
    if (active === 0) {
      throw new Error("Cannot release a concurrency slot that is not active.");
    }

    active -= 1;

    for (const next of queue) {
      queue.delete(next);
      if (next.grant()) return;
    }
  };

  return Object.freeze({ acquire, release });
};
