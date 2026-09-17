# Milestone 9B: Atomic Direct Cache Reconciliation

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds direct graph-cache reconciliation after confirmed remote mutation success. It does not add optimistic updates, rollback snapshots, failure classification, explicit success invalidation, typed event publication, retry, deduplication, user cancellation, or mutation diagnostics.

## Public API

`runtime.mutate(...)` now accepts optional success effects:

```ts
await runtime.mutate(SaveAppointment, input, {
  onSuccess: (effects, result, originalInput) => {
    effects.update(Appointments, current =>
      reconcileAppointment(current, result, originalInput)
    );
  },
});
```

`effects.update(...)` accepts data-node definitions only. Its updater receives and returns the exact node value type. Context and derived nodes are rejected at compile time, with defensive runtime validation for untyped callers.

## Draft and validation model

The success callback records update intentions without changing graph state. After the callback returns synchronously, the runtime:

1. resolves every target by registered key;
2. rejects non-data targets;
3. rejects duplicate writes to one registered node;
4. verifies every target has a successful value;
5. evaluates every updater;
6. rejects asynchronous callbacks and Promise-like updater results;
7. commits only after all validation and updater evaluation succeeds.

A callback or updater exception applies no mutation-owned graph change. Because remote execution has already succeeded, this is reported as local reconciliation failure and does not claim remote rollback.

## Atomic commit

For every effective update, the runtime:

- stores the replacement value;
- sets status to success and freshness to fresh;
- clears the error;
- advances generation once;
- preserves successful-value history;
- aborts active target attempts after all updated target generations advance.

Changed-result descendants are collected across all updated roots, deduplicated, and invalidated before the single observer notification. A directly updated target is excluded from descendant invalidation even when another updated root reaches it. Subscribed stale descendants request one scheduler pass through the existing scheduler.

An `Object.is` equal value on an already successful, fresh, error-free node is a silent local no-op.

## Narrow invalidation seam

The invalidation controller now exposes an internal dispatch-free operation for changed-result descendants. This is the concrete seam required to keep root reconciliation and descendant invalidation within one observable commit. It reuses existing stale-state, generation, abort, and subscriber detection behaviour.

The touched breadth-first descendant traversal now uses an index-based queue instead of repeatedly removing the first array item. Traversal order and deduplication remain unchanged.

No stale-state policy moved into the state store, and no general invalidation, execution, transaction, refresh-policy, or Vue refactor was introduced.

## Error model

`GraphMutationStateError` is exported for mutation-local state validation failures. It exposes the affected `nodeKey` for non-data targets, duplicate update targets, missing successful values, and asynchronous updater results.

Unknown node handles preserve the runtime's established registered-node validation error. Callback and updater exceptions preserve the original thrown error.

## Tests

Focused behaviour coverage includes:

- atomic updates across multiple data nodes;
- one coherent observer snapshot;
- typed result and input access in `onSuccess`;
- callback failure before updater evaluation;
- updater failure before any commit;
- duplicate target rejection;
- equivalent registered handles;
- defensive non-data target rejection;
- missing successful-value rejection;
- silent equal-value updates;
- descendant invalidation;
- subscribed descendant scheduling;
- target generation advancement and active-attempt abort ordering;
- ignored-abort completion protection through existing generation checks.

Compile-time coverage verifies data-node value inference and rejects wrong updater results, context targets, and derived targets.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict standalone TypeScript compilation of `src/core/**/*.ts` passed.
- Focused strict TypeScript compilation of mutation source and tests passed using a local Vitest declaration shim because repository dependencies are not installed.
- Static source, documentation, and ZIP integrity checks are completed when the prepared package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9B remains validation pending until all four commands succeed against the combined checkout.

## Next task

After successful M9B validation, proceed with M9C success invalidation and typed event publication. M9C should extend the same atomic local commit rather than replaying separate runtime operations.
