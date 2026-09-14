import type { AnyEventDefinition } from "../events/types";
import type { ContextNodeDefinition } from "../graph/types";

export interface ContextChange {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}

export interface EventPublication {
  readonly event: AnyEventDefinition;
  readonly payload: unknown;
}
