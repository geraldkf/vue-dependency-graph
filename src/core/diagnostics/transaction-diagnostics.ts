import type { RuntimeDiagnosticEmitter } from "./diagnostic-emitter";
import { GraphTransactionConflictError } from "../transactions/errors";

export interface TransactionDiagnosticsSession {
  readonly operationId: string;
  readonly reportCommitted: <T>(result: T) => T;
  readonly reportFailed: (error: unknown) => never;
}

/**
 * Owns the full diagnostic lifecycle of one `runtime.transaction(...)`
 * call. `runtime.ts` only needs to open a session and wire its two report
 * callbacks into the transaction promise.
 */
export const beginTransactionDiagnostics = (
  diagnostics: RuntimeDiagnosticEmitter,
): TransactionDiagnosticsSession => {
  const operationId = diagnostics.createOperationId();
  const startedAt = diagnostics.now();

  diagnostics.emit({ type: "transaction.started", operationId });

  const reportCommitted = <T>(result: T): T => {
    diagnostics.emit({
      type: "transaction.committed",
      operationId,
      durationMs: diagnostics.now() - startedAt,
    });
    return result;
  };

  const reportFailed = (error: unknown): never => {
    const normalised = error instanceof Error ? error : new Error(String(error));
    const durationMs = diagnostics.now() - startedAt;
    if (error instanceof GraphTransactionConflictError) {
      diagnostics.emit({
        type: "transaction.conflicted",
        operationId,
        conflictKeys: error.contextKeys,
        durationMs,
        error: diagnostics.toError(normalised),
      });
    } else {
      diagnostics.emit({
        type: "transaction.rolled-back",
        operationId,
        durationMs,
        error: diagnostics.toError(normalised),
      });
    }
    throw error;
  };

  return Object.freeze({ operationId, reportCommitted, reportFailed });
};
