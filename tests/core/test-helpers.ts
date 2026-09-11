export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

/**
 * Waits for asynchronous graph work to reach an observable condition without
 * relying on a fixed number of microtask turns or real-time delays.
 */
export const waitForCondition = async (
  condition: () => boolean,
  description: string,
  maximumTurns = 50
): Promise<void> => {
  for (let turn = 0; turn < maximumTurns; turn += 1) {
    if (condition()) return;
    await Promise.resolve();
  }

  throw new Error(`Condition was not reached: ${description}`);
};
