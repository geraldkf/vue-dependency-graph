import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { DataNodeDefinition, DependencyList, EventInvalidationList } from "../graph/types";
import type { RefreshableNodeDefinition } from "../operations/types";

/** The argument passed to a {@link defineMutation} `execute` function. */
export interface MutationExecuteContext<TInput> {
  /** The value passed as `runtime.mutate`'s second argument. */
  readonly input: TInput;
  /**
   * Aborts if this attempt is superseded before it settles. Pass it to
   * `fetch` so an abandoned request doesn't race a newer one:
   * `fetch(url, { signal })`.
   */
  readonly signal: AbortSignal;
}

/** The definition returned by {@link defineMutation}. */
export interface MutationDefinition<TInput, TResult> {
  readonly key: string;
  readonly execute: (context: MutationExecuteContext<TInput>) => Promise<TResult>;
  /** Carries TInput for inference without storing runtime state. */
  readonly __inputType?: TInput;
  /** Carries TResult for inference without storing runtime state. */
  readonly __resultType?: TResult;
}

/** Options for {@link defineMutation}. */
export interface DefineMutationOptions<TInput, TResult> {
  /**
   * Unique identifier for this mutation. Used in diagnostics and error
   * messages (including every `GraphMutation*Error`'s `nodeKeys`/`mutationKey`).
   */
  readonly key: string;
  /**
   * Performs the write - typically a `fetch` call. Receives `input` and an
   * `AbortSignal`; returns the server's result, which flows into
   * `runtime.mutate`'s return value and into `onSuccess`.
   */
  readonly execute: (context: MutationExecuteContext<TInput>) => Promise<TResult>;
}

/**
 * Extracts a mutation's input type from its definition.
 *
 * @example
 * ```ts
 * import { defineMutation, type MutationInput } from "vue-dependency-graph/core";
 *
 * declare const addToCart: ReturnType<
 *   typeof defineMutation<{ productId: string }, void>
 * >;
 * type AddToCartInput = MutationInput<typeof addToCart>; // { productId: string }
 * ```
 */
export type MutationInput<TMutation> = TMutation extends { readonly __inputType?: infer TInput }
  ? TInput
  : never;

/**
 * Extracts a mutation's result type from its definition.
 *
 * @example
 * ```ts
 * import { defineMutation, type MutationResult } from "vue-dependency-graph/core";
 *
 * declare const addToCart: ReturnType<
 *   typeof defineMutation<{ productId: string }, { cartId: string }>
 * >;
 * type AddToCartResult = MutationResult<typeof addToCart>; // { cartId: string }
 * ```
 */
export type MutationResult<TMutation> = TMutation extends { readonly __resultType?: infer TResult }
  ? TResult
  : never;

/**
 * The effects object passed to `optimistic` - the only thing an optimistic
 * update is allowed to do. Deliberately narrow: it can update a data
 * node's cached value, but can't invalidate nodes or publish events (those
 * happen on confirmed success, via {@link MutationSuccessEffects}).
 */
export interface MutationUpdateEffects {
  /**
   * Optimistically rewrites a data node's current value. `updater`
   * receives the node's current value and must return a new value rather
   * than mutating it in place - the same rule as, say, an Immer-free
   * Redux reducer. Each node may only be updated once per call.
   *
   * @throws {@link GraphMutationStateError} if `node` isn't a data node,
   * has no successful value yet, is updated more than once in the same
   * call, or if `updater` mutates its argument in place or returns a
   * promise.
   */
  readonly update: <
    TValue,
    TDependencies extends DependencyList,
    TInvalidatedBy extends EventInvalidationList<TDependencies>,
  >(
    node: DataNodeDefinition<TValue, TDependencies, TInvalidatedBy>,
    updater: (current: TValue) => TValue,
  ) => void;
}

/**
 * How {@link MutationOptions.classifyFailure} categorizes a thrown error:
 * `"rejected"` means the write is known to have failed (e.g. the server
 * returned a validation error) and any optimistic update is rolled back
 * cleanly. `"unknown"` means the outcome genuinely can't be determined
 * (e.g. the connection dropped after the request was sent) - the runtime
 * cannot safely roll back, and `runtime.mutate` rejects with
 * `GraphMutationOutcomeUnknownError` instead.
 */
export type MutationFailureKind = "rejected" | "unknown";

/**
 * The effects object passed to `onSuccess`, once `execute` has resolved.
 * Extends {@link MutationUpdateEffects} with the two things only a
 * confirmed success should trigger.
 */
export interface MutationSuccessEffects extends MutationUpdateEffects {
  /** Marks nodes as needing a refetch - e.g. the cart total after a confirmed add. */
  readonly invalidate: (nodes: readonly RefreshableNodeDefinition[]) => void;
  /** Publishes an event as part of this mutation's success, same as {@link GraphRuntime.publish}. */
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
}

/**
 * Per-call options for {@link GraphRuntime.mutate} - how this particular
 * call should affect the graph, separate from the mutation's own
 * `execute` ({@link defineMutation}).
 *
 * @example
 * ```ts
 * import type { MutationOptions } from "vue-dependency-graph/core";
 *
 * declare const cart: { readonly items: readonly { productId: string; quantity: number }[] };
 * declare const addToCart: { readonly key: string };
 *
 * const options: MutationOptions<
 *   { productId: string; quantity: number },
 *   { cartId: string }
 * > = {
 *   // Update the UI immediately, before the server confirms.
 *   optimistic: (effects, input) => {
 *     effects.update(cart, (current) => ({
 *       ...current,
 *       items: [...current.items, { productId: input.productId, quantity: input.quantity }],
 *     }));
 *   },
 *   // Once confirmed, refetch the authoritative cart from the server.
 *   onSuccess: (effects) => {
 *     effects.invalidate([cart]);
 *   },
 *   // A confirmed "out of stock" rejection is safe to roll back; anything
 *   // else (e.g. a dropped connection) has an unknown outcome.
 *   classifyFailure: (error) =>
 *     error instanceof Error && error.message === "OUT_OF_STOCK" ? "rejected" : "unknown",
 * };
 * ```
 */
export interface MutationOptions<TInput, TResult> {
  /**
   * Applies an optimistic update before `execute` resolves, so the UI
   * reflects the write immediately. Rolled back automatically if `execute`
   * fails and the failure classifies as `"rejected"`.
   */
  readonly optimistic?: (effects: MutationUpdateEffects, input: TInput) => void;
  /**
   * Runs once `execute` resolves successfully. Use it to invalidate
   * affected nodes, publish an event, or apply a final update using the
   * server's actual result (rather than the optimistic guess).
   */
  readonly onSuccess?: (effects: MutationSuccessEffects, result: TResult, input: TInput) => void;
  /**
   * Classifies a thrown error as `"rejected"` (safe to roll back) or
   * `"unknown"` (outcome can't be determined - e.g. the request may have
   * reached the server before the connection dropped). Omitted, every
   * failure is treated as `"rejected"`.
   */
  readonly classifyFailure?: (error: unknown) => MutationFailureKind;
}
