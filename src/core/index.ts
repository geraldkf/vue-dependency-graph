export { GraphValidationError } from "./errors";
export type { GraphValidationErrorCode } from "./errors";
export { createGraph } from "./graph";
export type { CreateGraphOptions } from "./graph";
export {
  defineContextNode,
  defineDataNode,
  defineDerivedNode,
} from "./nodes";
export type {
  AnyNodeDefinition,
  ContextNodeDefinition,
  ContextNodeOptions,
  DataNodeDefinition,
  DataNodeOptions,
  DependencyList,
  DeriveContext,
  DerivedNodeDefinition,
  DerivedNodeOptions,
  GetDependencyValue,
  Graph,
  LoadContext,
  NodeDefinition,
  NodeKind,
  NodeOrKey,
  NodeValue,
} from "./types";

/** Identifies the framework-agnostic core layer during repository bootstrap. */
export const coreLayerName = "core" as const;
