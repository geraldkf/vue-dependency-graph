export interface EventDefinition<TPayload> {
  readonly key: string;
  /** Carries TPayload for type inference without storing runtime state. */
  readonly __payloadType?: TPayload;
}

export type AnyEventDefinition = EventDefinition<unknown>;

export type EventPayload<TEvent extends AnyEventDefinition> =
  TEvent extends EventDefinition<infer TPayload> ? TPayload : never;
