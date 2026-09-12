# Milestone 4 V2 Implementation Note: Scope-Safety Guard

## Status

Prepared; offline validation pending.

## Objective

Implement the second step of `docs/implementation/25-vue-adapter-and-playground-plan.md`: a shared guard that `useNode` and `useNodes` (V3, V4) will call before doing any subscription work, so calling either outside an active Vue effect scope fails loudly instead of silently leaking a subscription forever.

## Files changed

- `src/vue/scope-guard.ts` (new) — `assertActiveEffectScope`
- `tests/vue/scope-guard.spec.ts` (new)

`src/vue/index.ts` is unchanged — as the plan specified, this guard is not exported publicly. Nothing has asked for consumers to write their own wrapping composables yet.

## Why this matters, restated from the plan

`onScopeDispose` is a silent no-op when there's no active effect scope — it doesn't warn, it doesn't throw, it just never registers the cleanup. A composable that relies on it for subscription cleanup (V3/V4 both will) would, if called outside `setup()` or another composable, leak its subscription for the lifetime of the runtime with no error and no symptom until something else (a growing subscriber count, an unexplained repeated load) makes the leak visible. Throwing immediately, at the point of misuse, is cheap to add and expensive to skip.

## Tests

`tests/vue/scope-guard.spec.ts` (2 tests):

- Throws with a clear message when called with no active effect scope (a plain function call, not inside `setup()`)
- Does not throw when called from inside a mounted component's `setup()` — reuses the same `@testing-library/vue` `render()` harness V1 already confirmed creates a genuine effect scope

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 104/104 tests (102 pre-existing, unchanged, plus 2 new), clean typecheck, clean boundary check.

## Next task

V3A: `useNode`'s dirty-check comparator (`statesEqual`), per the plan.
