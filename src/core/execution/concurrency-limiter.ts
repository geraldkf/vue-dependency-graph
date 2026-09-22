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
  const queue: QueuedAcquisition[] = [];

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

      const removeFromQueue = (): void => {
        const index = queue.indexOf(entry);
        if (index !== -1) queue.splice(index, 1);
      };

      const onAbort = (): void => {
        if (!queued) return;
        queued = false;
        removeFromQueue();
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
      queue.push(entry);
    });
  };

  const release = (): void => {
    if (active === 0) {
      throw new Error("Cannot release a concurrency slot that is not active.");
    }

    active -= 1;

    while (queue.length > 0) {
      const next = queue.shift();
      if (next?.grant()) return;
    }
  };

  return Object.freeze({ acquire, release });
};
