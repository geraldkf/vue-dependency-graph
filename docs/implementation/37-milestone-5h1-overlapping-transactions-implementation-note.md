# Milestone 5H.1: Overlapping Transaction Semantics

## Status

Implementation prepared. Offline validation pending.

## Decision

Transaction calls that overlap on the same runtime join one transaction group.

The first call that opens the group is the **root transaction**. Any transaction call started before that group closes is a **joined transaction**, whether it is structurally nested or started independently by another caller.

This is the simplest predictable browser-compatible model. The runtime cannot reliably distinguish structural nesting from independently initiated overlap across arbitrary awaited gaps without changing the public API or introducing environment-specific asynchronous context tracking.

## Group lifecycle

- All participants share one staged context map.
- No participant exposes staged values through committed reads.
- The group commits or rolls back only after every participant settles.
- The root transaction promise does not settle before joined participants finish and the group commit or rollback completes.
- Notification buffering remains open for the complete group lifetime.

## Outcome ownership

The root transaction outcome controls the group:

- root success commits the final staged context values after all joined calls settle;
- root failure discards all staged context values after all joined calls settle;
- a joined failure remains visible to that joined caller but does not independently poison a successful root;
- a joined failure causes rollback when it propagates into the root transaction, as with an awaited nested call that is not caught;
- a caught nested failure does not poison the root, preserving the existing nested transaction contract.

This removes the previous completion-order dependency where whichever participant happened to finish last could control commit or rollback.

## Implementation

`src/core/transactions/transaction-coordinator.ts` now records root success separately from participant depth.

If root work finishes while joined calls remain active, its wrapper waits on a group-local settlement promise. The final joined participant resolves that promise when participant depth reaches zero. The root then applies commit or rollback and allows the notification buffer to flush.

No public API was added or changed.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- overlapping calls share staged context values;
- committed state remains unchanged after root work finishes while a joined call is active;
- the root transaction promise remains pending until every participant settles;
- successful root work commits changes made by a joined call even when that joined call reports its own failure;
- root failure rolls back successful joined work;
- existing nested success, propagated failure, and caught inner failure semantics remain unchanged.

The tests use deferred promises rather than timing delays.

## Alternatives considered

### Reject overlapping calls

Rejected because the runtime cannot distinguish an independently overlapping call from a legitimate nested call without changing the transaction API.

### Serialise transaction calls

Rejected because an outer transaction awaiting a nested transaction would deadlock behind itself.

### Roll back after any participant failure

Rejected because it would make a caught nested failure silently poison otherwise successful outer work, contradicting the established nested transaction contract.

### Let the final participant decide

Rejected because commit or rollback would depend on completion timing rather than transaction ownership.

## Validation

Completed in the contained environment:

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Run offline:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M5H.1 remains validation pending until those commands pass.

## Next follow-up

M5H.2 may split the transaction tests into focused files after M5H.1 validation. It should not change behaviour.
