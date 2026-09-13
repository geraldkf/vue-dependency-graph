# Milestone 4 V5D Implementation Note: Scenario 3 — Error and Retry

## Status

Prepared; offline validation pending.

## Objective

Implement V5D from `docs/implementation/25-vue-adapter-and-playground-plan.md`: a failure toggle on the mock loader, a manual refresh button, visible error state — both the initial-load-failure and refresh-failure-with-stale-data paths, rendered and exercised, not only asserted against isolated pieces.

## Files changed

- `src/playground/scenarios/error-and-retry-nodes.ts` (new)
- `src/playground/scenarios/ErrorAndRetryScenario.vue` (new)
- `tests/playground/scenarios/error-and-retry.spec.ts` (new)
- `tests/setup.ts` (new) — see "A generalizable bug" below
- `vitest.config.ts` — registers the above via `setupFiles`

## The state semantics this scenario relies on, checked directly rather than assumed

Read `execution/execution.ts` directly before designing the UI, rather than guess at what a failed refresh leaves behind. On failure: `current.status = "error"`, `current.error` is set, but **`current.data` is left untouched and `current.hasSuccessfulValue` is not reset** — both only ever get set on a *successful* attempt. So a refresh that fails after a prior success leaves the old good data fully intact and readable, with the new error surfaced alongside it, not instead of it. `ErrorAndRetryScenario.vue`'s template deliberately renders `data` and `error` as two independent fields rather than switching to an error view that hides the data — that's a direct reflection of what the core actually does, not a UI choice made in isolation from it.

## Two real bugs caught by actually running this, neither of them in the scenario's own logic

**1. A generalizable testing-infrastructure gap, not scoped to this scenario.** `@testing-library/vue` exports a `cleanup()` function but nothing was calling it — `vitest.config.ts` had no `setupFiles` entry at all. Every scenario test so far (V5B, V5C) happened to only call `render()` once per file, so this never surfaced. This is the first scenario test with two mounts in one file, and running it produced a "multiple elements found" failure — `getByTestId("status")` matched both the first test's still-mounted output and the second test's. Fixed globally, not per file: `tests/setup.ts` registers `afterEach(cleanup)` once, wired in via `vitest.config.ts`'s `setupFiles`, so every future test file gets this for free rather than needing to remember it. Re-ran the full 133-test suite after adding it to confirm nothing else was relying on the previous (accidental) lack of cleanup — nothing was.

**2. `runtime.refresh(...)` rejects on failure, and the first draft's `@click` handler didn't catch it.** `refresh()` records the failure in the node's own reactive state (which `resource.error`/`resource.status` already reflect) *and* rejects the promise it returns. A plain `@click="runtime.refresh([flakyResource])"` leaves that rejection with nothing handling it — a genuine unhandled promise rejection, confirmed by vitest's own "Unhandled Rejection" report during the test run, not a style nitpick. Fixed with an explicit `handleRefresh` that catches and deliberately does nothing further, since the reactive state is already the UI's source of truth. This is worth knowing for any real app calling `refresh()`/`execute()` directly from an event handler: the promise needs handling even when the reactive state already covers the UI.

## Tests

`tests/playground/scenarios/error-and-retry.spec.ts` (2 tests):

- Initial load failure: toggling failure on before the first load ever completes leaves `status: "error"`, `data: "(none yet)"` (there was never a successful value), and the error message rendered.
- Refresh failure with stale data: a first load succeeds, the failure toggle is then flipped **through the actual checkbox**, not by setting the underlying ref directly (proving the `v-model` wiring genuinely works, not just that the ref supports it — already covered by V5A), a refresh is triggered, and the previous successful data remains visible and correct alongside the new error.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 133/133 tests (131 pre-existing, unchanged, plus 2 new), clean typecheck, clean boundary check.

## Next task

V5E: Scenario 4 — unmount cleanup, with a visible subscriber count.
