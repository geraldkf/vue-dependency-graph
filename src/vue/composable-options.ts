import type { GraphRuntime } from "../core";
import { useGraphRuntime } from "./plugin";

/**
 * Optional runtime override for Vue graph composables.
 *
 * Applications that already own a runtime through another application-level
 * facility, such as a Pinia store, can pass it directly without installing
 * the graph runtime plugin.
 */
export interface GraphComposableOptions {
  readonly runtime?: GraphRuntime;
}

export const resolveGraphRuntime = (options?: GraphComposableOptions): GraphRuntime =>
  options?.runtime ?? useGraphRuntime();
