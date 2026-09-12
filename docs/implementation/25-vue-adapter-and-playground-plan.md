# Vue Adapter and Playground Plan

## Status

Planned. Nothing in `src/vue` or `src/playground` beyond bootstrap stubs exists yet. This is Milestone 5.

## Objective

Build the actual Vue composables (`src/vue`) and a real, manually-operable playground (`src/playground`) together, as one plan, because the playground is the only way to catch what unit and Vue Testing Library tests structurally cannot: real reactivity timing in a real browser tick, what a loading-to-error-to-success transition actually looks like on screen, and whether unmounting a component during an in-flight load behaves correctly to the eye, not just to an assertion.

This plan treats "add playground scenarios" as first-class, not an afterthought — `docs/implementation/01-roadmap.md`'s own preamble already states every milestone must update "documentation, tests, playground scenarios, and diagnostics," and the playground has not had a real scenario since Milestone 0's bootstrap stub.

## Current state, checked directly rather than assumed

- `src/vue/index.ts` and `src/devtools/index.ts` are one-line stubs exporting a layer-name string. `src/playground/App.vue` renders those three strings and nothing else.
- The playground's *infrastructure* already works: `index.html` loads `src/playground/main.ts`, `vite.config.ts` serves it, `pnpm dev` boots a real browser session today. Nothing needs to be wired up to make the playground runnable — only its content needs to exist.
- `@testing-library/vue` and `jsdom` are already devDependencies (from Milestone 0). No new tooling dependency is needed for Milestone 5's automated tests.
- `docs/testing/01-test-strategy.md` already specifies the Vue integration test list this plan must satisfy: mount creates subscription, unmount releases subscription, two consumers share one load, reactive status and data changes, `useNodes` alias typing and runtime values, query aggregate partial failure, no consumer `loadData()` call. This plan does not repeat that list — it implements against it.

## The design problem this plan is built around

Traced directly in `src/core/state/state.ts`: `getSnapshot`/`snapshotState` calls `Object.freeze({...})` and allocates a **new object every call**, whether or not anything changed. And `runtime.onChange` (in `src/core/observation/observer.ts`) is a **single global signal** — every capability's `notify()` funnels through the same listener set, with no indication of which node changed.

Put together: if a composable naively did `state.value = runtime.getState(node)` inside an `onChange` listener, every mounted `useNode`/`useNodes` instance in the whole app would receive a new object reference — and therefore trigger a Vue reactivity update — on *every* state change anywhere in the graph, not just changes to the node it actually cares about. With more than a handful of simultaneously-mounted components this defeats fine-grained reactivity entirely: an unrelated context change would cause every subscribed component to re-render.

**Decision for this plan:** each composable does its own field-by-field comparison (`data`, `status`, `freshness`, `error`, `generation`, `hasSuccessfulValue`) after every global notify, and only updates its internal ref when something it actually reads has changed. This requires no core changes and can ship as part of Milestone 5.

**Considered and deferred, not rejected:** giving `notify()` a payload identifying which node(s) changed, so composables wouldn't need to re-check on every global fan-out. This is a real optimization opportunity, but it changes the core's notification contract (every `buffer.notify()` call site would need to supply or infer a changed-node-key), which is a bigger, cross-cutting change than Milestone 5 needs to take on, and it overlaps with Milestone 10's "load reasons" diagnostics work, which will want structured per-node change information anyway. **Do not build this in Milestone 5.** If the playground's own multi-node scenario (see below) shows the per-notify comparison cost is actually a problem at realistic component counts, that's the trigger to revisit it under Milestone 10, not before.

## Vue composables design

### V1: Plugin and injection

```ts
export const GraphRuntimeKey: InjectionKey<GraphRuntime> = Symbol("graph-runtime");

export const createGraphRuntimePlugin = (runtime: GraphRuntime): Plugin => ({
  install(app) {
    app.provide(GraphRuntimeKey, runtime);
  },
});

export const useGraphRuntime = (): GraphRuntime => {
  const runtime = inject(GraphRuntimeKey);
  if (!runtime) {
    throw new Error(
      "No GraphRuntime found. Install it with app.use(createGraphRuntimePlugin(runtime))."
    );
  }
  return runtime;
};
```

A missing runtime throws immediately and explicitly, rather than composables silently receiving `undefined` and failing confusingly three calls later — consistent with how the core already throws clear errors for unregistered nodes rather than failing silently.

For tests, `@testing-library/vue`'s `render(Component, { global: { provide: { [GraphRuntimeKey]: testRuntime } } })` achieves the same injection without a full `app.use()` — no separate test-only override parameter is needed on the composables themselves.

### V2: Scope-safety guard

Both `useNode` and `useNodes` must run inside an active Vue effect scope (normally: inside `setup()`, or inside another composable called from `setup()`) so `onScopeDispose` actually fires and releases the subscription. Calling either outside a scope would silently leak the subscription forever — `onScopeDispose` is a no-op with no active scope and gives no warning. A shared guard throws a clear error instead:

```ts
const assertActiveEffectScope = (composableName: string): void => {
  if (!getCurrentScope()) {
    throw new Error(
      `${composableName}() must be called inside setup() or an active effect scope, ` +
        "or its subscription will never be released."
    );
  }
};
```

### V3: `useNode`

```ts
export const useNode = <TNode extends AnyNodeDefinition>(
  node: TNode
): UseNodeResult<TNode> => {
  assertActiveEffectScope("useNode");
  const runtime = useGraphRuntime();

  const state = shallowRef(runtime.getState(node));

  const sync = (): void => {
    const next = runtime.getState(node);
    if (!statesEqual(state.value, next)) state.value = next;
  };

  const subscription = runtime.subscribeNodes([node]);
  const stopWatching = runtime.onChange(sync);

  onScopeDispose(() => {
    stopWatching();
    subscription.unsubscribe();
  });

  return {
    data: computed(() => state.value.data),
    status: computed(() => state.value.status),
    freshness: computed(() => state.value.freshness),
    error: computed(() => state.value.error),
    hasSuccessfulValue: computed(() => state.value.hasSuccessfulValue),
  };
};
```

Returning individual `computed()` refs rather than one nested state ref is a deliberate ergonomics choice: `const { data, status } = useNode(userNode)` stays reactive after destructuring (unlike destructuring a plain object), matching the convention consumers of VueUse/Vue Query composables already expect, and avoiding `.value.data` chains in templates and script alike.

`statesEqual` does the field-by-field comparison described above. `generation` is deliberately excluded from the comparison used to decide whether to update `state.value` — it changes on every invalidation even when `data`/`status`/`error` end up identical (for example, a context change that re-runs a derived node to the same result), and comparing it would defeat the whole point of the dirty-check.

### V4: `useNodes`

Same subscription/sync shape as `useNode`, generalized to an array, plus the aggregate state Milestone 5's checklist calls for:

```ts
export interface UseNodesAggregate {
  readonly isLoading: ComputedRef<boolean>; // any node loading or refreshing
  readonly isError: ComputedRef<boolean>;   // any node has a non-null error
  readonly errors: ComputedRef<readonly Error[]>; // all non-null errors, in node order
  readonly isSuccess: ComputedRef<boolean>; // every node has a successful value
}
```

One `subscribeNodes([...nodes])` call, one `onChange` listener performing the field-by-field comparison per node, updating a single `shallowRef<readonly NodeRuntimeState[]>`. Individual per-node results and the aggregate are both exposed, matching the test strategy's "query aggregate partial failure" case: some nodes can be in `error` while others are `success`, and the aggregate must reflect that (`isError: true`, `isSuccess: false`, `data` for the successful ones still readable).

## Playground scenarios

The playground becomes a small set of real, switchable scenarios — not a single demo page — each built to exercise one thing this plan needs to see working outside of an assertion. A mock loader with a configurable artificial delay and a controllable failure toggle backs every data node used here, so loading/error states are actually reachable on demand rather than resolving instantly.

1. **Context switching** — one context node (e.g. a selected user ID) with a couple of buttons to change it, one dependent data node showing its loading → success cycle on screen. This is the smallest possible proof the whole chain (context → invalidation → scheduler → execution → composable → DOM) works end to end, visually.
2. **Concurrent consumers** — two components independently calling `useNode` on the *same* node, mounted side by side. The mock loader logs (visibly, in the UI, not just the console) every time it's actually invoked, so it's directly observable that mounting two consumers causes one load, not two.
3. **Error and retry** — a failure toggle on the mock loader, a manual refresh button, and visible error state, to see the initial-load-failure and refresh-failure-with-stale-data paths render correctly, not just assert correctly.
4. **Unmount cleanup** — a node mounted behind a `v-if`, with a visible subscriber count (via `getSubscriptionState`) so toggling the `v-if` and watching the count go to zero is a manual, visual confirmation that `onScopeDispose` actually ran — this is the one most likely to *look* fine in a unit test's assertions while still leaking in a real app if the scope-guard or cleanup wiring has a subtle bug.
5. **Aggregate query** — several nodes via one `useNodes` call, one of them wired to the failure toggle, to see the aggregate `isError`/`isSuccess` behave correctly under partial failure.

Each scenario is its own component under `src/playground/scenarios/`, switched via simple tabs in `App.vue` — no router needed for five scenarios.

## Tests

Per `docs/testing/01-test-strategy.md`'s existing Vue integration list — this plan implements against it, it does not redefine it:

- `tests/vue/plugin.spec.ts` — `useGraphRuntime` throws without injection, resolves with it.
- `tests/vue/use-node.spec.ts` — mount creates subscription, unmount releases it, reactive status/data changes, two consumers share one load (asserted via a mock loader call-count, mirroring playground scenario 2).
- `tests/vue/use-nodes.spec.ts` — aggregate state under partial failure, alias typing/runtime value shape.
- `tests/playground/App.spec.ts` — replaced entirely (its current content only asserts the three stub strings, which will no longer exist); becomes a smoke test that each scenario tab mounts without throwing.

All new tests use `@testing-library/vue`'s `render()` with an explicitly constructed, deterministic `GraphRuntime` per test (real core, mock loaders) — consistent with the test strategy's stated preference for direct deterministic instances over broad module mocking.

## Work sequence

- [ ] V1: Plugin and injection (`GraphRuntimeKey`, `createGraphRuntimePlugin`, `useGraphRuntime`) + tests
- [ ] V2: Scope-safety guard (`assertActiveEffectScope`), shared by V3 and V4
- [ ] V3: `useNode` with field-level dirty-check sync + tests (mount/unmount/reactive-change/shared-load)
- [ ] V4: `useNodes` with aggregate state + tests (aggregate partial failure, alias typing)
- [ ] V5: Playground scenarios 1–5, replacing the stub `App.vue`, with a shared configurable mock loader
- [ ] V6: Replace `tests/playground/App.spec.ts`'s stub assertions with scenario smoke tests
- [ ] Update API and architecture documentation
- [ ] Receive successful offline validation feedback

Exit criteria (from `docs/implementation/01-roadmap.md`'s existing Milestone 5 entry): a Vue component loads and refreshes graph data without manual load or unsubscribe calls. This plan adds a stronger, visual version of that criterion: `pnpm dev` shows all five scenarios working correctly by hand, not only by assertion.

## Non-goals

- No devtools UI. `src/devtools` stays a stub — that's Milestone 11, and building any real inspector now would be building against a Vue adapter that doesn't exist yet.
- No SSR support (already on the roadmap's deferred list).
- No changes to `runtime.onChange`'s granularity. See the design-problem section above — deferred to Milestone 10 if the playground shows it's actually needed.
- No router or multi-page playground structure. Five tabbed scenarios don't need one; revisit only if scenario count grows enough to need it.
