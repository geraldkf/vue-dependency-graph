# Milestone 4 V4 Implementation Note: `useNodes`

## Status

Prepared; offline validation pending.

## Objective

Implement V4 from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the multi-node composable with query aggregate state, and the part the plan flagged from the start as the genuinely hard piece — a tuple-preserving generic so each node's result keeps its own specific type rather than collapsing into a union.

## Files changed

- `src/vue/use-nodes.ts` (new) — `UseNodesAggregate`, `UseNodesResults<TNodes>`, `UseNodesResult<TNodes>`, `useNodes`
- `src/vue/index.ts` — exports the above publicly
- `tests/vue/use-nodes-types.test.ts` (new) — compile-time type test
- `tests/vue/use-nodes.spec.ts` (new) — runtime behaviour tests

## The typing approach, and how it was actually proven, not just written

Rather than requiring callers to write `useNodes([a, b] as const)`, `useNodes` uses a `const` type parameter (`<const TNodes extends readonly AnyNodeDefinition[]>`) — the exact mechanism `defineDataNode`'s `dependencies` field already relies on in this codebase, not a new pattern invented for this step. `UseNodesResults<TNodes>` is a mapped tuple type (`{ [K in keyof TNodes]: ComputedRef<NodeRuntimeState<RuntimeNodeData<TNodes[K]>>> }`), so `results[0]` and `results[1]` keep their own node's specific type.

This is checked, not just asserted in a comment: `tests/vue/use-nodes-types.test.ts` follows the project's existing `tests/core/*-types.test.ts` convention exactly — validated only by `vue-tsc --noEmit`, never executed by `vitest` (confirmed against `vitest.config.ts`'s `include: ["tests/**/*.spec.ts"]`, which doesn't match `.test.ts` files, and against `package.json`'s scripts, none of which run `.test.ts` any other way). It asserts correct typed access to each result's own type via plain `const` assignments, and asserts the wrong-type case is rejected via two `@ts-expect-error` lines. Both directions matter: if a `@ts-expect-error` line stopped actually erroring, `tsc` itself would report an "unused directive" error, so a silent regression in either direction would fail the typecheck, not just look wrong on inspection.

## Two real bugs caught by actually compiling and running this, not by review

Both are left in this note for the same reason the "everything runs sync" claim and the V3D `"loading"` assumption were — a mistake caught while building is worth a record, not a quiet fix.

1. **`noUncheckedIndexedAccess` caught a real gap in `sync()`.** The first draft compared `state.value[index]` directly against `nextState` without checking for `undefined`, which this project's `tsconfig.json` correctly flags as possibly true for any indexed array access. Fixed by explicitly checking `previousState === undefined` before calling `statesEqual`. In practice this branch is never actually reached at runtime — `state.value` and `next` are always the same length, both being `nodes.map(...)` over the same fixed `nodes` array — but the type checker has no way to know that invariant holds, and the explicit check is cheap insurance against ever violating it by accident later.
2. **The same rule caught a second gap, one level up, in the test file itself, not in `useNodes`.** `tests/vue/use-nodes.spec.ts`'s own `mountProbe` test helper originally declared its generic as `<TNodes extends readonly Parameters<typeof useNodes>[0][number][]>` — a plain array type, not a tuple — which meant `captured.results[0]`/`results[1]` lost their fixed-length shape and `tsc` correctly flagged them as possibly `undefined` inside the test itself. Fixed by giving `mountProbe` the same `const` type parameter `useNodes` itself uses, rather than trying to derive the shape indirectly through `Parameters<typeof useNodes>`.

## Tests

`tests/vue/use-nodes-types.test.ts` (compile-time only, see above).

`tests/vue/use-nodes.spec.ts` (3 tests), matching the plan's V4 checklist:

- Mount subscribes to every node in the list with one combined subscription; unmount releases all of them
- Runtime values line up with the typed tuple order (`results[0]` is genuinely the first node's state, `results[1]` the second — not just typed that way, actually that way)
- Aggregate reflects partial failure correctly: one node succeeds, one fails, `isError`/`isSuccess`/`errors` all reflect the mixed state correctly while the successful node's own data remains readable

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 124/124 tests (121 pre-existing, unchanged, plus 3 new — the type-test file is correctly excluded from this count, matching the established convention), clean typecheck, clean boundary check.

## Next task

V5A: the shared configurable mock loader that every playground scenario will use, starting the playground work.
