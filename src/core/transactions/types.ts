import type { AnyEventDefinition } from "../events/event";
import type { ContextNodeDefinition } from "../graph/node";

export interface ContextChange {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}

export interface EventPublication {
  readonly event: AnyEventDefinition;
  readonly payload: unknown;
}
