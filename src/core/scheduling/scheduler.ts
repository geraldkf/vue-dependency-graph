import { toError } from "../execution/types";
import type { AnyNodeDefinition } from "../graph/types";
import type { SchedulerState } from "./types";

export interface RuntimeSchedulerController {
  readonly schedule: () => void;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly resolveSettlementIfIdle: () => void;
}

/**
 * What one flush needs from the moment it starts to the moment it finishes:
 * a diagnostic context to execute its targets with, and a callback to report
 * how it ended.
 */
export interface SchedulerFlush<TContext> {
  readonly context: TContext;
  readonly complete: (error: Error | null) => void;
}

export interface RuntimeSchedulerDependencies<TContext> {
  readonly getTargetsNeedingWork: () => readonly AnyNodeDefinition[];
  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    context: TContext,
  ) => Promise<void>;
  readonly notify: () => void;
  readonly onRequested?: () => void;
  /**
   * Called synchronously when a flush is about to start, with the targets it
   * is about to execute. Returns the diagnostic context for this flush and a
   * callback for how it ends; both are specific to this one flush, never
   * shared with another.
   */
  readonly beginFlush: (
    targets: readonly AnyNodeDefinition[],
  ) => SchedulerFlush<TContext>;
}

/**
 * Requests made in the same synchronous turn still coalesce into one flush,
 * as before. What changed: a flush no longer blocks the next one. Work
 * requested while earlier flushes are still executing starts in its own
 * flush at the next microtask, instead of waiting behind them.
 *
 * Overlap is safe because nothing here is shared mutable per-flush state:
 * - `getTargetsNeedingWork` already excludes a node with a load already in
 *   flight (`graph-coordination.ts` checks the active-attempt table), so two
 *   flushes never target the same node;
 * - each flush gets its own diagnostic context from `beginFlush`, so
 *   concurrent flushes never share or overwrite one another's attribution;
 * - `notify` and the settlement waiters are plain shared state, and are fine
 *   to touch from multiple flushes: `inFlight` is a count, not a flag, and
 *   settlement only requires everything to have finished.
 *
 * `error` reports the most recently *finished* flush's outcome - a snapshot
 * of the last thing that happened, not "any flush has ever failed" - and is
 * cleared to `null` whenever a flush finishes without error, whatever any
 * still-running flush later reports.
 */
export const createRuntimeSchedulerController = <TContext>({
  getTargetsNeedingWork,
  execute,
  notify,
  onRequested,
  beginFlush,
}: RuntimeSchedulerDependencies<TContext>): RuntimeSchedulerController => {
  const settlementWaiters = new Set<() => void>();
  let scheduled = false;
  let inFlight = 0;
  let error: Error | null = null;

  const isSettled = (): boolean => !scheduled && inFlight === 0;

  const resolveSettlementIfIdle = (): void => {
    if (!isSettled()) return;
    for (const resolve of [...settlementWaiters]) resolve();
    settlementWaiters.clear();
  };

  const getSchedulerState = (): SchedulerState =>
    Object.freeze({ isScheduled: scheduled, isRunning: inFlight > 0, error });

  const flush = (): void => {
    if (!scheduled) return;
    scheduled = false;

    const targets = getTargetsNeedingWork();
    if (targets.length === 0) {
      resolveSettlementIfIdle();
      return;
    }

    const { context, complete } = beginFlush(targets);
    inFlight += 1;
    notify();

    execute(targets, context)
      .then(
        () => {
          error = null;
          complete(null);
        },
        (thrown) => {
          error = toError(thrown);
          complete(error);
        },
      )
      .finally(() => {
        inFlight -= 1;
        notify();
        resolveSettlementIfIdle();
      });
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    notify();
    onRequested?.();
    queueMicrotask(flush);
  };

  const whenSettled = (): Promise<void> => {
    if (isSettled()) return Promise.resolve();
    return new Promise((resolve) => settlementWaiters.add(resolve));
  };

  return Object.freeze({
    schedule,
    getSchedulerState,
    whenSettled,
    resolveSettlementIfIdle,
  });
};
