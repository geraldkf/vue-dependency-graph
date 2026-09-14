# Vue and Pinia Integration

## Responsibility boundary

`GraphRuntime` remains the source of truth for graph values, status, freshness, errors, generations, subscriptions, scheduling, and execution.

The Vue adapter converts runtime observations into Vue computed refs and owns component-scope subscription cleanup. Pinia may own the runtime instance, but it does not replace or duplicate graph state.

```text
Vue component
    |
    +-- explicit runtime --> Pinia store --> GraphRuntime
    |
    `-- injected runtime --> Vue plugin --> GraphRuntime
                                      |
                                      v
                                   src/core
```

Both paths use the same `useNode` and `useNodes` implementations and the same core runtime.

Both paths also support `useQuery(...)` for immutable aliased query definitions. `useQuery(...)` delegates to the same combined subscription and observation path as `useNodes(...)`; it does not create query-owned runtime state. Its `prefetch()` and `refresh()` methods delegate to the query-aware core runtime wrappers, which reuse the existing operation controller.

## Runtime resolution

Vue graph composables accept an optional explicit runtime:

```ts
useNode(Targets, { runtime });
useNodes([Targets, Permissions], { runtime });
useQuery(AppointmentsPage, { runtime });
```

Resolution order is:

1. Explicit `options.runtime`
2. Runtime installed by `createGraphRuntimePlugin`
3. A clear missing-runtime error

Explicit runtime ownership allows an application with an existing Pinia installation to integrate the graph without changing `App.vue` or adding another application plugin.

## Browser refresh-policy environment

The optional `createBrowserRefreshPolicyEnvironment(...)` adapter belongs to the Vue entry point. It combines document visibility and online state without placing browser dependencies in core. Applications may pass it when constructing either a directly owned or Pinia-owned runtime.

## Pinia ownership

The recommended setup store creates one runtime inside the store factory:

```ts
export const useDependencyGraphStore = defineStore(
  "dependencyGraph",
  () => {
    const runtime = markRaw(createGraphRuntime(graph));
    return { runtime };
  }
);
```

This provides:

- One stable runtime per Pinia instance
- Independent runtimes for independent application or test instances
- No module-level mutable singleton
- A straightforward test setup using `createPinia()`

Graph definitions remain immutable and may be declared at module scope.

## Why `markRaw`

The runtime is a closure-based service object with its own observation mechanism. Vue does not need to proxy it. `markRaw` preserves the runtime object and avoids implying that its internal state is Vue-reactive.

## No mirrored state

Do not copy node data, status, errors, or subscription counts into Pinia refs. Mirrored state would introduce two sources of truth and require additional consistency rules for invalidation, refresh failure, cancellation, and cleanup.

Components should instead read graph state through `useNode` or `useNodes`.

## Scope and cleanup

Both composables require an active Vue effect scope. They:

- Create graph subscriptions when the composable runs
- Observe committed runtime changes
- Compare meaningful state fields before updating Vue refs
- Release the runtime listener and graph subscription through `onScopeDispose`

Calling a composable outside `setup()` or an active effect scope throws before it can leak a subscription.

## Update filtering

The core currently emits one graph-level change signal. Runtime snapshots are newly allocated objects, so assigning every snapshot on every notification would create unnecessary Vue updates.

The adapter compares:

- data
- status
- freshness
- error
- hasSuccessfulValue

Generation is intentionally excluded because generation-only changes do not affect the state fields consumers render.

## Playground model

The playground installs Pinia once and does not install the graph runtime plugin. One dependency graph store owns a runtime containing every namespaced scenario node. Each scenario passes that runtime explicitly to the composables.

Only the active scenario is mounted. Switching tabs releases its component-owned graph subscriptions while retaining the Pinia store and graph runtime for the application lifetime.

## Testing expectations

Pinia integration tests should use:

- A real `createPinia()` instance
- The real dependency graph store
- The real graph runtime
- Vue Testing Library mounts
- Explicit runtime options
- Behavioural assertions on loading, data, subscriptions, cleanup, and shared execution

Plugin-based tests remain useful for the supported injection path, but Pinia integration tests must not also install the graph runtime plugin.
