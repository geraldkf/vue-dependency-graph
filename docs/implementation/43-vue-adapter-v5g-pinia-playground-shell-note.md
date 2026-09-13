# Milestone 4 V5G Implementation Note: Pinia-Backed Playground Shell

## Status

Prepared; offline validation pending.

## Objective

Replace the bootstrap playground with a tabbed shell that mirrors the departmental application environment: Pinia is installed once, the dependency graph store owns one runtime, and scenario components pass that runtime explicitly to `useNode` and `useNodes`. The graph runtime Vue plugin is not installed.

## Files changed

- `src/playground/App.vue`
- `src/playground/main.ts`
- `src/playground/scenarios/AggregateQueryScenario.vue`
- `src/playground/scenarios/ConsumerPanel.vue`
- `src/playground/scenarios/ContextSwitchingScenario.vue`
- `src/playground/scenarios/ErrorAndRetryScenario.vue`
- `src/playground/scenarios/ToggleableConsumer.vue`
- `src/playground/scenarios/UnmountCleanupScenario.vue`
- `tests/playground/App.spec.ts`
- `tests/playground/scenarios/aggregate-query.spec.ts`
- `tests/playground/scenarios/concurrent-consumers.spec.ts`
- `tests/playground/scenarios/context-switching.spec.ts`
- `tests/playground/scenarios/error-and-retry.spec.ts`
- `tests/playground/scenarios/unmount-cleanup.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/25-vue-adapter-and-playground-plan.md`
- `docs/implementation/43-vue-adapter-v5g-pinia-playground-shell-note.md` (this file)

## Application bootstrap

`main.ts` now installs Pinia and mounts the playground:

```ts
const app = createApp(App);
app.use(createPinia());
app.mount("#app");
```

It deliberately does not install `createGraphRuntimePlugin`.

## Scenario runtime usage

Every scenario that accesses graph functionality now resolves the store and passes its runtime explicitly:

```ts
const { runtime } = useDependencyGraphStore();
const resource = useNode(ResourceNode, { runtime });
```

`useNodes` uses the same pattern. Scenario code that calls `setContext`, `refresh`, `onChange`, or `getSubscriptionState` uses the same store-owned runtime directly.

## Shell behaviour

`App.vue` provides five tabs without adding a router:

- Context Switching
- Concurrent Consumers
- Error and Retry
- Unmount Cleanup
- Aggregate Query

Only the active scenario is mounted. Switching tabs therefore releases the previous scenario's scope-owned graph subscriptions while retaining the Pinia store and graph runtime for the application lifetime.

## Test alignment

The existing scenario tests now install Pinia and obtain the store-owned runtime instead of constructing isolated graphs and installing the graph runtime plugin. Their behavioural assertions remain unchanged.

The obsolete bootstrap assertions in `tests/playground/App.spec.ts` were replaced with one focused shell test proving the initial scenario and tab switching. V6 will expand this into complete smoke coverage across all five tabs.

## Static inspection

- No `src/core` files changed.
- No playground source imports or calls `useGraphRuntime`.
- `main.ts` installs Pinia only.
- Existing scenarios all use the same Pinia-owned runtime model.
- The dependency-free core boundary check passes.

## Offline validation

Apply V4A, V4B, V4C, and V5G in order, then run:

```text
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
pnpm install --frozen-lockfile
```

Manually confirm that all five tabs render, context switching reloads data, concurrent consumers share one load, error/retry retains stale data, unmount cleanup changes subscription counts, and aggregate query reports partial failure correctly.

## Next task

V6: complete playground smoke tests across every scenario tab, including subscription cleanup during tab changes.
