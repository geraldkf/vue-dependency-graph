import { toError } from "./execution";
import type { SchedulerState } from "./scheduler";
import type { AnyNodeDefinition } from "./types";

export interface RuntimeSchedulerController {
  readonly schedule: () => void;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly resolveSettlementIfIdle: () => void;
}

export interface RuntimeSchedulerDependencies {
  readonly getTargetsNeedingWork: () =>
    readonly AnyNodeDefinition[];
  readonly execute: (
    targets: readonly AnyNodeDefinition[]
  ) => Promise<void>;
  readonly notify: () => void;
}

export const createRuntimeSchedulerController = ({
  getTargetsNeedingWork,
  execute,
  notify,
}: RuntimeSchedulerDependencies): RuntimeSchedulerController => {
  const settlementWaiters = new Set<() => void>();
  let scheduled = false;
  let running = false;
  let followUpRequired = false;
  let error: Error | null = null;

  const isSettled = (): boolean =>
    !scheduled && !running && !followUpRequired;

  const resolveSettlementIfIdle = (): void => {
    if (!isSettled()) return;
    for (const resolve of [...settlementWaiters]) resolve();
    settlementWaiters.clear();
  };

  const getSchedulerState = (): SchedulerState =>
    Object.freeze({
      isScheduled: scheduled,
      isRunning: running,
      error,
    });

  let flush: () => Promise<void>;

  const schedule = (): void => {
    if (running) {
      followUpRequired = true;
      return;
    }
    if (scheduled) return;

    scheduled = true;
    notify();
    queueMicrotask(() => {
      void flush();
    });
  };

  flush = async (): Promise<void> => {
    if (!scheduled || running) return;

    scheduled = false;
    running = true;
    followUpRequired = false;
    error = null;
    notify();

    try {
      const targets = getTargetsNeedingWork();
      if (targets.length > 0) {
        await execute(targets);
      }
    } catch (thrown) {
      error = toError(thrown);
    } finally {
      running = false;
      notify();

      if (followUpRequired) {
        followUpRequired = false;
        schedule();
      } else {
        resolveSettlementIfIdle();
      }
    }
  };

  const whenSettled = (): Promise<void> => {
    if (isSettled()) return Promise.resolve();
    return new Promise(resolve => settlementWaiters.add(resolve));
  };

  return Object.freeze({
    schedule,
    getSchedulerState,
    whenSettled,
    resolveSettlementIfIdle,
  });
};
