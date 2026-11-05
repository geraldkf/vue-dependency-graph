import type { DefineMutationOptions, MutationDefaults, MutationDefinition } from "./types";

/**
 * Defines a **mutation** - a named write operation, run via
 * {@link GraphRuntime.mutate}. The one required piece is `execute`, the
 * remote call itself. How the write affects the graph - an optimistic
 * update, which nodes to invalidate on success, how to classify a failure -
 * can be supplied in either place:
 *
 * - **On the definition** (`optimistic`, `onSuccess`, `classifyFailure`) as
 *   the default for every call. Use this when a mutation always behaves the
 *   same way, which is the common case.
 * - **Per call**, as {@link GraphRuntime.mutate}'s third argument
 *   ({@link MutationOptions}). A field supplied here replaces the
 *   definition's default for that field, for that call only (the two never
 *   both run). Use it when call sites genuinely differ.
 *
 * Defaults put graph nodes into the definition, so a mutation that carries
 * them is tied to that graph. Keep `execute`-only definitions for shared
 * remote contracts that shouldn't import page-specific nodes, and supply
 * effects per call.
 *
 * `execute` receives `input` and `signal`, an `AbortSignal` that aborts if
 * the runtime shuts down before the mutation settles - pass it to `fetch`
 * so an abandoned request doesn't outlive its owner.
 *
 * @throws {@link Error} if `key` is empty or only whitespace, `execute`
 * isn't a function, or a supplied `optimistic`, `onSuccess` or
 * `classifyFailure` isn't a function.
 *
 * @example
 * ```ts
 * import { defineDataNode, defineMutation } from "vue-dependency-graph/core";
 *
 * interface CartItem {
 *   readonly productId: string;
 *   readonly quantity: number;
 * }
 * interface Cart {
 *   readonly items: readonly CartItem[];
 * }
 * type AddToCartInput = CartItem;
 *
 * const cart = defineDataNode({
 *   key: "cart",
 *   dependencies: [],
 *   initialValue: { items: [] } as Cart,
 *   load: async ({ signal }) => {
 *     const response = await fetch("/api/cart", { signal });
 *     return (await response.json()) as Cart;
 *   },
 * });
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
 *   // Defaults: applied on every `runtime.mutate(addToCart, ...)`.
 *   optimistic: (effects, input) => {
 *     effects.update(cart, (current) => ({
 *       ...current,
 *       items: [...current.items, { productId: input.productId, quantity: input.quantity }],
 *     }));
 *   },
 *   onSuccess: (effects) => {
 *     effects.invalidate([cart]);
 *   },
 * });
 *
 * // await runtime.mutate(addToCart, { productId: "prod-1", quantity: 1 });
 * //
 * // A call can still override a field, e.g. skip the optimistic update:
 * // await runtime.mutate(addToCart, input, { optimistic: () => {} });
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

  for (const field of ["optimistic", "onSuccess", "classifyFailure"] as const) {
    if (options[field] !== undefined && typeof options[field] !== "function") {
      throw new Error(`Mutation ${field} must be a function when provided.`);
    }
  }

  const defaults: MutationDefaults = Object.freeze({
    ...(options.optimistic && { optimistic: options.optimistic }),
    ...(options.onSuccess && { onSuccess: options.onSuccess }),
    ...(options.classifyFailure && { classifyFailure: options.classifyFailure }),
  });

  return Object.freeze({
    key: options.key,
    execute: options.execute,
    ...(Object.keys(defaults).length > 0 && { defaults }),
  });
};
