# Milestone 5B: Transaction Coordinator and Operation Guards

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice introduces a dedicated runtime transaction coordinator without changing context mutation behaviour yet.

The coordinator now owns:

- transaction depth across synchronous and asynchronous work;
- nested transaction lifecycle;
- the public `runtime.transaction(...)` entry point;
- detection of whether caller work is inside a transaction;
- guards for operations whose ownership would otherwise be ambiguous during staged context work.

Notification dispatch continues to be owned by `transactions/notification-buffer.ts`. State staging, atomic commit, and rollback remain deferred to later Milestone 5 slices.

## Implementation

### Transaction coordinator

Added:

```text
src/core/transactions/transaction-coordinator.ts
```

The closure-based capability wraps the existing notification-buffer transaction lifecycle and maintains its own depth counter. This establishes the composition point for later state-staging and commit/rollback participants without expanding notification-buffer responsibilities.

### Runtime composition

`src/core/runtime.ts` now:

- constructs the coordinator after the notification buffer;
- exposes `transactions.runTransaction` as the public transaction implementation;
- guards explicit execution through the coordinator;
- supplies the coordinator guard to the operations controller.

### Operation guards

The following calls now fail immediately when made from inside `runtime.transaction(...)`:

```text
runtime.execute(...)
runtime.prefetch(...)
runtime.refresh(...)
```

The guard runs before refresh validation or state mutation, including for empty target arrays. Outside transactions, all three operations preserve their existing paths.

The error format is:

```text
runtime.<operation>(...) cannot be called inside runtime.transaction(...).
```

Scheduler-owned execution is not guarded. Work already active before a transaction also remains unaffected.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- explicit execution is rejected without starting work or changing node state;
- prefetch is rejected without starting work or changing node state;
- refresh is rejected before generation, freshness, status, or attempt changes;
- guarded operations are available again after asynchronous transaction completion.

Existing transaction tests continue to cover asynchronous depth, nesting, notification coalescing, and depth-zero passthrough.

## Deliberately unchanged

This slice does not:

- stage context values;
- change `getState(...)` reads;
- defer invalidation state changes;
- roll back context mutations;
- change execution completion behaviour;
- stage subscription lifecycle changes;
- change notification-buffer commit behaviour.

The existing test documenting that context state is not rolled back after failure remains valid until M5C and M5E replace that behaviour.

## Static inspection

Confirmed:

- the coordinator is framework-agnostic;
- the notification buffer remains dispatch-only;
- refresh is guarded before any mutable-state access;
- prefetch and execute are guarded before execution begins;
- scheduler execution does not pass through the caller-operation guard;
- no public API signature or export is added;
- transaction depth is restored in `finally` after success or failure.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

This slice must remain validation pending until those commands succeed against the combined repository.

## Next task

M5C will stage final context values while preserving committed `getState(...)` reads and immediate context behaviour outside a transaction.
