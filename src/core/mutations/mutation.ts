import type { DefineMutationOptions, MutationDefinition } from "./types";

/**
 * Defines a **mutation** - a named write operation, run via
 * {@link GraphRuntime.mutate}. `defineMutation` only describes the remote
 * call itself (`execute`); how it affects the graph - an optimistic update,
 * which nodes to invalidate on success, how to classify a failure - is
 * supplied per call, as {@link GraphRuntime.mutate}'s third argument
 * ({@link MutationOptions}), not here. That split lets the same mutation
 * (e.g. `addToCart`) be reused from different call sites with different
 * optimistic behavior.
 *
 * `execute` receives `input` and `signal`, an `AbortSignal` that aborts if
 * the mutation attempt is superseded before it settles - pass it to `fetch`
 * so an abandoned request doesn't race a newer one.
 *
 * @throws {@link Error} if `key` is empty or only whitespace, or `execute`
 * isn't a function.
 *
 * @example
 * ```ts
 * import { defineMutation } from "vue-dependency-graph/core";
 *
 * interface AddToCartInput {
 *   readonly productId: string;
 *   readonly quantity: number;
 * }
 *
 * const addToCart = defineMutation<AddToCartInput, { readonly cartId: string }>({
 *   key: "cart.add",
 *   execute: async ({ input, signal }) => {
 *     const response = await fetch("/api/cart/items", {
 *       method: "POST",
 *       body: JSON.stringify(input),
 *       signal,
 *     });
 *     return (await response.json()) as { readonly cartId: string };
 *   },
 * });
 *
 * // Elsewhere, with the optimistic update and invalidation supplied per call:
 * // await runtime.mutate(addToCart, { productId: "prod-1", quantity: 1 }, {
 * //   optimistic: (effects, input) => {
 * //     effects.update(cart, (current) => ({
 * //       ...current,
 * //       items: [...current.items, { productId: input.productId, quantity: input.quantity }],
 * //     }));
 * //   },
 * //   onSuccess: (effects) => {
 * //     effects.invalidate([cart]);
 * //   },
 * // });
 * ```
 *
 * @see {@link GraphRuntime.mutate} for how a mutation is actually run, and
 * for the `GraphMutation*Error` types it can reject with.
 */
export const defineMutation = <TInput, TResult>(
  options: DefineMutationOptions<TInput, TResult>,
): MutationDefinition<TInput, TResult> => {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.key !== "string" ||
    options.key.trim().length === 0
  ) {
    throw new Error("Mutation key must not be blank.");
  }

  if (typeof options.execute !== "function") {
    throw new Error("Mutation execute must be a function.");
  }

  return Object.freeze({
    key: options.key,
    execute: options.execute,
  });
};
