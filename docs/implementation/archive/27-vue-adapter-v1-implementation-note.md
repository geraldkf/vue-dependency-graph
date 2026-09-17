# Milestone 4 V1 Implementation Note: Plugin and Injection

## Status

Prepared; offline validation pending.

## Objective

Implement the first step of `docs/implementation/25-vue-adapter-and-playground-plan.md`: a way to install a `GraphRuntime` for a Vue app and resolve it from a composable, with a clear error rather than a silent `undefined` on a miss.

## Files changed

- `src/vue/plugin.ts` (new) — `GraphRuntimeKey`, `createGraphRuntimePlugin`, `useGraphRuntime`
- `src/vue/index.ts` — re-exports `createGraphRuntimePlugin` and `useGraphRuntime`; the existing `vueLayerName` bootstrap export is unchanged
- `tests/vue/plugin.spec.ts` (new)

## What matches the plan, and one thing worth calling out explicitly

`GraphRuntimeKey` is exported from `plugin.ts` but deliberately **not** re-exported from `src/vue/index.ts`, exactly as the plan specified — a public `GraphRuntimeKey` would let a consumer call `inject(GraphRuntimeKey)` directly and silently get `undefined` on a miss, which is exactly the failure mode `useGraphRuntime`'s explicit throw exists to prevent. The test file imports `GraphRuntimeKey` directly from `../../src/vue/plugin`, not through the public barrel — that's intentional, not an oversight, and matches how the plan said tests should reach it.

## Verification the plan specifically asked for

The plan's V1 checklist included confirming, empirically, that `@testing-library/vue`'s `render()` creates a genuine Vue effect scope — because V3/V4's whole cleanup story depends on `onScopeDispose` actually firing on unmount, and better to find out now than after building on top of an unverified assumption. `tests/vue/plugin.spec.ts`'s fourth test does exactly this directly: it registers an `onScopeDispose` callback inside a mounted component's `setup()`, confirms it hasn't fired, calls `unmount()`, and confirms it has. It passed. V3/V4 can rely on `onScopeDispose` firing correctly under this test harness.

## Tests

`tests/vue/plugin.spec.ts` (4 tests):

- `useGraphRuntime` throws with a clear message when no runtime was provided
- Resolves correctly via `global.provide` (the pattern the plan specified for tests that don't need a full plugin install)
- Resolves correctly via `createGraphRuntimePlugin` installed through `global.plugins`
- Confirms `onScopeDispose` fires on unmount within `render()`'s effect scope (see above)

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 102/102 tests (98 pre-existing, unchanged, plus 4 new), clean typecheck, clean boundary check.

## Next task

V2: the scope-safety guard (`assertActiveEffectScope`), shared by V3 and V4, per the plan.
