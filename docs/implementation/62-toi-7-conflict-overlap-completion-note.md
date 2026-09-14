# TOI-7 Conflict and Overlap Completion Note

## Status

Prepared. Offline validation pending.

## Implemented

- Added optimistic generation-based conflict detection for staged contexts.
- Captured the committed generation when each context is first staged.
- Preserved that original expected generation across repeated and joined staged writes.
- Checked every staged context before event predicate evaluation or graph mutation.
- Added public `GraphTransactionConflictError` with immutable, deterministically sorted `contextKeys`.
- Rejected conflicting transactions atomically without applying staged contexts, staged events, invalidation, cancellation, notification, or scheduling.
- Preserved independently committed context writes.
- Confirmed that explicit overlapping transaction calls continue joining one shared group and retain the existing root-owned outcome.
- Added focused tests for single and multiple conflicts, atomic event discard, reverted staged values, deterministic keys, and writes completed before first staging.

## Conflict rule

A conflict occurs when a context's committed generation differs from the generation captured when that context was first staged. A plain runtime write completed before first staging becomes the expected baseline and does not conflict. A write after first staging conflicts even if the transaction's final staged value returns to the original value.

## Atomic outcome

Conflict checking runs before staged event predicates. If any key conflicts:

- the transaction rejects with `GraphTransactionConflictError`;
- no staged context commits;
- no staged publication is evaluated or applied;
- no transaction-owned graph invalidation, abort, notification, or scheduler request occurs;
- immediate runtime changes remain committed.

## Overlapping transactions

The existing joined-group model remains intentionally unchanged. Root and joined callbacks share staged contexts, expected generations, and publications. Every participant settles before closure, and the root outcome controls commit or rollback. All group handles close together.

## Validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Offline validation remains pending because dependencies are not installed in the stored workspace.
