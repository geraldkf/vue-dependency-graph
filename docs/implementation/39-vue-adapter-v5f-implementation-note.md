# Milestone 4 V5F Implementation Note: Scenario 5 — Aggregate Query

## Status

Prepared; offline validation pending.

## Objective

Implement V5F from `docs/implementation/25-vue-adapter-and-playground-plan.md`: several nodes via one `useNodes` call, one wired to a failure toggle, to see the aggregate `isError`/`isSuccess` behave correctly under partial failure — the last of the five playground scenarios.

## Files changed

- `src/playground/scenarios/aggregate-query-nodes.ts` (new) — three metrics, one with its loader exported for the UI's failure toggle
- `src/playground/scenarios/AggregateQueryScenario.vue` (new)
- `tests/playground/scenarios/aggregate-query.spec.ts` (new)

## A real finding about `isSuccess`'s semantics, caught by running the test, not by re-reading the code a second time

The first draft of the partial-failure test expected `isSuccess` to flip to `false` the moment metric C's refresh failed. It didn't — `isSuccess` stayed `true`. This was the test's assumption being wrong, not a bug in `useNodes`: `isSuccess` is built on each node's `hasSuccessfulValue`, and `execution.ts` (checked back in V5D, confirmed again here) never resets `hasSuccessfulValue` to `false` on a failed attempt — it only ever gets set to `true`, on success. Metric C had already succeeded once before being toggled to fail and reloaded, so `hasSuccessfulValue` correctly stayed `true` for all three metrics even after C's latest refresh failed.

This means `isSuccess` and `isError` can be `true` at the same time, and that's correct, not contradictory: "there is displayable data for every node" and "something's most recent attempt failed" are independent facts, and both can hold at once — exactly the "stale data stays visible alongside a fresh error" behavior V5D demonstrated at the single-node level, now showing up correctly in the aggregate too.

Fixed the test's expectation, and added a third test that isolates the other case for contrast: a metric that has **never** succeeded (failure toggled on before the very first load) correctly does make `isSuccess` `false`. Having both cases side by side in the test suite is more useful than either alone — it makes the actual rule ("`isSuccess` tracks accumulated success, not the latest attempt") explicit rather than something a reader has to infer from one passing assertion.

## Tests

`tests/playground/scenarios/aggregate-query.spec.ts` (3 tests):

- Full success: all three metrics load, aggregate `isSuccess: true`, `isError: false`, zero errors.
- Partial failure after prior success: metric C is toggled to fail (via the actual checkbox) and reloaded; A and B remain correct and unaffected; `isError: true`; `isSuccess` **stays `true`** (see above) because C still has its earlier successful value; error count is 1.
- Never-succeeded case: C's failure is toggled on before the very first load ever completes; `isSuccess` is correctly `false` here, distinguishing this from the previous case.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 137/137 tests (134 pre-existing, unchanged, plus 3 new), clean typecheck, clean boundary check.

## V5 status

All five scenarios (V5B–F) are now built, each with its own isolated test runtime. Only V5G (the playground shell wiring them all together) and V6 (playground smoke tests against that shell) remain to close out Milestone 4's playground work.

## Next task

V5G: the playground shell — replacing the stub `App.vue` with tabs across all five scenarios, and installing the plugin once in `main.ts` with one runtime built from every scenario's nodes merged together.
