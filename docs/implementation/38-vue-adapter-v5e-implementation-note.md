# Milestone 4 V5E Implementation Note: Scenario 4 — Unmount Cleanup

## Status

Prepared; offline validation pending.

## Objective

Implement V5E from `docs/implementation/25-vue-adapter-and-playground-plan.md`: a node mounted behind `v-if`, with a visible, reactive subscriber count, so toggling the `v-if` and watching the count go to zero is a manual, visual confirmation that `onScopeDispose` actually ran — the scenario the plan itself calls out as most likely to look fine in an assertion while still leaking in a real app.

## Files changed

- `src/playground/scenarios/unmount-cleanup-nodes.ts` (new)
- `src/playground/scenarios/ToggleableConsumer.vue` (new) — the child mounted/unmounted via `v-if`
- `src/playground/scenarios/UnmountCleanupScenario.vue` (new) — the parent, owning the toggle and the visible count
- `tests/playground/scenarios/unmount-cleanup.spec.ts` (new)

## A design point worth being explicit about: the count is playground wiring, not a library feature

`getSubscriptionState()` is a plain function call — its return value isn't tracked by Vue's reactivity system. Displaying a live count required the scenario itself to subscribe to `runtime.onChange` and re-read `getSubscriptionState` on every notification, wrapped in a local `ref`. This was confirmed as viable before writing it, not assumed: `subscriptions/subscriptions.ts` calls `notify()` in both `subscribeNodes` and `unsubscribe()`, so the global `onChange` signal genuinely does fire on every subscribe/unsubscribe, which is what this reactive count depends on entirely. This pattern is scenario-local — `useNode`/`useNodes` have no reason to expose subscription counts as part of the public API, and don't.

## A real bug caught by actually running the test — in the test, not the component

First run failed immediately: `getByTestId("subscriber-count")` showed `"Subscribers: 0"` right after `render()`, when it should have shown `1` (the child, visible from the start via `v-if="true"`, subscribes during mount). Checked directly rather than guessed at twice in a row (this project has now hit exactly this shape of assumption-first-then-verify miss several times): a small diagnostic confirmed `runtime.getSubscriptionState(toggleableResource).direct` was **already `1`** immediately after `render()` — the actual subscription state was correct all along. What wasn't yet correct was the **DOM** — Vue batches reactive effects (including DOM patches) into the next tick, and my test was asserting on `textContent` synchronously, before anything had flushed that tick. Every other scenario test so far happened to sidestep this because they always awaited something (`fireEvent.click`, `vi.advanceTimersByTimeAsync`) before the first DOM assertion — this is the first one that checked DOM text immediately after `render()` with nothing awaited first. Fixed by moving the timer-advance (needed anyway, to let the mock loader resolve) ahead of the first assertion, rather than adding an unnecessary extra `nextTick()` call. Nothing in `UnmountCleanupScenario.vue` or `ToggleableConsumer.vue` needed to change.

## Tests

`tests/playground/scenarios/unmount-cleanup.spec.ts` (1 test): confirms the subscriber count starts at 1 with the consumer visible and loaded, drops to exactly 0 after clicking "Hide" — with an explicit check that the consumer's DOM content is actually gone (`queryByTestId` returns `null`), not just visually hidden — and returns to 1 (with a fresh load) after clicking "Show" again.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 134/134 tests (133 pre-existing, unchanged, plus 1 new), clean typecheck, clean boundary check.

## Next task

V5F: Scenario 5 — aggregate query, using `useNodes` under partial failure.
