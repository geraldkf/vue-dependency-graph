# Milestone 4 V3C Implementation Note: Scope Guard and Public Return Shape

## Status

Prepared; offline validation pending.

## Objective

Implement the third sub-step of V3 from `docs/implementation/25-vue-adapter-and-playground-plan.md`: the actual public `useNode` composable, wrapping V3B's `createNodeSubscription` primitive with V2's `assertActiveEffectScope` guard, `onScopeDispose` registration, and the computed-refs return shape.

## Files changed

- `src/vue/use-node.ts` (new) — `UseNodeResult<TNode>`, `useNode`
- `src/vue/index.ts` — exports `useNode` and `UseNodeResult` publicly

## What this step deliberately does not include

Per the plan's own split, committed tests are V3D, not this step — V3C is "wire it up," V3D is "prove it end-to-end." That said, before calling this done, a throwaway smoke check (not committed — removed after running) confirmed `useNode` genuinely throws outside a scope, subscribes on mount, reacts to a context change, and unsubscribes on unmount, all inside a real mounted component via `@testing-library/vue`. Typecheck passing alone wouldn't have been enough confidence to call this finished; the smoke run was.

## The composition, and why the pieces are ordered this way

`useNode` is a thin composition of three already-independently-tested pieces, in this order:

1. `assertActiveEffectScope("useNode")` — fails loudly immediately if called somewhere `onScopeDispose` would silently do nothing (V2).
2. `createNodeSubscription(runtime, node)` — the actual subscribe/sync wiring (V3B).
3. `onScopeDispose(dispose)` — registers V3B's `dispose` (which itself calls both the subscription's `unsubscribe` and the `onChange` listener's stop function) against the now-confirmed-active scope.

The return shape is five individual `computed()` refs derived from `createNodeSubscription`'s internal `state` ref, rather than one nested ref — `const { data, status } = useNode(userNode)` stays reactive after destructuring this way, which a plain object wouldn't, and matches the ergonomics decision recorded in the plan doc.

## Tests

None committed in this step — see "What this step deliberately does not include" above. V3D covers this next.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 116/116 tests (unchanged from V3B, since this step added no committed tests of its own), clean typecheck, clean boundary check.

## Next task

V3D: the committed test suite for `useNode` — mount creates subscription, unmount releases it, reactive status/data changes, two consumers share one load, calling outside a scope throws.
