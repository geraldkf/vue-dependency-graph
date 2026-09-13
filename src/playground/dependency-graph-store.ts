import { defineStore } from "pinia";
import { markRaw } from "vue";
import { createGraphRuntime } from "../core";
import { playgroundGraph } from "./playground-graph";

/**
 * Owns the playground graph runtime for the lifetime of one Pinia instance.
 *
 * The runtime remains the source of truth for graph state. Pinia owns the
 * runtime instance but does not mirror node values, statuses, or errors.
 */
export const useDependencyGraphStore = defineStore("dependencyGraph", () => {
  const runtime = markRaw(createGraphRuntime(playgroundGraph));

  return {
    runtime,
  };
});
