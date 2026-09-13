# Milestone 4 V3B Implementation Note: Subscription and Sync Wiring

## Status

Prepared; offline validation pending.

## Objective

Implement the second sub-step of V3 (`useNode`) from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the actual `shallowRef` + `subscribeNodes` + `onChange` + `sync` wiring, built as its own internal primitive rather than directly inside the public `useNode` composable — so V4 (`useNodes`) can reuse it per-node without assuming a 1:1 relationship between a subscription and a Vue effect scope's dispose hook.

## Files changed

- `src/vue/node-subscription.ts` (new) — `createNodeSubscription`
- `tests/vue/node-subscription.spec.ts` (new)

## Scope, deliberately

This step does *not* include the effect-scope guard, `onScopeDispose` registration, or the public computed-refs shape — those are V3C, wrapped around this primitive. `createNodeSubscription` returns a raw `dispose()` function and leaves it to the caller to decide when and how it's invoked. Tests here construct a `GraphRuntime` directly and call `dispose()` themselves, with no mounted Vue component involved — that's intentional, this step has nothing to do with component lifecycle yet.

## The idempotency check the plan called for

The plan's V3B checklist specifically asked to verify — not assume — that `subscription.unsubscribe()` and the `onChange` unsubscribe function are each safe to call more than once, since `onScopeDispose` callbacks aren't guaranteed to run exactly once across every Vue version or edge case. Checked directly:

- `subscriptions/subscriptions.ts`'s `unsubscribe` guards itself with its own `active` flag (`if (!active) return;`), and separately throws if it would ever push a subscription count negative — the guard flag prevents that from happening on a double call.
- `observation/observer.ts`'s `onChange` returns an unsubscribe function guarded the same way.

Both are confirmed idempotent by the code itself, not by inference, and `tests/vue/node-subscription.spec.ts`'s "dispose is safe to call more than once" test exercises `dispose()` (which calls both) twice in a row to confirm the combination holds too.

## The test worth calling out specifically

"does not replace the ref when an unrelated node changes" is the one that actually proves the point of this whole plan, not just this step: two independent context nodes, one data node depending on only one of them, and a change to the *other* context. The test asserts `state.value` is the exact same object reference after the unrelated change — not just equal-looking, literally the same object — which is the end-to-end proof that `statesEqual` (V3A) is correctly wired into the real `onChange`/`getState` pipeline, not merely correct in isolation.

## Tests

`tests/vue/node-subscription.spec.ts` (5 tests): subscribes on creation, updates `state` on an actual change, does not replace the ref reference on an unrelated change, `dispose()` releases the subscription and stops syncing, `dispose()` is safe to call twice.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 116/116 tests (111 pre-existing, unchanged, plus 5 new), clean typecheck, clean boundary check.

## Next task

V3C: wrap `createNodeSubscription` with `assertActiveEffectScope`, `onScopeDispose`, and the public `useNode` computed-refs return shape.
