# Milestone 5H.6C: Observer Snapshot Test Fix

## Status

Fix validated as part of the final Milestone 5 automated and manual validation reported successful on 14 September 2026.

## Issue

The Atomic Transaction scenario recorded every runtime notification as an observer snapshot. Initial subscription and derived-node execution notifications do not change the two context values, but they repeatedly recorded the initial pair `1 + 10`.

This caused the progress and rollback tests to find a non-empty committed observer history even though no context value had committed.

## Fix

The scenario now tracks the last observed committed context pair.

On each runtime notification it:

1. reads the committed first and second context values;
2. formats the committed pair;
3. ignores the notification when the pair is unchanged;
4. records a snapshot only when the committed context pair changes.

The initial comparison value is captured before observation begins, so subscription, loading, derived-result, and scheduler notifications for the initial `1 + 10` state do not create false context snapshots.

Reset also synchronises the comparison value with the restored committed pair after clearing history.

## Behaviour preserved

- Progress notifications do not produce committed snapshots.
- Rollback produces no committed snapshot.
- Successful commit records `2 + 20` once.
- Derived and scheduler notifications after commit do not duplicate the pair.
- Reset clears history and establishes `1 + 10` as the new comparison baseline.

## Scope

No core runtime source, transaction behaviour, public API, or test assertion changed.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. Full Vue component test execution remains an offline responsibility.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```
