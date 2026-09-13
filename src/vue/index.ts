import { coreLayerName } from "../core";

/** Identifies the Vue integration layer during repository bootstrap. */
export const vueLayerName = `vue:${coreLayerName}` as const;

export { createGraphRuntimePlugin, useGraphRuntime } from "./plugin";
export type { GraphComposableOptions } from "./composable-options";
export { useNode } from "./use-node";
export type { UseNodeResult } from "./use-node";
export { useNodes } from "./use-nodes";
export type {
  UseNodesAggregate,
  UseNodesResult,
  UseNodesResults,
} from "./use-nodes";
