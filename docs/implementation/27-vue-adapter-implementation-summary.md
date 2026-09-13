# Milestone 4: Vue Adapter and Pinia Integration

## Status

Complete.

The Vue adapter, Pinia-owned runtime integration, five playground scenarios, tabbed shell, behavioural tests, type tests, and lifecycle smoke tests are implemented. Manual browser validation of the complete playground was reported successful.

The milestone is closed by the project owner. Run the repository validation commands before release if they have not been run against the final combined change set.

## Delivered capabilities

- Vue plugin and injected-runtime resolution
- Explicit runtime option for applications that already own a runtime
- Scope-safe `useNode`
- Tuple-preserving `useNodes` with aggregate state
- Component-scope subscription and listener cleanup
- Pinia-owned runtime integration without an `App.vue` graph-plugin change
- One playground graph containing all namespaced scenario nodes
- Five deterministic playground scenarios
- Pinia-backed tabbed playground shell
- Behavioural, lifecycle, integration, and compile-time tests

## Public usage

Plugin-based applications may install the runtime:

```ts
app.use(createGraphRuntimePlugin(runtime));
const targets = useNode(Targets);
```

Applications with an existing runtime owner, including Pinia, may pass it explicitly:

```ts
const graphStore = useDependencyGraphStore();
const targets = useNode(Targets, {
  runtime: graphStore.runtime,
});
```

The explicit runtime takes precedence over injection.

## Pinia ownership

The playground uses a setup store:

```ts
export const useDependencyGraphStore = defineStore(
  "dependencyGraph",
  () => {
    const runtime = markRaw(createGraphRuntime(playgroundGraph));
    return { runtime };
  }
);
```

The runtime is created inside the store factory so each Pinia instance receives an independent runtime. Pinia owns the runtime instance only. Graph values, status, errors, subscriptions, and scheduling remain owned by `GraphRuntime`.

## Important behavioural findings

### Subscription scheduling is asynchronous

`subscribeNodes()` queues scheduler work in a microtask. A newly mounted data-node consumer initially observes `idle`, not synchronously `loading`.

### Meaningful state comparison

The Vue adapter compares data, status, freshness, error, and successful-value state before replacing its internal ref. Generation is deliberately excluded so generation-only changes do not trigger unrelated component updates.

### Refresh failure retains data

A failed refresh preserves the previous successful value while exposing an error and stale state. Consumers should render data and error independently when stale data remains useful.

### Aggregate success and error are independent

`useNodes().isSuccess` means every node has a successful value. It can remain true while `isError` is also true after a refresh failure.

### Caller operations must handle rejection

`refresh()` and `prefetch()` return caller-owned promises. Event handlers must await them or handle rejection even when reactive node state already presents the error.

### Scope cleanup is required

`useNode` and `useNodes` require an active Vue effect scope. Mount creates subscriptions; unmount releases observation and subscription ownership through `onScopeDispose`.

## Playground scenarios

- Context Switching: context invalidation and automatic reload
- Concurrent Consumers: two components sharing one execution
- Error and Retry: initial failure and refresh failure with retained data
- Unmount Cleanup: visible subscription count across child mount and unmount
- Aggregate Query: mixed success and failure through `useNodes`

All scenarios use one Pinia-owned runtime and explicit runtime options. Switching scenario tabs releases the previous component's subscriptions while retaining the runtime.

## Test coverage

- Plugin injection and missing-runtime behaviour
- Explicit runtime resolution and precedence
- Effect-scope guard
- State comparison
- `useNode` loading, updates, shared execution, and cleanup
- `useNodes` tuple typing, aggregate state, and cleanup
- Pinia runtime ownership and per-Pinia isolation
- Pinia-backed composable integration
- Scenario-specific behaviour
- Shell tab mounting and subscription cleanup
- Compile-time node result inference

## Validation

Manual browser validation of the complete Pinia-backed playground was reported successful.

Final repository validation commands:

```text
pnpm install --frozen-lockfile
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

## Deferred work

Milestone 4 does not add query groups, polling, events, optimistic mutations, diagnostics, devtools, SSR support, or atomic graph transactions.
