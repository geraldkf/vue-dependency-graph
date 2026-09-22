export type NodeExecutionFailureKind = "failed" | "blocked";

export interface NodeExecutionFailure {
  readonly nodeKey: string;
  readonly kind: NodeExecutionFailureKind;
  readonly error?: Error;
  readonly blockedBy?: readonly string[];
}

/**
 * The outcome of one node execution attempt, used in place of throwing
 * ObsoleteAttempt/NodeAttemptFailure across the recursive async graph
 * walk in execution.ts. `ActiveAttempt.promise` (state.ts) resolves to
 * this - it never rejects for expected outcomes, only for genuine
 * programmer errors.
 */
export type NodeAttemptOutcome =
  | { readonly status: "ok" }
  | { readonly status: "obsolete" }
  | { readonly status: "failed"; readonly error: Error };

export class GraphExecutionError extends Error {
  public readonly failures: readonly NodeExecutionFailure[];

  public constructor(failures: readonly NodeExecutionFailure[]) {
    super(`Graph execution failed for ${failures.length} node(s).`);
    this.name = "GraphExecutionError";
    this.failures = Object.freeze(
      failures.map((failure) =>
        Object.freeze(
          failure.blockedBy
            ? { ...failure, blockedBy: Object.freeze([...failure.blockedBy]) }
            : { ...failure },
        ),
      ),
    );
  }
}

export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export const isAbortError = (value: unknown): boolean => {
  if (value instanceof Error && value.name === "AbortError") return true;
  if (typeof value !== "object" || value === null) return false;
  return "name" in value && value.name === "AbortError";
};
