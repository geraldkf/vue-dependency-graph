const normalizeNodeKeys = (nodeKeys: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(nodeKeys)].sort());

/**
 * Discriminant for {@link GraphMutationError.code} - one value per concrete
 * subclass, letting you `switch` on a caught error's cause instead of
 * chaining `instanceof` checks against every subclass by hand.
 */
export type GraphMutationErrorCode =
  "STATE" | "CONFLICT" | "OUTCOME_UNKNOWN" | "RECONCILIATION" | "ROLLBACK_CONFLICT";

/**
 * The common base of every error {@link GraphRuntime.mutate} can reject
 * with. Catch this when you just need to know "did the mutation fail",
 * without caring which of the five specific ways it failed:
 *
 * ```ts
 * try {
 *   await runtime.mutate(AddToCart, input);
 * } catch (error) {
 *   if (error instanceof GraphMutationError) {
 *     reportMutationFailure(error.code, error);
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 *
 * To handle a specific failure differently, narrow further with
 * `instanceof` on the concrete subclass ({@link GraphMutationStateError},
 * {@link GraphMutationConflictError},
 * {@link GraphMutationOutcomeUnknownError},
 * {@link GraphMutationReconciliationError}, or
 * {@link GraphMutationRollbackConflictError}) or `switch` on `code` - both
 * narrow TypeScript's view of the error the same way.
 */
export abstract class GraphMutationError extends Error {
  protected constructor(
    public readonly code: GraphMutationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Thrown when a mutation's `optimistic` or `onSuccess` callback misuses
 * {@link MutationUpdateEffects.update} - for example, calling `update` on
 * a node that isn't a data node, updating the same node twice in one
 * call, mutating the current value in place instead of returning a new
 * one, or updating a node that has no successful value yet. This is
 * always a programmer error in how the mutation is wired, not a runtime
 * condition - fix the `optimistic`/`onSuccess` callback rather than
 * catching this.
 */
export class GraphMutationStateError extends GraphMutationError {
  public readonly nodeKey: string;

  public constructor(nodeKey: string, message: string) {
    super("STATE", message);
    this.name = "GraphMutationStateError";
    this.nodeKey = nodeKey;
  }
}

/**
 * Thrown by {@link GraphRuntime.mutate} when this call's optimistic update
 * targets a node that another in-flight mutation is already optimistically
 * updating, or its context changed before the optimistic draft committed.
 * The classic case is a user clicking a quantity stepper
 * rapidly: the second click's optimistic update can't safely apply on top
 * of the first click's still-unconfirmed one. Typical handling is to
 * disable the control while a mutation on the same node is in flight,
 * rather than catching this after the fact.
 */
export class GraphMutationConflictError extends GraphMutationError {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[], message?: string) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      "CONFLICT",
      message ?? `Optimistic mutation conflicts with active nodes: ${sortedKeys.join(", ")}.`,
    );
    this.name = "GraphMutationConflictError";
    this.nodeKeys = sortedKeys;
  }
}

/**
 * Thrown by {@link GraphRuntime.mutate} when `execute` fails and
 * `classifyFailure` returns `"unknown"` (or no `classifyFailure` is given
 * and the failure can't be assumed safe to roll back) - the connection
 * dropped after `placeOrder`'s request was sent, for instance, so whether
 * the order actually went through is genuinely unknown. The runtime
 * deliberately does *not* roll back any optimistic update in this case,
 * since doing so could hide a write that actually succeeded. The
 * recommended recovery is to re-fetch authoritative state (e.g. the
 * user's order history) before deciding whether to retry.
 *
 * `cause` holds the original error thrown by `execute`.
 */
export class GraphMutationOutcomeUnknownError extends GraphMutationError {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[], cause: unknown) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super("OUTCOME_UNKNOWN", `Mutation outcome is unknown for nodes: ${sortedKeys.join(", ")}.`, {
      cause,
    });
    this.name = "GraphMutationOutcomeUnknownError";
    this.nodeKeys = sortedKeys;
  }
}

/**
 * Thrown by {@link GraphRuntime.mutate} when `execute` succeeds remotely
 * but the `onSuccess` callback itself throws while applying the result -
 * for example, `effects.update` rejecting a malformed server response.
 * `remoteSucceeded` is always `true`, distinguishing this from a failed
 * write: the server has already committed the change, only the local
 * graph update failed to apply. Typical recovery is to invalidate and
 * refetch the affected nodes rather than trust the local (potentially
 * partially-applied) state.
 *
 * `cause` holds the error thrown by `onSuccess`.
 */
export class GraphMutationReconciliationError extends GraphMutationError {
  public readonly mutationKey: string;
  public readonly nodeKeys: readonly string[];
  public readonly remoteSucceeded = true as const;

  public constructor(mutationKey: string, nodeKeys: readonly string[], cause: unknown) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      "RECONCILIATION",
      `Mutation "${mutationKey}" succeeded remotely but local reconciliation failed for nodes: ${sortedKeys.join(", ")}.`,
      { cause },
    );
    this.name = "GraphMutationReconciliationError";
    this.mutationKey = mutationKey;
    this.nodeKeys = sortedKeys;
  }
}

/**
 * Thrown by {@link GraphRuntime.mutate} when a failed mutation's rollback
 * can't cleanly apply, because the affected node has moved on to newer
 * state since the optimistic update was made - the classic case is an
 * item you optimistically added to your cart selling out (an inventory
 * event invalidated it) before the add request itself came back rejected.
 * Rolling back to the pre-optimistic value would discard that newer
 * state, so the runtime raises this instead of silently overwriting it.
 * Typical recovery is to invalidate and refetch the affected nodes so the
 * UI reflects current server state either way.
 *
 * `cause` holds the original mutation failure.
 */
export class GraphMutationRollbackConflictError extends GraphMutationError {
  public readonly nodeKeys: readonly string[];

  public constructor(nodeKeys: readonly string[], cause: unknown) {
    const sortedKeys = normalizeNodeKeys(nodeKeys);
    super(
      "ROLLBACK_CONFLICT",
      `Optimistic rollback conflicts with newer graph state for nodes: ${sortedKeys.join(", ")}.`,
      { cause },
    );
    this.name = "GraphMutationRollbackConflictError";
    this.nodeKeys = sortedKeys;
  }
}
