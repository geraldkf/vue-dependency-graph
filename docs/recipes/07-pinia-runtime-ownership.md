# Recipe 07 — Pinia owns the runtime

**Status:** pre-1.0 / migration convention  
**Related:** [UI, Pinia, and the dependency graph](../guides/01-ui-and-pinia-graph.md), [Vue and Pinia integration](../architecture/07-vue-and-pinia-integration.md)

## Failure mode

Teams mix the Vue runtime plugin and Pinia ownership, mirror node `data`/`status` into Pinia refs, or create one runtime per component. Result: double sources of truth, leaked timers, or confusing dispose behaviour.

## Department default

1. A **Pinia store** creates and owns `GraphRuntime` with `markRaw`.
2. Components pass `{ runtime: store.runtime }` into `useNode` / `useNodes` / `useQuery`.
3. Pinia does **not** mirror graph node state.
4. Runtime is disposed when the store / Pinia instance is disposed — not when a single component unmounts.

## Minimal store shape

```ts
import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";
import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
// import { createBrowserTimerEnvironment } from "vue-dependency-graph/vue";

export const useFeatureGraphStore = defineStore("featureGraph", () => {
  const graph = createGraph({ nodes: [/* feature nodes */] });
  const runtime = markRaw(
    createGraphRuntime(graph, {
      // maxConcurrentLoads: 6,
      // timerEnvironment: createBrowserTimerEnvironment(),
    }),
  );

  onScopeDispose(() => {
    runtime.shutdown();
  });

  return {
    runtime,
    // optional use-case actions that call runtime.transaction / mutate only
  };
});
```

## Consumer

```ts
const store = useFeatureGraphStore();
const { data, status, freshness, error, hasSuccessfulValue } = useNode(Orders, {
  runtime: store.runtime,
});
```

## Checklist

- [ ] Single runtime per coherent workflow (not per widget).
- [ ] `markRaw(runtime)`.
- [ ] No Pinia state for node snapshots.
- [ ] Explicit `{ runtime }` in composables (department default).
- [ ] Dispose tied to store/Pinia lifetime.

## Full guide

See [UI, Pinia, and the dependency graph](../guides/01-ui-and-pinia-graph.md) for writers, consumers, status matrix, routing, mutations, and migration checklist.
