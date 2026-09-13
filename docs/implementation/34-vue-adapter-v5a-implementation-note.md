# Milestone 4 V5A Implementation Note: Shared Configurable Mock Loader

## Status

Prepared; offline validation pending.

## Objective

Implement V5A from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the first piece of playground work — a shared, configurable mock loader every scenario (V5B–F) will use, so there's one instrumented loader shape instead of five slightly different ad hoc ones.

## Files changed

- `src/playground/mock-loader.ts` (new) — `MockLoader`, `createMockLoader`
- `tests/playground/mock-loader.spec.ts` (new)

## Design

`createMockLoader` returns a `load(produce)` function that wraps a caller-supplied `produce` callback with shared behaviour: an artificial delay (so loading states are actually reachable by hand instead of resolving before anyone can see them), a failure toggle (so scenario 3's error/retry demo has something to flip), and a call counter. The loader itself never decides what value a load resolves to — that's what `produce` is for — so every scenario can build on the same instrumented shape while still computing genuinely different values per node.

`callCount`, `shouldFail`, and `delayMs` are plain Vue `ref`s, not plain variables — the plan specifically calls for the call counter to be visible in-UI, not just in the console, which means it has to be something a component can render reactively. This module lives in `src/playground`, which is real Vue application code, not the framework-agnostic `src/core` layer, so using Vue reactivity directly here is fine and doesn't cross any boundary `scripts/check-boundaries.mjs` enforces.

Deliberately excluded for now: no `reset()` method. Nothing in the plan's V5A description calls for one, and it's cheap to add later if a specific scenario (V5B–F) turns out to need it — simpler to add on demonstrated need than to guess now.

## A test-authoring mistake caught by actually running this, not a bug in the loader

The first draft of the failure-toggle tests created the load promise, advanced fake timers, and only attached the rejection assertion afterward. Running it produced two "Unhandled Rejection" warnings from vitest — the promise was rejecting during the fake-timer advance, before anything was listening for it, even though the assertion a line later did eventually handle it correctly (all 5 tests reported as passing despite the warnings). Fixed by attaching `expect(promise).rejects.toThrow(...)` immediately after creating the promise, before advancing timers, so the handler exists before the rejection can occur — a Node/V8 unhandled-rejection detection detail specific to combining fake timers with async rejections, not a code path anyone would hit through this project's normal `whenSettled()`-based test style elsewhere.

## Tests

`tests/playground/mock-loader.spec.ts` (5 tests, using `vi.useFakeTimers()` so the delay behaviour is fast and deterministic rather than waiting real wall-clock time):

- `callCount` increments on every load
- Resolution genuinely waits the configured delay (not resolved at 499ms, resolved at 500ms)
- Rejects with the expected message when `shouldFail` is toggled on
- Resolves again once `shouldFail` is toggled back off
- `produce()` supplies the value — confirmed the loader doesn't return a fixed value of its own

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 129/129 tests (124 pre-existing, unchanged, plus 5 new), clean typecheck, clean boundary check.

## Next task

V5B: the first actual scenario, context switching, built on this loader.
