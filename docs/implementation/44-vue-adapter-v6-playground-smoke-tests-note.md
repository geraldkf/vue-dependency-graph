# Milestone 4 V6 Implementation Note: Pinia-Backed Playground Smoke Tests

## Status

Prepared; offline command validation pending.

Manual playground validation was reported successful before this step: all five Pinia-backed scenarios appeared to run correctly in the browser.

## Objective

Complete the playground shell smoke coverage by proving that every scenario tab mounts through one Pinia-owned runtime and that switching tabs releases the previous scenario's graph subscriptions.

## Files changed

- `tests/playground/App.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/25-vue-adapter-and-playground-plan.md`
- `docs/implementation/44-vue-adapter-v6-playground-smoke-tests-note.md` (this file)

## Tests

`tests/playground/App.spec.ts` now contains two focused shell tests.

### Every scenario mounts

The first test installs one Pinia instance, mounts `App.vue`, and visits every tab:

- Context Switching
- Concurrent Consumers
- Error and Retry
- Unmount Cleanup
- Aggregate Query

For each tab it verifies the scenario heading and active `aria-pressed` state. This catches missing imports, missing Pinia context, setup-time errors, and broken dynamic-component wiring at the shell level.

### Tab changes release subscriptions

The second test retrieves the same store-owned runtime and verifies direct subscription counts while moving through every scenario:

- Context Switching owns one subscription for its context node and one for its profile node.
- Concurrent Consumers owns two direct subscriptions to its shared resource.
- Error and Retry owns one subscription to its resource.
- Unmount Cleanup owns one subscription while its child is visible.
- Aggregate Query owns one subscription for each of its three metrics.

After every tab change, the previous scenario's direct counts return to zero before the next scenario's expected counts are asserted. Returning to Context Switching confirms that a previously unmounted scenario can subscribe again correctly while the same Pinia store and graph runtime remain alive.

## Scope

V6 changes tests and documentation only. No library, core, playground component, store, graph, or application bootstrap source changed.

Existing scenario-specific tests continue to cover operational behaviour such as loading, context changes, shared execution, refresh failure, stale data retention, child unmount cleanup, and aggregate partial failure. V6 avoids duplicating those assertions and focuses on shell integration and lifecycle boundaries.

## Static inspection

- No `src` files changed.
- The test installs Pinia and does not install the graph runtime plugin.
- The test uses the real dependency graph store and runtime.
- The dependency-free core boundary check passes.

## Offline validation

Apply V4A, V4B, V4C, V5G, and V6 in order, then run:

```text
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
pnpm install --frozen-lockfile
```

Milestone 4 should be marked fully validated only after the project commands pass. Manual browser validation has already been reported successful.
