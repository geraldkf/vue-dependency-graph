import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
} from "../graph/node";

export type RefreshableNodeDefinition =
  | DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>
  | DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]>;
