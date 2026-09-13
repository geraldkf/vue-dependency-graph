# Milestone 4 V3A Implementation Note: Dirty-Check Comparator

## Status

Prepared; offline validation pending.

## Objective

Implement the first sub-step of V3 (`useNode`) from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the field-by-field comparator that decides whether a mounted composable's internal ref actually needs to change after a global `onChange` notification.

## Files changed

- `src/vue/states-equal.ts` (new) — `statesEqual`
- `tests/vue/states-equal.spec.ts` (new)

## Why this got its own step, and its own direct test

The plan calls this "the single most important piece of correctness in the whole adapter" — get it wrong and every mounted component re-renders on every unrelated state change anywhere in the graph, silently, with nothing to fail an assertion, since the bug only shows up as excess renders, not incorrect data. That's why it's tested directly against hand-built `NodeRuntimeState` fixtures rather than only indirectly through a mounted component in V3D — a failure here needs to point straight at the comparator, not require narrowing it down from a component-level test first.

`generation` is deliberately excluded from the comparison. It increments on every invalidation even when `data`/`status`/`error`/`hasSuccessfulValue` all end up identical — for example, a context change that causes a derived node to be recomputed but land on the same result. Including it in the comparison would mean the dirty-check never actually filters anything out, defeating its purpose. The test file's "returns true when only generation differs" case exists specifically to guard this — it's the one case that would silently regress into uselessness if a future edit added `generation` to the comparison out of a instinct toward "compare everything."

## Tests

`tests/vue/states-equal.spec.ts` (7 tests): identical states, generation-only difference, and each of the five compared fields (`data`, `status`, `freshness`, `error`, `hasSuccessfulValue`) differing one at a time.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 111/111 tests (104 pre-existing, unchanged, plus 7 new), clean typecheck, clean boundary check.

## Next task

V3B: `useNode`'s subscription and sync wiring, which will consume `statesEqual` from this step.
