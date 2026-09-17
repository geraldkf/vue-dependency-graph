# Milestone 5C: Staged Context Values

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice stages context writes while a transaction is active and keeps committed graph state unchanged until the successful outer transaction completes.

It provides:

- committed `getState(...)` reads during open transactions;
- final-value staging per context key;
- shared staging across nested transactions;
- immediate context-node validation;
- discard of staged values when the outer transaction fails;
- unchanged immediate `setContext(...)` behaviour outside transactions.

M5C deliberately reuses the current single-context invalidation path when applying staged values. Multi-root descendant deduplication, one commit-wide invalidation pass, and commit-wide abort reconciliation remain M5D work.

## Implementation

### Transaction coordinator

`src/core/transactions/transaction-coordinator.ts` now owns a transaction-local map keyed by registered context-node key.

Each entry stores only:

- the registered context handle;
- the final staged value.

A later write to the same context replaces the earlier staged value. The map is not exposed through public reads.

At successful outer completion, the coordinator clears its staging map before applying final values through the existing invalidation controller. Clearing first prevents stale staging state if commit application throws.

At failed outer completion, the coordinator discards the map and preserves the original error.

Nested transactions share the same map and only the outermost completion applies or discards it. A caught inner failure does not poison the outer transaction.

### Context validation

`src/core/invalidation/invalidation.ts` now exposes its existing registered-context resolution as an internal controller operation. This allows `setContext(...)` to preserve immediate validation while avoiding state mutation during staging.

No new public API is exported.

### Runtime composition

`src/core/runtime.ts` exposes `transactions.setContext` through the runtime. The coordinator delegates directly to `invalidation.setContext` when no transaction is active.

## Observable behaviour

During an open transaction:

```ts
runtime.setContext(context, 2);
runtime.getState(context).data;
```

The read returns the previously committed value. Context generation, descendants, active attempts, observers, and scheduler state remain unchanged until outer completion.

If the final staged value equals the committed value, the existing `Object.is` check in the invalidation controller makes commit a no-op.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- staged values stay hidden across an awaited gap;
- context generation remains unchanged while staged;
- only the final value for a context is applied;
- nested transactions share final-value staging;
- a value reverted to its committed value causes no generation change or notification;
- failed outer transactions discard staged values and do not notify;
- existing depth-zero context behaviour remains synchronous;
- M5B operation guards remain available after transaction completion.

## Subsequent implementation

M5C initially applied multiple distinct contexts through the existing single-context invalidation path. M5D has now replaced that temporary loop with one coalesced context commit and descendant invalidation pass.

M5E will complete notification-buffer rollback ownership for independent runtime transitions that occur during a failed asynchronous transaction.

## Static inspection

Confirmed:

- staged values are private to the coordinator;
- `getState(...)` still reads committed state;
- invalid context handles fail at the `setContext(...)` call rather than at commit;
- transaction depth is restored through `finally`;
- staged values are cleared on successful and failed outer completion;
- direct context writes outside transactions preserve the existing path;
- core boundary validation passes.

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

M5D will commit effective context values together, collect one descendant union, apply one invalidation per descendant, reconcile generation and abort behaviour once, and issue one notification and scheduler request.
