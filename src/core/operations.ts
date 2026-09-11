import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
} from "./types";

export type RefreshableNodeDefinition =
  | DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>
  | DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]>;
