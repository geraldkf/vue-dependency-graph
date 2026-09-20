import type { RuntimeDiagnosticEmitter } from "../diagnostics/diagnostic-emitter";
import type { ExecutionDiagnosticContext } from "../execution/execution";
import type { AnyNodeDefinition } from "../graph/types";
import type { SchedulerRequestTracker } from "../scheduling/request-tracker";

export interface SchedulerDiagnosticsDependencies {
  readonly diagnostics: RuntimeDiagnosticEmitter;
  readonly schedulerRequest: SchedulerRequestTracker;
}

export interface SchedulerDiagnostics {
  /** Attribution for the flush the scheduler is about to execute. */
  readonly getExecutionContext: () => ExecutionDiagnosticContext;
  readonly onRequested: () => void;
  readonly onStarted: (targets: readonly AnyNodeDefinition[]) => void;
  readonly onCompleted: (error: Error | null) => void;
}

/**
 * Diagnostic attribution for scheduler flushes.
 *
 * Owns the current flush's operation id, which is created when a flush is
 * requested and then stamped on the flush's `started`, execution, and
 * `completed`/`failed` events. The reason and cause come from the shared
 * `schedulerRequest` tracker (written by whoever asked for the flush) and are
 * read - never cleared - until the flush completes, when the tracker is reset.
 *
 * The operation id is state local to this adapter on purpose: nothing else
 * reads it, so it needs no forward-reference guard and is not shared.
 */
export const createSchedulerDiagnostics = ({
  diagnostics,
  schedulerRequest,
}: SchedulerDiagnosticsDependencies): SchedulerDiagnostics => {
  let operationId = "";

  const withCause = (
    causeId: string | undefined,
  ): { readonly causeId?: string } =>
    causeId === undefined ? {} : { causeId };

  const diagnostic: SchedulerDiagnostics = {
    getExecutionContext: () => {
      const pending = schedulerRequest.peek();
      return {
        operationId,
        ...withCause(pending.causeId),
        reason: pending.reason,
      };
    },
    onRequested: () => {
      operationId = diagnostics.createOperationId();
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: "scheduler.requested",
        operationId,
        ...withCause(pending.causeId),
        reason: pending.reason,
        nodeKeys: [],
      });
    },
    onStarted: (targets) => {
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: "scheduler.started",
        operationId,
        ...withCause(pending.causeId),
        reason: pending.reason,
        nodeKeys: targets.map((node) => node.key),
      });
    },
    onCompleted: (error) => {
      const pending = schedulerRequest.peek();
      diagnostics.emit({
        type: error ? "scheduler.failed" : "scheduler.completed",
        operationId,
        ...withCause(pending.causeId),
        reason: pending.reason,
        nodeKeys: [],
        ...(error ? { error: diagnostics.toError(error) } : {}),
      });
      schedulerRequest.reset();
    },
  };
  return Object.freeze(diagnostic);
};
