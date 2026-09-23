import type { EventDefinition } from "./types";

/**
 * Defines an **event** - a named channel that {@link GraphRuntime.publish}
 * sends payloads through, and that a node's `invalidatedBy` option
 * subscribes to. Events are how the graph reacts to something external:
 * typically a websocket push (stock changed, an order's status updated),
 * rather than something the graph itself caused (for that, see a
 * mutation's `onSuccess` effects, which invalidate nodes directly).
 *
 * `defineEvent` only needs a key; the payload type is supplied as a type
 * argument and carried for inference, not validated at runtime - publishing
 * with a shape that doesn't match `TPayload` is caught by TypeScript, not
 * thrown here.
 *
 * @throws {@link Error} if `key` is empty or only whitespace.
 *
 * @example
 * ```ts
 * import { defineContextNode, defineDataNode, defineEvent } from "vue-dependency-graph/core";
 *
 * const stockChanged = defineEvent<{ productId: string; inStock: boolean }>(
 *   "stock-changed",
 * );
 *
 * const currentProductId = defineContextNode({
 *   key: "currentProductId",
 *   initialValue: "prod-1",
 * });
 *
 * const inventory = defineDataNode({
 *   key: "inventory",
 *   dependencies: [currentProductId],
 *   initialValue: null,
 *   invalidatedBy: [
 *     {
 *       event: stockChanged,
 *       when: ({ payload, get }) => payload.productId === get(currentProductId),
 *     },
 *   ],
 *   load: async ({ get }) =>
 *     fetch(`/api/inventory/${get(currentProductId)}`).then((r) => r.json()),
 * });
 *
 * // Elsewhere, e.g. inside a websocket `onmessage` handler:
 * // runtime.publish(stockChanged, { productId: "prod-1", inStock: false });
 * ```
 *
 * @see {@link defineDataNode}'s `invalidatedBy` option, and
 * {@link ConditionalEventInvalidation} for the `{ event, when }` form used
 * above.
 * @see {@link GraphRuntime.publish} for triggering an event.
 */
export const defineEvent = <TPayload>(key: string): EventDefinition<TPayload> => {
  if (key.trim().length === 0) {
    throw new Error("Event key must not be blank.");
  }

  return Object.freeze({ key });
};
