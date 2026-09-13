# Milestone 4 V5C Implementation Note: Scenario 2 — Concurrent Consumers

## Status

Prepared; offline validation pending.

## Objective

Implement V5C from `docs/implementation/25-vue-adapter-and-playground-plan.md`: two components independently calling `useNode` on the same node, mounted side by side, with V5A's visible call counter making dedup observable by eye, not just by assertion.

## Files changed

- `src/playground/scenarios/concurrent-consumers-nodes.ts` (new) — one dependency-free data node and its own mock loader instance
- `src/playground/scenarios/ConsumerPanel.vue` (new) — a small reusable panel, mounted twice
- `src/playground/scenarios/ConcurrentConsumersScenario.vue` (new) — renders two `ConsumerPanel`s side by side plus the visible load-call counter
- `tests/playground/scenarios/concurrent-consumers.spec.ts` (new)

## A design choice worth explaining: no node prop

`ConsumerPanel.vue` takes a `label` prop for display only — it does not take the node itself as a prop. It always subscribes to the same fixed `sharedResource` node, imported directly. The "two independent consumers" effect comes entirely from mounting the same component twice: Vue gives each mounted instance its own `setup()` call, so each instance's `useNode(sharedResource)` is a genuinely separate call with its own subscription and its own effect scope, exactly mirroring what two unrelated real components calling `useNode` on the same node from different parts of an app would do. Making the node a generic prop would have added type-parameter ceremony to a playground component without proving anything more than this simpler version already does.

## Tests

`tests/playground/scenarios/concurrent-consumers.spec.ts` (1 test): mounts the scenario with an isolated test runtime, confirms two independent subscriptions exist (`getSubscriptionState(sharedResource).direct === 2` — a check that neither panel instance accidentally shares its subscription with the other), confirms both panels render `success` with the loaded data after the mock delay, and confirms the actual point of the scenario — `sharedResourceLoader.callCount.value === 1` despite two consumers, both in the underlying loader state and in what the rendered call-counter text shows. This is a Vue-layer check that `useNode` doesn't accidentally defeat the core's existing execution dedup; it isn't a re-test of the dedup mechanism itself, which already has its own core-level tests.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 131/131 tests (130 pre-existing, unchanged, plus 1 new), clean typecheck, clean boundary check.

## Next task

V5D: Scenario 3 — error and retry, using the mock loader's failure toggle.
