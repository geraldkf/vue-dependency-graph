import type { AnyNodeDefinition } from "../graph/types";

export interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

export interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly unsubscribe: () => void;
}
