import type { ContextNodeDefinition } from "../graph/node";

/** Final context value supplied to commit-time reconciliation. */
export interface ContextChange {
  readonly node: ContextNodeDefinition<unknown>;
  readonly value: unknown;
}
