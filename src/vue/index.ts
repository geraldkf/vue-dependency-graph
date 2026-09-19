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
export { useQuery } from "./use-query";
export type {
  UseQueryNodes,
  UseQueryResult,
} from "./use-query";

export { createBrowserTimerEnvironment } from "./browser-timer-environment";
export type { BrowserTimerEnvironmentOptions } from "./browser-timer-environment";
