import type { RuntimeDiagnosticEmitter } from "./diagnostic-emitter";
import {
  GraphMutationOutcomeUnknownError,
  GraphMutationReconciliationError,
  GraphMutationRollbackConflictError,
} from "../mutations/errors";

export type MutationLifecycleType =
  | "optimistic-committed"
  | "remote-started"
  | "remote-succeeded"
  | "remote-failed"
  | "success-committed";

export type MutationLifecycleListener = (
  type: MutationLifecycleType,
  affectedNodeKeys?: readonly string[],
) => void;

type MutationOutcomeEventType =
  | "mutation.rollback-conflicted"
  | "mutation.outcome-unknown"
  | "mutation.reconciliation-failed"
  | "mutation.rolled-back";

type MutationOutcome =
  | "rollback-conflict"
  | "unknown"
  | "reconciliation-failed"
  | "rejected";

/**
 * Replaces the repeated 4-way `instanceof` ternary chain (once for the
 * event type, once for the outcome label) with a single classification
 * step.
 */
const classifyMutationError = (
  error: unknown,
): { readonly type: MutationOutcomeEventType; readonly outcome: MutationOutcome } => {
  if (error instanceof GraphMutationRollbackConflictError) {
    return { type: "mutation.rollback-conflicted", outcome: "rollback-conflict" };
  }
  if (error instanceof GraphMutationOutcomeUnknownError) {
    return { type: "mutation.outcome-unknown", outcome: "unknown" };
  }
  if (error instanceof GraphMutationReconciliationError) {
    return { type: "mutation.reconciliation-failed", outcome: "reconciliation-failed" };
  }
  return { type: "mutation.rolled-back", outcome: "rejected" };
};

export interface MutationDiagnosticsSession {
  readonly operationId: string;
  readonly onLifecycle: MutationLifecycleListener;
  readonly reportSuccess: <TResult>(result: TResult) => TResult;
  readonly reportFailure: (error: unknown) => never;
}

/**
 * Owns the full diagnostic lifecycle of one `runtime.mutate(...)` call:
 * start, phase transitions, and completion (success or classified
 * failure). `runtime.ts` only needs to open a session and wire its two
 * report callbacks into the mutation promise.
 */
export const beginMutationDiagnostics = (
  diagnostics: RuntimeDiagnosticEmitter,
  mutationKey: string,
): MutationDiagnosticsSession => {
  const operationId = diagnostics.createOperationId();
  const startedAt = diagnostics.now();

  diagnostics.emit({ type: "mutation.started", operationId, mutationKey });

  const onLifecycle: MutationLifecycleListener = (type, affectedNodeKeys) => {
    diagnostics.emit({
      type: `mutation.${type}` as
        | "mutation.optimistic-committed"
        | "mutation.remote-started"
        | "mutation.remote-succeeded"
        | "mutation.remote-failed"
        | "mutation.success-committed",
      operationId,
      mutationKey,
      ...(affectedNodeKeys === undefined ? {} : { affectedNodeKeys }),
    });
  };

  const reportSuccess = <TResult>(result: TResult): TResult => {
    diagnostics.emit({
      type: "mutation.completed",
      operationId,
      mutationKey,
      outcome: "succeeded",
      durationMs: diagnostics.now() - startedAt,
    });
    return result;
  };

  const reportFailure = (error: unknown): never => {
    const normalised = error instanceof Error ? error : new Error(String(error));
    const { type, outcome } = classifyMutationError(error);
    const durationMs = diagnostics.now() - startedAt;
    diagnostics.emit({
      type,
      operationId,
      mutationKey,
      outcome,
      durationMs,
      error: diagnostics.toError(normalised),
    });
    diagnostics.emit({
      type: "mutation.completed",
      operationId,
      mutationKey,
      outcome,
      durationMs,
      error: diagnostics.toError(normalised),
    });
    throw error;
  };

  return Object.freeze({ operationId, onLifecycle, reportSuccess, reportFailure });
};
