# Milestone 4 V3D Implementation Note: `useNode` Tests

## Status

Prepared; offline validation pending.

## Objective

Implement V3D from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the committed test suite for `useNode`, closing out V3.

## Files changed

- `tests/vue/use-node.spec.ts` (new)

## A wrong assumption caught by actually running the test, not by review

The first draft asserted `status.value` was `"loading"` immediately after mounting a component that subscribes to a data node — synchronously, with no `await`. That failed: the actual value was `"idle"`. This wasn't a bug in `useNode` — it's correct behavior. Subscribing doesn't synchronously start a load; the scheduler's flush is microtask-queued (see the scheduler design discussed earlier in this project), so immediately after mount the node is still in its untouched initial state. The test was asserting something that was never true, not documenting a regression. Fixed by asserting `"idle"` (and the initial `data` value) right after mount, then `"success"` only after `await runtime.whenSettled()`. Left in this note deliberately, the same way the earlier "everything runs sync" claim was checked and corrected rather than quietly fixed and forgotten — a wrong assumption caught while writing a test is exactly the kind of thing worth a paper trail.

## Tests

`tests/vue/use-node.spec.ts` (5 tests), matching the plan's V3D checklist exactly:

- Mount creates a subscription (`getSubscriptionState(node).direct` goes from 0 to 1)
- Unmount releases it (back to 0)
- Reacts to status/data changes: `idle` → `success` after settling, then a new value after a context change and re-settling
- Two consumers mounted on the same node share one load — asserted via a mock loader call-count of exactly 1 across both. This is a Vue-layer test that the composable doesn't accidentally break the core's existing execution dedup; it is not a re-test of the dedup mechanism itself, which already has its own core-level tests.
- Calling `useNode` outside an active effect scope throws, delegating to V2's guard, confirmed here at the actual point of use rather than only in V2's own isolated test

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 121/121 tests (116 pre-existing, unchanged, plus 5 new), clean typecheck, clean boundary check.

## V3 status

V3 (`useNode`) is now complete: V3A (comparator), V3B (subscription wiring), V3C (public shape), V3D (tests).

## Next task

V4: `useNodes`, reusing `createNodeSubscription` (V3B) and `statesEqual` (V3A) per-node, plus the query aggregate state and the alias-preserving tuple typing the plan flagged as the genuinely hard part of this step.
