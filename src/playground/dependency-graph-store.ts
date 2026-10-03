import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";
import { createGraphRuntime } from "../core";
import { playgroundGraph } from "./playground-graph";

/**
 * Owns the playground graph runtime for the lifetime of one Pinia instance.
 *
 * The runtime remains the source of truth for graph state. Pinia owns the
 * runtime instance but does not mirror node values, statuses, or errors.
 *
 * Pinia also owns its lifetime: the runtime is disposed when the store is
 * disposed (`store.$dispose()`) or its Pinia instance is (`disposePinia`),
 * which permanently shuts down its owned work and policies.
 */
export const useDependencyGraphStore = defineStore("dependencyGraph", () => {
  const runtime = markRaw(createGraphRuntime(playgroundGraph));
  onScopeDispose(() => runtime.shutdown());

  return {
    runtime,
  };
});
