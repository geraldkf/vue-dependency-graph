# Milestone 4 V5B Implementation Note: Scenario 1 — Context Switching

## Status

Prepared; offline validation pending.

## Objective

Implement V5B from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the first real playground scenario — one context node, a couple of buttons to change it, one dependent data node showing its loading → success cycle. The smallest possible proof the whole chain (context → invalidation → scheduler → execution → composable → DOM) works end to end.

## Files changed

- `src/playground/scenarios/context-switching-nodes.ts` (new) — node definitions and a scenario-local mock loader instance
- `src/playground/scenarios/ContextSwitchingScenario.vue` (new) — the UI
- `tests/playground/scenarios/context-switching.spec.ts` (new)

## A design decision this step forced, ahead of V5G

Node keys have to be unique across the whole graph — `createGraph` throws `GraphValidationError("DUPLICATE_NODE_KEY", ...)` on any duplicate, confirmed directly against `graph/graph.ts` rather than assumed. Once V5G assembles one shared runtime for the whole playground, every scenario's nodes will live in the same graph, so each scenario's keys are namespaced now (`scenario:context-switching:...`) rather than left as something that would only surface as a crash once V5G lands.

Node definitions live in a separate plain `.ts` file (`context-switching-nodes.ts`), not inside the `.vue` file's `<script setup>` block. Vue SFCs don't expose named exports from `<script setup>` for other modules to import — only the component itself, as a default export — and V5G needs to import every scenario's node list to assemble one shared graph. Keeping definitions in a plain module the `.vue` file also imports from solves this cleanly, without requiring V5G to reach into SFC internals.

The component imports from the public `"../../vue"` barrel, not internal `src/vue` files — this scenario exists specifically to prove the public API works, so it's written the way a real external consumer of the framework would write it, not the way an internal test would.

## A timing detail worth knowing, checked empirically rather than assumed or guessed at a second time

Having already gotten this wrong once in V3D (assuming `"loading"` appears synchronously right after mount, when it's actually `"idle"` until the scheduler's microtask-queued flush runs), the natural next wrong guess would be assuming `"loading"` appears synchronously right after a button click. Checked directly with a throwaway test (not committed): immediately after `fireEvent.click(...)` resolves, status is still `"success"` — the *previous* value, now stale — not yet `"loading"`. `setContext` marks the node stale synchronously, but the scheduler's flush that actually transitions status to `"loading"` hasn't run yet by the time Vue's own reactivity has settled and the DOM has updated. The committed test doesn't assert on that exact window — it advances the mock loader's full delay before checking anything, which is comfortably past this — but it's worth knowing precisely for V5C–F, all of which will trigger similar state transitions from user interaction.

## Tests

`tests/playground/scenarios/context-switching.spec.ts` (1 test, using `vi.useFakeTimers()` per the pattern established in V5A): mounts the scenario with its own isolated test runtime (not dependent on V5G's not-yet-built shell), confirms the initial `idle` → `success` cycle loads user #1's profile, then clicks "User 2" and confirms the profile updates to user #2's after the mock loader's delay elapses.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 130/130 tests (129 pre-existing, unchanged, plus 1 new), clean typecheck, clean boundary check.

## Next task

V5C: Scenario 2 — concurrent consumers, using V5A's visible call counter to make shared-load dedup observable by eye.
