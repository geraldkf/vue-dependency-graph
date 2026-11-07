import type { RuntimeDiagnosticEmitter } from "./diagnostic-emitter";
import type { GraphExecutionReason } from "./types";
import type { AnyNodeDefinition } from "../graph/types";
import type { ExecutionOrigin } from "../state/state";

export interface ExecutionDiagnosticContext {
  readonly operationId: string;
  readonly reason: GraphExecutionReason;
  readonly causeId?: string;
}

export const emitExecution = (
  diagnostics: RuntimeDiagnosticEmitter,
  type:
    | "node.execution.skipped"
    | "node.execution.reused"
    | "node.load.queued"
    | "node.load.started"
    | "node.load.succeeded"
    | "node.load.failed"
    | "node.load.aborted"
    | "node.load.discarded"
    | "node.derive.started"
    | "node.derive.succeeded"
    | "node.derive.failed",
  node: AnyNodeDefinition,
  generation: number,
  origin: ExecutionOrigin,
  context: ExecutionDiagnosticContext | undefined,
  extras: {
    readonly durationMs?: number;
    readonly error?: Error;
  } = {},
): void => {
  if (!context || !diagnostics.isEnabled) return;
  diagnostics.emit({
    type,
    operationId: context.operationId,
    ...(context.causeId === undefined ? {} : { causeId: context.causeId }),
    nodeKey: node.key,
    nodeKind: node.kind,
    generation,
    origin,
    reason: context.reason,
    ...(extras.durationMs === undefined ? {} : { durationMs: extras.durationMs }),
    ...(extras.error === undefined ? {} : { error: diagnostics.toError(extras.error) }),
  });
};

const noAttemptDiagnostics = Object.freeze({
  queued: (): void => undefined,
  started: (): void => undefined,
  succeeded: (): void => undefined,
  failed: (_error: Error): void => undefined,
  obsolete: (_aborted: boolean): void => undefined,
});

/** Captures attempt timing and emits the matching load or derive lifecycle. */
export const beginExecutionDiagnostics = (
  diagnostics: RuntimeDiagnosticEmitter,
  node: AnyNodeDefinition,
  generation: number,
  origin: ExecutionOrigin,
  context: ExecutionDiagnosticContext | undefined,
): typeof noAttemptDiagnostics => {
  // Nothing would be emitted: skip the per-attempt timing and closures.
  if (!context || !diagnostics.isEnabled) return noAttemptDiagnostics;
  const startedAt = diagnostics.now();
  const emit = (type: Parameters<typeof emitExecution>[1], error?: Error): void =>
    emitExecution(diagnostics, type, node, generation, origin, context, {
      durationMs: diagnostics.now() - startedAt,
      ...(error === undefined ? {} : { error }),
    });
  return Object.freeze({
    queued: () => emitExecution(diagnostics, "node.load.queued", node, generation, origin, context),
    started: () =>
      emitExecution(
        diagnostics,
        node.kind === "data" ? "node.load.started" : "node.derive.started",
        node,
        generation,
        origin,
        context,
      ),
    succeeded: () => emit(node.kind === "data" ? "node.load.succeeded" : "node.derive.succeeded"),
    failed: (error: Error) =>
      emit(node.kind === "data" ? "node.load.failed" : "node.derive.failed", error),
    obsolete: (aborted: boolean) => emit(aborted ? "node.load.aborted" : "node.load.discarded"),
  });
};
