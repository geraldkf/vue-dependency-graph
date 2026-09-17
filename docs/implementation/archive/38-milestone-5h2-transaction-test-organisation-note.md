# Milestone 5H.2: Transaction Test Organisation

## Status

Test organisation change prepared. Offline validation pending.

## Objective

Split the growing transaction integration suite into focused behaviour-based files without changing runtime behaviour, test assertions, or test utilities.

## Changes

Removed the single `tests/core/transaction.spec.ts` file and distributed its 29 existing tests across six focused suites:

```text
tests/core/transaction-staging.spec.ts
tests/core/transaction-invalidation.spec.ts
tests/core/transaction-rollback.spec.ts
tests/core/transaction-settlement.spec.ts
tests/core/transaction-races.spec.ts
tests/core/transaction-overlap.spec.ts
```

### Staging and operation boundaries

Contains:

- behaviour outside transactions;
- asynchronous staging and notification coalescing;
- nested final-value staging;
- committed reads while open;
- reverted-value no-op behaviour;
- execute, prefetch, and refresh guards;
- guarded operations becoming available after completion.

### Commit invalidation

Contains:

- one scheduler pass for multi-context commit;
- shared descendant deduplication;
- diamond-path deduplication;
- commit-time abort ordering;
- unaffected active work remaining active.

### Rollback

Contains:

- synchronous and asynchronous rollback;
- propagated and caught inner failures;
- outer failure after inner success;
- active work after rollback;
- independent execution completion during rollback.

### Settlement

Contains:

- transaction-time settlement around subscription changes;
- settlement through successful commit scheduling;
- rollback settlement without phantom work.

### Execution races

Contains:

- completion before commit preserved as stale data;
- ignored-abort completion after generation advancement remaining obsolete.

### Overlapping transactions

Contains the M5H.1 root and joined-participant semantics.

## Scope discipline

This is an organisation-only change:

- no runtime source changed;
- no assertions changed;
- no test was added or removed;
- no transaction-specific test helper was introduced;
- existing `deferred(...)` and `waitForCondition(...)` helpers remain in `test-helpers.ts`;
- each suite imports only the symbols it uses.

The total remains 29 transaction tests.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
```

The boundary check passed.

The strict core-only TypeScript validation from earlier Milestone 5 work does not include test files. Full test-file type checking and execution remain offline responsibilities.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Confirm that Vitest discovers all six transaction suites and still reports 29 transaction tests.

## Next follow-up

M5H.3 may review the internal transaction contracts after M5H.2 validation. It should avoid public type-breaking changes unless the public export decision is handled explicitly.
