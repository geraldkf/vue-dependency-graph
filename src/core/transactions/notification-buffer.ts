export interface NotificationBufferSinks {
  readonly notify: () => void;
  readonly schedule: () => void;
  readonly resolveSettlementIfIdle: () => void;
  readonly whenSettled: () => Promise<void>;
}

export interface RuntimeNotificationBuffer {
  /** Drop-in replacement for the raw observer notify. */
  readonly notify: () => void;
  /** Drop-in replacement for the raw scheduler schedule. */
  readonly schedule: () => void;
  /** Drop-in replacement for the raw scheduler settlement check. */
  readonly resolveSettlementIfIdle: () => void;
  /**
   * Drop-in replacement for the raw scheduler whenSettled. Mid-transaction,
   * the real scheduler can look idle even though a schedule() call is
   * sitting deferred in this buffer — so a call made while a transaction is
   * open waits for that transaction to commit (and for the schedule it
   * dispatches, if any, to actually settle) before resolving.
   */
  readonly whenSettled: () => Promise<void>;
  /**
   * Runs `work`, deferring notify/schedule/settlement dispatch until the
   * outermost transaction completes. Supports async work: depth stays open
   * across any awaited gap inside `work`. Nested calls collapse into the
   * outermost transaction's single commit.
   */
  readonly runTransaction: <T>(work: () => T | Promise<T>) => Promise<T>;
}

/**
 * Buffers notify/schedule/settlement dispatch behind a depth counter.
 *
 * Outside a transaction (depth === 0) every call passes straight through to
 * the real sink, synchronously, in the same order as before this seam
 * existed — this wrapper is only ever observable when a transaction is
 * open. It does not buffer or roll back state mutations; those are already
 * committed directly by the calling capability before notify/schedule are
 * invoked. This buffer only controls when observers are told about it.
 */
export const createRuntimeNotificationBuffer = (
  sinks: NotificationBufferSinks
): RuntimeNotificationBuffer => {
  let depth = 0;
  let notifyPending = false;
  let schedulePending = false;
  let settlementWaiters: Array<() => void> = [];

  const notify = (): void => {
    if (depth > 0) {
      notifyPending = true;
      return;
    }
    sinks.notify();
  };

  const schedule = (): void => {
    if (depth > 0) {
      schedulePending = true;
      return;
    }
    sinks.schedule();
  };

  const resolveSettlementIfIdle = (): void => {
    if (depth > 0) return;
    sinks.resolveSettlementIfIdle();
  };

  const whenSettled = (): Promise<void> => {
    if (depth === 0) return sinks.whenSettled();
    return new Promise<void>(resolve => {
      settlementWaiters.push(resolve);
    });
  };

  const commit = (): void => {
    const shouldNotify = notifyPending;
    const shouldSchedule = schedulePending;
    const waiters = settlementWaiters;
    notifyPending = false;
    schedulePending = false;
    settlementWaiters = [];

    if (shouldNotify) sinks.notify();
    if (shouldSchedule) sinks.schedule();
    // Always re-checked on commit: a settlement check made mid-transaction
    // (e.g. from an unsubscribe) must be re-evaluated against the final
    // post-commit scheduler state, not the transient mid-transaction one.
    sinks.resolveSettlementIfIdle();

    if (waiters.length > 0) {
      // Chain onto the real scheduler settlement so a whenSettled() call
      // made mid-transaction also waits out whatever async work the
      // commit's schedule() dispatch kicks off, not just the commit itself.
      void sinks.whenSettled().then(() => {
        for (const resolve of waiters) resolve();
      });
    }
  };

  const runTransaction = async <T>(
    work: () => T | Promise<T>
  ): Promise<T> => {
    depth += 1;
    try {
      return await work();
    } finally {
      depth -= 1;
      if (depth === 0) commit();
    }
  };

  return Object.freeze({
    notify,
    schedule,
    resolveSettlementIfIdle,
    whenSettled,
    runTransaction,
  });
};
