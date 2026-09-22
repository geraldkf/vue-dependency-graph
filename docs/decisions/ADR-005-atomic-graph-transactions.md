# ADR-005: Atomic Graph Transactions

## Status

Accepted, implemented, and validated.

## Context

Applications sometimes need several related graph inputs and event publications to become visible as one local change. Applying those operations individually can expose intermediate combinations to observers and can trigger redundant invalidation or scheduler work.

The runtime is also shared by unrelated application features. A transaction model must not allow one caller's open asynchronous callback to capture, delay, commit, or roll back work performed independently by another caller.

Graph transactions apply only to local graph state. They cannot provide rollback or atomicity for remote API calls.

## Decision

`runtime.transaction(...)` creates one independent transaction session and passes its owner a `GraphTransaction` handle:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(ContextA, valueA);
  transaction.publish(DomainChanged, payload);
  await localWork();
  transaction.setContext(ContextB, valueB);
});
```

Only operations performed through that handle belong to the session.

### Staged operations

A transaction stages:

- context changes made through `transaction.setContext(...)`;
- typed event publications made through `transaction.publish(...)`.

Staged work is not visible through public runtime reads and does not notify observers or request scheduler work before commit.

Repeated writes to one context retain the final staged value while preserving the committed generation captured when that context was first staged. Event publications retain call order.

### Commit and rollback

When the transaction callback completes successfully, the runtime:

1. Verifies that every staged context still has the committed generation captured when it was first staged.
2. Rejects with `GraphTransactionConflictError` if any staged context changed independently.
3. Evaluates staged event predicates against the final staged context overlay.
4. Applies effective context changes and matched event invalidation as one synchronous graph commit.
5. Advances each affected node generation at most once.
6. Aborts superseded work after generation advancement.
7. Notifies observers once and requests at most one scheduler pass when graph state changed.

A callback failure discards the session's staged contexts and events. A conflict also applies none of the session's context, event, notification, or scheduler effects. Independently committed runtime work is preserved.

The transaction promise resolves with the callback result after a successful commit, or rejects with the callback or conflict error.

### Session ownership and composition

Every top-level `runtime.transaction(...)` call creates an independent session, even when calls overlap in time or one call is made inside another callback.

Work joins an existing session only through the transaction handle:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(ContextA, valueA);

  await transaction.transaction(async nested => {
    nested.setContext(ContextB, valueB);
    nested.publish(DomainChanged, payload);
  });
});
```

`transaction.transaction(...)` reuses the same session. Normal asynchronous error propagation determines the outcome:

- If a nested failure escapes the outer callback, the session rolls back.
- If the outer callback catches the failure, it may continue and commit its final staged work.

This explicit composition model prevents unrelated callers from accidentally sharing staged state or commit outcomes.

### Independent runtime operations

Plain runtime operations remain independent while a transaction is open, including:

- `runtime.setContext(...)`
- `runtime.publish(...)`
- `runtime.execute(...)`
- `runtime.prefetch(...)`
- `runtime.refresh(...)`
- `runtime.mutate(...)`

They read committed graph state, apply their effects immediately, and do not see or join another session's staged work.

If an independent write changes a context already staged by a transaction, the independent value remains committed and the transaction later fails its generation check.

`runtime.mutate(...)` is not transaction-owned remote work. Mutation execution and reconciliation use their own lifecycle and consistency rules. Do not keep a graph transaction open around a remote request in an attempt to obtain backend rollback.

### Settlement

`runtime.whenSettled()` describes scheduler work only. An open transaction that has not committed has not requested scheduler work and does not keep `whenSettled()` pending.

When commit-triggered scheduler work must finish, await in this order:

```ts
await runtime.transaction(transaction => {
  transaction.setContext(ContextA, valueA);
});

await runtime.whenSettled();
```

A separate whole-runtime quiescence contract that includes open transaction callbacks is not provided.

### Scope of atomicity

The transaction boundary is local to one `GraphRuntime`:

- It does not roll back remote API operations.
- It does not span runtimes, browser tabs, processes, or backend services.
- It does not include plain runtime operations merely because they occur while a transaction callback is open.

## Consequences

- Observers never see a partially committed combination of transaction-owned context changes and event effects.
- Unrelated features can run overlapping transactions without sharing state or outcomes.
- Same-context overlap uses first-commit-wins optimistic conflict detection rather than silent last-write-wins behaviour.
- Event predicates can evaluate against the final staged context values without exposing those values early.
- Plain runtime work remains responsive and is not delayed behind an unrelated transaction callback.
- Callers must retain and pass the `GraphTransaction` handle when work is intended to share one atomic boundary.
- Callers must await the transaction before awaiting scheduler work caused by its commit.

## Alternatives considered

### Ambient runtime transaction state

Rejected. Allowing plain runtime calls to join whichever transaction happens to be open makes transaction ownership depend on timing and can capture unrelated work from another feature.

### Overlapping top-level calls join one transaction group

Rejected. Independent callers could silently share staged values and commit or rollback outcomes. Explicit `transaction.transaction(...)` composition represents intent without cross-feature coupling.

### Runtime-wide notification buffering while any transaction is open

Rejected. It delays unrelated observer notification and scheduler work for the duration of another caller's asynchronous callback. Each successful transaction already produces one coherent graph commit without a global buffer.

### Broaden `runtime.whenSettled()` to include open transactions

Rejected. One unrelated long-running transaction would block another feature's scheduler-settlement check. Transaction completion and scheduler settlement remain two explicit awaits.

### Include remote mutations in graph transactions

Rejected. A local graph transaction cannot roll back a remote command. Mutations use confirmed reconciliation or guarded optimistic recovery instead, as recorded in [ADR-013](./ADR-013-mutation-framework.md).
