import type { GraphExecutionReason } from "../diagnostics/types";

/**
 * The scheduler's `schedule()` takes no arguments: it runs on a microtask
 * and, when it flushes, needs to know *why* it was asked to run so
 * diagnostics can attribute the run correctly. Because the trigger
 * (subscription add, context write, changed-result invalidation, ...) and
 * the flush happen at different times, that "why" has to live in shared
 * mutable state between them. This tracker is that state, given a small
 * explicit API instead of bare outer-scope `let`s.
 */
export interface SchedulerRequestTracker {
  /** Records the reason/cause for the next scheduler flush. */
  readonly request: (
    reason: GraphExecutionReason,
    causeId: string | undefined,
  ) => void;
  /** Reads the current reason/cause without clearing it. */
  readonly peek: () => {
    readonly reason: GraphExecutionReason;
    readonly causeId: string | undefined;
  };
  /** Restores the default reason once a flush has completed. */
  readonly reset: () => void;
}

export const createSchedulerRequestTracker = (
  defaultReason: GraphExecutionReason,
): SchedulerRequestTracker => {
  let reason = defaultReason;
  let causeId: string | undefined;

  return Object.freeze({
    request: (nextReason: GraphExecutionReason, nextCauseId: string | undefined) => {
      reason = nextReason;
      causeId = nextCauseId;
    },
    peek: () => Object.freeze({ reason, causeId }),
    reset: () => {
      reason = defaultReason;
      causeId = undefined;
    },
  });
};
