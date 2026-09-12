import type { AnyNodeDefinition } from "../graph/node";

export interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

export interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly unsubscribe: () => void;
}
