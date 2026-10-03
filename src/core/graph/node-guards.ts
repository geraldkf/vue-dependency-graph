import type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  DataNodeDefinition,
  DerivedNodeDefinition,
} from "./types";

/** Narrow common node definitions to the fields belonging to each kind. */
export const isContextNode = (node: AnyNodeDefinition): node is ContextNodeDefinition<unknown> =>
  node.kind === "context";
export const isDataNode = (
  node: AnyNodeDefinition,
): node is DataNodeDefinition<unknown, readonly AnyNodeDefinition[]> => node.kind === "data";
export const isDerivedNode = (
  node: AnyNodeDefinition,
): node is DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]> => node.kind === "derived";
