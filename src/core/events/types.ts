/** The definition returned by {@link defineEvent}. */
export interface EventDefinition<TPayload> {
  readonly key: string;
  /** Carries TPayload for type inference without storing runtime state. */
  readonly __payloadType?: TPayload;
}

/** An event definition of any payload type - used where an event's specific payload doesn't matter, e.g. a generic listener. */
export type AnyEventDefinition = EventDefinition<unknown>;

/**
 * Extracts an event's payload type from its definition. Useful when a
 * `runtime.publish` call site or handler needs to name the payload type
 * explicitly.
 *
 * @example
 * ```ts
 * import { defineEvent, type EventPayload } from "vue-dependency-graph/core";
 *
 * const stockChanged = defineEvent<{ productId: string; inStock: boolean }>("stock-changed");
 * type StockChangedPayload = EventPayload<typeof stockChanged>; // { productId: string; inStock: boolean }
 * ```
 */
export type EventPayload<TEvent extends AnyEventDefinition> =
  TEvent extends EventDefinition<infer TPayload> ? TPayload : never;
