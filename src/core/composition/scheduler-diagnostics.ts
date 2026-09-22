import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { ExecutionDiagnosticContext } from "../execution/execution";
import type { AnyNodeDefinition } from "../graph/types";
import type { SchedulerRequestTracker } from "../scheduling/request-tracker";
import type { SchedulerFlush } from "../scheduling/scheduler";

export interface SchedulerDiagnosticsDependencies {
  readonly diagnostics: RuntimeDiagnosticEmitter;
  readonly schedulerRequest: SchedulerRequestTracker;
}

export interface SchedulerDiagnostics {
  readonly onRequested: () => void;
  readonly beginFlush: (
    targets: readonly AnyNodeDefinition[],
  ) => SchedulerFlush<ExecutionDiagnosticContext>;
}

/**
 * Diagnostic attribution for scheduler flushes.
 *
 * Flushes can overlap, so attribution is captured once per flush, in
 * `beginFlush`, and held in that flush's own closure - never in a field
 * shared between flushes. `pendingOperationId` is the one piece of state
 * this module keeps outside a flush, and it only bridges `onRequested`
 * (schedule time) to the `beginFlush` of the *next* flush to start; nothing
 * else reads it, so it needs no forward-reference guard.
 *
 * The reason and cause come from the shared `schedulerRequest` tracker,
 * written by whoever asked for the flush. `beginFlush` reads it and resets it
 * immediately, so a later, unrelated `schedule()` call starts from a clean
 * tracker rather than inheriting this flush's reason.
 */
export const createSchedulerDiagnostics = ({
  diagnostics,
  schedulerRequest,
}: SchedulerDiagnosticsDependencies): SchedulerDiagnostics => {
  let pendingOperationId = "";

  const withCause = (
    causeId: string | undefined,
  ): { readonly causeId?: string } =>
    causeId === undefined ? {} : { causeId };

  const diagnostic: SchedulerDiagnostics = {
    onRequested: () => {
      pendingOperationId = diagnostics.createOperationId();
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: "scheduler.requested",
        operationId: pendingOperationId,
        ...withCause(pending.causeId),
        reason: pending.reason,
        nodeKeys: [],
      });
    },
    beginFlush: (targets) => {
      const attribution = schedulerRequest.peek();
      schedulerRequest.reset();
      const operationId = pendingOperationId;

      diagnostics.emit({
        type: "scheduler.started",
        operationId,
        ...withCause(attribution.causeId),
        reason: attribution.reason,
        nodeKeys: targets.map((node) => node.key),
      });

      return {
        context: {
          operationId,
          ...withCause(attribution.causeId),
          reason: attribution.reason,
        },
        complete: (error) => {
          diagnostics.emit({
            type: error ? "scheduler.failed" : "scheduler.completed",
            operationId,
            ...withCause(attribution.causeId),
            reason: attribution.reason,
            nodeKeys: [],
            ...(error ? { error: diagnostics.toError(error) } : {}),
          });
        },
      };
    },
  };
  return Object.freeze(diagnostic);
};
