# Milestone 5D: Atomic Commit and Coalesced Invalidation

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice replaces M5C's per-context application loop with one commit-wide context and invalidation operation.

A successful outer transaction now:

- removes context changes whose final values equal committed values;
- applies each effective context once;
- increments each changed context generation once;
- collects the transitive descendant union for all changed contexts;
- invalidates each affected descendant once;
- advances each affected descendant generation once;
- aborts affected active attempts after committed generations advance;
- leaves unrelated active attempts unchanged;
- issues one notification;
- requests at most one automatic scheduler pass.

## Implementation

### Commit-wide invalidation controller operation

`src/core/invalidation/invalidation.ts` now exposes an internal `commitContexts(...)` operation.

It performs final-state reconciliation against committed state using `Object.is`. If every staged value is unchanged or reverted, it returns without mutating state, notifying, scheduling, or aborting work.

For effective changes, it first applies all context state records and then traverses descendants from all changed roots. A single visited-key set deduplicates:

- descendants shared by multiple context roots;
- nodes reached through diamond paths;
- nodes reached through both direct and indirect paths.

The invalidation transition remains consistent with existing behaviour:

- generation increments once;
- freshness becomes `stale`;
- status becomes `success` when stale successful data exists, otherwise `idle`;
- error is cleared;
- data and `hasSuccessfulValue` are preserved.

Active attempts are aborted in a second loop after all descendant generations have advanced. This ensures an abort-aware or abort-ignoring completion is already obsolete according to committed generation state.

### Immediate context updates

The existing non-transaction `setContext(...)` path now delegates to `commitContexts(...)` with one resolved context change. Its observable behaviour remains unchanged.

### Transaction coordinator

`src/core/transactions/transaction-coordinator.ts` now passes the complete staged context collection to one `commitContexts(...)` call. It still clears transaction-local staging before commit application.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- two changed contexts sharing one descendant increment that descendant generation once;
- diamond descendants are invalidated once;
- a multi-context subscribed update causes one scheduler execution;
- observer notification remains coalesced to one call;
- affected active work is not aborted while values are staged;
- affected active work is aborted at commit after generation advances;
- active work outside the affected descendant set is not aborted;
- M5C final-value and reverted-value behaviour remains intact.

## Deliberately unchanged

This slice does not alter:

- committed-read semantics during a transaction;
- explicit execute, prefetch, or refresh guards;
- independent execution completion while a transaction is open;
- subscription lifecycle behaviour;
- concurrency-limiter admission;
- notification-buffer ownership.

M5E remains responsible for completing failure and notification-buffer rollback semantics, especially where unrelated runtime activity produces buffered dispatch while an asynchronous transaction later fails.

## Static inspection

Confirmed:

- context equality is checked before any graph mutation;
- context records are committed before descendant generation changes;
- one visited set covers all changed roots;
- attempts are aborted only after affected generation changes;
- notification occurs after the complete synchronous commit;
- schedule is requested once only when an affected descendant has subscribers;
- immediate context behaviour still uses the same commit implementation;
- core boundaries pass.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

This slice remains validation pending until those commands succeed against the combined repository.

## Next task

M5E will complete rollback and failure-path coordination, including notification-buffer handling for independent runtime changes that occur while an asynchronous transaction is open.
