# Node Subscription Implementation Note

## Status

Validated offline before this terminology refactor. Refactor validation pending.

Step 3A introduced reference-counted node lifecycle ownership. This refactor changes public terminology only and intentionally preserves all accounting, validation, observation, and no-execution behavior.

## Public API

```ts
const subscription = runtime.subscribeNodes([Targets]);

runtime.getSubscriptionState(Targets);
runtime.hasSubscribers(Targets);

subscription.unsubscribe();
```

Runtime change listeners use a distinct API:

```ts
const stopObserving = runtime.onChange(listener);
```

## Subscription semantics

- Direct subscriptions count explicitly selected nodes.
- Required subscriptions count transitive ancestors.
- Total is direct plus required.
- One node subscription contributes once to each ancestor.
- Duplicate targets and shared ancestors are deduplicated per subscription.
- A directly subscribed parent does not also receive a required contribution from a child in the same subscription.
- Separate subscriptions contribute independently.

## Lifecycle and observation

- All targets are validated before counters change.
- Equivalent handles resolve through the registered key.
- Empty subscription is a no-op.
- `unsubscribe()` removes exactly one subscription's contributions and is idempotent.
- Subscribe and active unsubscribe each notify runtime change listeners once.
- Node subscriptions do not execute, schedule, cancel, or alter node runtime values in Step 3A.

## Backwards compatibility

This research repository has no established external consumers. Old API names and compatibility aliases are intentionally not retained. Type checking should identify missed call sites.

## Files renamed

- `src/core/subscription.ts` to `src/core/subscription.ts`
- Step 3A subscription test files to `node-subscription-*` test files
- Step 3A implementation note and implementation prompt to node-subscription names
- Step 3B prompt to `005-implement-automatic-subscription-scheduler.md`

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```
