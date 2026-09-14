import type { AnyEventDefinition, EventPayload } from "../events/types";
import type { ContextNodeDefinition } from "../graph/types";

export interface ContextChange {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}

export interface EventPublication {
  readonly event: AnyEventDefinition;
  readonly payload: unknown;
}

export interface GraphTransaction {
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue,
  ) => void;
  readonly publish: <TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>,
  ) => void;
}
