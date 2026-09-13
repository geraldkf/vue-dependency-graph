# Vue Adapter and Playground Plan

## Status

In progress. V1 (plugin and injection), V2 (scope-safety guard), V3 (`useNode`, all sub-steps complete), V4 (`useNodes`), V5A (shared mock loader), V5B (context-switching scenario), V5C (concurrent-consumers scenario), and V5D (error-and-retry scenario) are implemented, offline validation pending. V5E (unmount cleanup scenario) is next. Everything else in `src/vue` and `src/playground` beyond bootstrap stubs remains as planned below. This is Milestone 4.

## Objective

Build the actual Vue composables (`src/vue`) and a real, manually-operable playground (`src/playground`) together, as one plan, because the playground is the only way to catch what unit and Vue Testing Library tests structurally cannot: real reactivity timing in a real browser tick, what a loading-to-error-to-success transition actually looks like on screen, and whether unmounting a component during an in-flight load behaves correctly to the eye, not just to an assertion.

This plan treats "add playground scenarios" as first-class, not an afterthought — `docs/implementation/01-roadmap.md`'s own preamble already states every milestone must update "documentation, tests, playground scenarios, and diagnostics," and the playground has not had a real scenario since Milestone 0's bootstrap stub.

## Current state, checked directly rather than assumed

- `src/vue/index.ts` and `src/devtools/index.ts` are one-line stubs exporting a layer-name string. `src/playground/App.vue` renders those three strings and nothing else.
- The playground's *infrastructure* already works: `index.html` loads `src/playground/main.ts`, `vite.config.ts` serves it, `pnpm dev` boots a real browser session today. Nothing needs to be wired up to make the playground runnable — only its content needs to exist.
- `@testing-library/vue` and `jsdom` are already devDependencies (from Milestone 0). No new tooling dependency is needed for Milestone 4's automated tests.
- `docs/testing/01-test-strategy.md` already specifies the Vue integration test list this plan must satisfy: mount creates subscription, unmount releases subscription, two consumers share one load, reactive status and data changes, `useNodes` alias typing and runtime values, query aggregate partial failure, no consumer `loadData()` call. This plan does not repeat that list — it implements against it.

## The design problem this plan is built around

Traced directly in `src/core/state/state.ts`: `getSnapshot`/`snapshotState` calls `Object.freeze({...})` and allocates a **new object every call**, whether or not anything changed. And `runtime.onChange` (in `src/core/observation/observer.ts`) is a **single global signal** — every capability's `notify()` funnels through the same listener set, with no indication of which node changed.

Put together: if a composable naively did `state.value = runtime.getState(node)` inside an `onChange` listener, every mounted `useNode`/`useNodes` instance in the whole app would receive a new object reference — and therefore trigger a Vue reactivity update — on *every* state change anywhere in the graph, not just changes to the node it actually cares about. With more than a handful of simultaneously-mounted components this defeats fine-grained reactivity entirely: an unrelated context change would cause every subscribed component to re-render.

**Decision for this plan:** each composable does its own field-by-field comparison (`data`, `status`, `freshness`, `error`, `generation`, `hasSuccessfulValue`) after every global notify, and only updates its internal ref when something it actually reads has changed. This requires no core changes and can ship as part of Milestone 4.

**Considered and deferred, not rejected:** giving `notify()` a payload identifying which node(s) changed, so composables wouldn't need to re-check on every global fan-out. This is a real optimization opportunity, but it changes the core's notification contract (every `buffer.notify()` call site would need to supply or infer a changed-node-key), which is a bigger, cross-cutting change than Milestone 4 needs to take on, and it overlaps with Milestone 10's "load reasons" diagnostics work, which will want structured per-node change information anyway. **Do not build this in Milestone 4.** If the playground's own multi-node scenario (see below) shows the per-notify comparison cost is actually a problem at realistic component counts, that's the trigger to revisit it under Milestone 10, not before.

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

**Export surface decision:** `createGraphRuntimePlugin` and `useGraphRuntime` are public (exported from `src/vue/index.ts`). `GraphRuntimeKey` is **not** — if it were public, a consumer could call `inject(GraphRuntimeKey)` directly and silently get `undefined` on a miss, bypassing the clear-error path that's the whole point of `useGraphRuntime`. Tests reach it through `@testing-library/vue`'s `global.provide`, which needs the key's value, not a public export of the key itself — the test file imports it from the same module under test, not as part of the package's public API.

Checklist:

- [x] Define `GraphRuntimeKey` (module-internal, not exported from `src/vue/index.ts`)
- [x] Implement `createGraphRuntimePlugin`
- [x] Implement `useGraphRuntime` with the explicit throw-on-missing behaviour
- [x] `tests/vue/plugin.spec.ts`: throws with no injection; resolves correctly when provided via `global.provide`; resolves correctly when provided via a mounted `createGraphRuntimePlugin` (confirms both paths actually agree)
- [x] Confirm empirically, not by assumption, that `@testing-library/vue`'s `render()` creates a genuine Vue effect scope for the mounted component — confirmed: `onScopeDispose` fires correctly on `unmount()`. See `docs/implementation/27-vue-adapter-v1-implementation-note.md`.
- [ ] Receive successful offline validation feedback

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

This stays internal to `src/vue` — not exported. Nothing has asked for consumers to write their own wrapping composables yet; export it later if that need actually shows up.

Checklist:

- [x] Implement `assertActiveEffectScope`
- [x] Unit test: throws when called with no active scope (a plain function call, not inside `setup()`); does not throw when called from inside a mounted test component's `setup()`

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

This bundles four genuinely different concerns, so — the same reasoning `docs/implementation/11-runtime-composition-refactor-plan.md` used to split R1 into R1A–D rather than every other R-step — it's split into lettered sub-steps, each independently checkable:

**V3A: The dirty-check comparator**

```ts
const statesEqual = (
  a: NodeRuntimeState<unknown>,
  b: NodeRuntimeState<unknown>
): boolean =>
  a.data === b.data &&
  a.status === b.status &&
  a.freshness === b.freshness &&
  a.error === b.error &&
  a.hasSuccessfulValue === b.hasSuccessfulValue;
```

`generation` is deliberately excluded — it changes on every invalidation even when `data`/`status`/`error` end up identical (for example, a context change that re-runs a derived node to the same result), and comparing it would defeat the whole point of the dirty-check. This is the single most important piece of correctness in the whole adapter (get it wrong and every component re-renders on every unrelated change, silently, with nothing to fail an assertion), so it gets its own direct unit test against hand-built `NodeRuntimeState` fixtures — not only exercised indirectly through a mounted component.

- [x] Implement `statesEqual`
- [x] `tests/vue/use-node.spec.ts` (or a dedicated small file): direct table of cases — identical states, `generation`-only difference, each other field differing one at a time — implemented as `tests/vue/states-equal.spec.ts`

**V3B: Subscription and sync wiring**

The `shallowRef` + `subscribeNodes` + `onChange` + `sync` wiring shown above.

- [x] Implement the wiring — implemented as `createNodeSubscription` in `src/vue/node-subscription.ts`, a reusable primitive rather than inline in `useNode`, so V4 (`useNodes`) can build on it too
- [x] Confirm `subscription.unsubscribe()` and the `onChange` unsubscribe function are each safe to call more than once (the core's existing subscription contract should already guarantee this — verify against the actual `subscriptions/subscriptions.ts` behaviour rather than assume, since `onScopeDispose` callbacks are not guaranteed to run exactly once across every Vue version/edge case) — confirmed: both guard themselves with an `active` flag. See `docs/implementation/30-vue-adapter-v3b-implementation-note.md`.

**V3C: Scope guard and public return shape**

Wrapping with `assertActiveEffectScope`, the `onScopeDispose` cleanup, and the computed-refs return shape.

- [x] Implement `UseNodeResult<TNode>` type and the returned computed refs
- [x] Wire `assertActiveEffectScope("useNode")` and `onScopeDispose` — confirmed working end to end with a throwaway smoke check (throws outside a scope, subscribes/reacts/unsubscribes inside a mounted component). See `docs/implementation/31-vue-adapter-v3c-implementation-note.md`.

**V3D: Tests**

- [x] Mount creates a subscription (assert via `runtime.getSubscriptionState(node)`)
- [x] Unmount releases it (count returns to what it was before mount)
- [x] Reactive status/data changes when the underlying context changes
- [x] Two consumers on the same node share one load (mock loader call-count assertion — this is a Vue-layer test that the composable doesn't accidentally break the core's existing dedup, not a re-test of the core's dedup itself, which already has its own core-level tests)
- [x] Calling `useNode` outside an active scope throws (delegates to V2's guard, confirmed here at the point of actual use)

### V4: `useNodes`

Same subscription/sync shape as `useNode`, generalized to an array, plus the aggregate state Milestone 4's checklist calls for:

```ts
export interface UseNodesAggregate {
  readonly isLoading: ComputedRef<boolean>; // any node loading or refreshing
  readonly isError: ComputedRef<boolean>;   // any node has a non-null error
  readonly errors: ComputedRef<readonly Error[]>; // all non-null errors, in node order
  readonly isSuccess: ComputedRef<boolean>; // every node has a successful value
}
```

One `subscribeNodes([...nodes])` call, one `onChange` listener performing the field-by-field comparison per node, updating a single `shallowRef<readonly NodeRuntimeState[]>`. Individual per-node results and the aggregate are both exposed, matching the test strategy's "query aggregate partial failure" case: some nodes can be in `error` while others are `success`, and the aggregate must reflect that (`isError: true`, `isSuccess: false`, `data` for the successful ones still readable).

**The type-level part is the genuinely hard part of this step**, worth naming explicitly rather than discovering while coding: "`useNodes` alias typing" (from the test strategy doc) means the result must preserve, per input node, its own specific data type — not collapse into a generic union. That needs a variadic tuple-preserving generic, in the same style `defineDataNode`'s `dependencies` tuple already uses `as const` for:

```ts
export const useNodes = <TNodes extends readonly AnyNodeDefinition[]>(
  nodes: TNodes
): UseNodesResult<TNodes> => { /* ... */ };

type UseNodesResult<TNodes extends readonly AnyNodeDefinition[]> = {
  readonly results: {
    [K in keyof TNodes]: ComputedRef<NodeRuntimeState<RuntimeNodeData<TNodes[K]>>>;
  };
} & UseNodesAggregate;
```

Checklist:

- [x] Implement `UseNodesResult<TNodes>` and confirm it actually preserves per-node typing (a compile-time type test, matching this project's existing "compile-time type tests" convention — not just a runtime test that happens to pass) — see `tests/vue/use-nodes-types.test.ts`
- [x] Implement the single-subscription, per-node dirty-check sync wiring (reusing `statesEqual` from V3A)
- [x] Implement the four aggregate computed refs
- [x] `tests/vue/use-nodes.spec.ts`: aggregate reflects partial failure correctly (some nodes `error`, others `success`); alias typing compiles and runtime values line up with the typed tuple; mount/unmount lifecycle for the multi-node case

## Playground scenarios

The playground becomes a small set of real, switchable scenarios — not a single demo page — each built to exercise one thing this plan needs to see working outside of an assertion. A mock loader with a configurable artificial delay and a controllable failure toggle backs every data node used here, so loading/error states are actually reachable on demand rather than resolving instantly.

Each scenario is its own component under `src/playground/scenarios/`, switched via simple tabs in `App.vue` — no router needed for five scenarios. Split into lettered sub-steps because the five scenarios are independently buildable and independently useful the moment each one lands — there's no reason to gate scenario 1 behind scenario 5 being finished.

**V5A: Shared configurable mock loader**

Built first since every scenario depends on it: a small loader factory taking a delay and a failure toggle, used as the `load` function for every data node in every scenario below, with a visible (in-UI, not just console) call counter so scenario 2 can prove dedup by eye.

- [x] Implement the mock loader factory
- [x] Decide its shape once, used identically by every scenario (avoids five slightly-different ad hoc mocks)

**V5B: Scenario 1 — Context switching**

One context node (e.g. a selected user ID) with a couple of buttons to change it, one dependent data node showing its loading → success cycle on screen. The smallest possible proof the whole chain (context → invalidation → scheduler → execution → composable → DOM) works end to end, visually.

- [x] Build the scenario component
- [ ] Wire it into the playground shell (deferred to V5G, which builds the shell all scenarios are wired into)

**V5C: Scenario 2 — Concurrent consumers**

Two components independently calling `useNode` on the *same* node, mounted side by side, with V5A's visible call counter making it directly observable that mounting two consumers causes one load, not two.

- [x] Build the scenario component
- [ ] Wire it into the playground shell (deferred to V5G, which builds the shell all scenarios are wired into)

**V5D: Scenario 3 — Error and retry**

A failure toggle on the mock loader, a manual refresh button, visible error state — the initial-load-failure and refresh-failure-with-stale-data paths, rendered, not only asserted.

- [x] Build the scenario component
- [ ] Wire it into the playground shell (deferred to V5G, which builds the shell all scenarios are wired into)

**V5E: Scenario 4 — Unmount cleanup**

A node mounted behind a `v-if`, with a visible subscriber count (via `getSubscriptionState`) so toggling the `v-if` and watching the count go to zero is a manual, visual confirmation that `onScopeDispose` actually ran. This is the scenario most likely to *look* fine in a unit test's assertions while still leaking in a real app if the scope-guard or cleanup wiring has a subtle bug — the visual counter is the point, not decoration.

- [ ] Build the scenario component
- [ ] Wire it into the playground shell

**V5F: Scenario 5 — Aggregate query**

Several nodes via one `useNodes` call, one of them wired to the failure toggle, to see the aggregate `isError`/`isSuccess` behave correctly under partial failure.

- [ ] Build the scenario component
- [ ] Wire it into the playground shell

**V5G: Playground shell**

Replaces the current stub `App.vue` entirely, tabs between the five scenarios, and installs the plugin once in `main.ts`.

- [ ] Replace `App.vue` with the tabbed shell
- [ ] Install `createGraphRuntimePlugin` in `main.ts` with a real `createGraphRuntime` instance built for the playground

## Tests

Per `docs/testing/01-test-strategy.md`'s existing Vue integration list — this plan implements against it, it does not redefine it:

- `tests/vue/plugin.spec.ts` — `useGraphRuntime` throws without injection, resolves with it.
- `tests/vue/use-node.spec.ts` — mount creates subscription, unmount releases it, reactive status/data changes, two consumers share one load (asserted via a mock loader call-count, mirroring playground scenario 2), the `statesEqual` case table from V3A.
- `tests/vue/use-nodes.spec.ts` — aggregate state under partial failure, alias typing/runtime value shape.
- `tests/playground/App.spec.ts` — replaced entirely (its current content only asserts the three stub strings, which will no longer exist); becomes a smoke test that each scenario tab mounts without throwing.

All new tests use `@testing-library/vue`'s `render()` with an explicitly constructed, deterministic `GraphRuntime` per test (real core, mock loaders) — consistent with the test strategy's stated preference for direct deterministic instances over broad module mocking.

`tests/setup.ts` (added during V5D) registers `@testing-library/vue`'s `cleanup()` globally via `vitest.config.ts`'s `setupFiles`. Any test file with more than one `render()` call needs this — without it, every previously rendered component stays in the same jsdom document, and DOM queries like `getByTestId` start matching elements from earlier tests, not just the current one. See `docs/implementation/37-vue-adapter-v5d-implementation-note.md` for how this was found.

## Work sequence

- [x] V1: Plugin and injection (`GraphRuntimeKey`, `createGraphRuntimePlugin`, `useGraphRuntime`) + tests + effect-scope-in-tests confirmation
- [x] V2: Scope-safety guard (`assertActiveEffectScope`), shared by V3 and V4
- [x] V3A: `useNode` — dirty-check comparator (`statesEqual`) + direct tests
- [x] V3B: `useNode` — subscription and sync wiring
- [x] V3C: `useNode` — scope guard and public return shape
- [x] V3D: `useNode` — mount/unmount/reactive-change/shared-load/scope-guard tests
- [x] V4: `useNodes` with aggregate state and alias-preserving typing + tests (aggregate partial failure, alias typing, lifecycle)
- [x] V5A: Shared configurable mock loader
- [x] V5B: Scenario 1 — Context switching (component and tests built with an isolated test runtime; shell wiring deferred to V5G)
- [x] V5C: Scenario 2 — Concurrent consumers (component and tests built with an isolated test runtime; shell wiring deferred to V5G)
- [x] V5D: Scenario 3 — Error and retry (component and tests built with an isolated test runtime; shell wiring deferred to V5G)
- [ ] V5E: Scenario 4 — Unmount cleanup
- [ ] V5F: Scenario 5 — Aggregate query
- [ ] V5G: Playground shell (`App.vue` tabs, plugin installed in `main.ts`)
- [ ] V6: Replace `tests/playground/App.spec.ts`'s stub assertions with scenario smoke tests
- [ ] Update API and architecture documentation
- [ ] Receive successful offline validation feedback

Exit criteria (from `docs/implementation/01-roadmap.md`'s existing Milestone 4 entry): a Vue component loads and refreshes graph data without manual load or unsubscribe calls. This plan adds a stronger, visual version of that criterion: `pnpm dev` shows all five scenarios working correctly by hand, not only by assertion.

## Non-goals

- No devtools UI. `src/devtools` stays a stub — that's Milestone 11, and building any real inspector now would be building against a Vue adapter that doesn't exist yet.
- No SSR support (already on the roadmap's deferred list).
- No changes to `runtime.onChange`'s granularity. See the design-problem section above — deferred to Milestone 10 if the playground shows it's actually needed.
- No router or multi-page playground structure. Five tabbed scenarios don't need one; revisit only if scenario count grows enough to need it.
