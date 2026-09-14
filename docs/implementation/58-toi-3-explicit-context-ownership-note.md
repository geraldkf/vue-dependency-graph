# TOI-3 Explicit Context Ownership Note

## Status

Prepared. Offline validation pending.

## Implemented

- `transaction.setContext(...)` remains the only transaction-owned context staging path.
- Plain `runtime.setContext(...)` now always resolves and commits its context change immediately.
- A plain runtime context write is no longer added to the staged map of an unrelated open transaction.
- Rollback discards only context changes staged through `GraphTransaction`.
- Added focused regression coverage proving an unrelated write is visible while another transaction is open and survives that transaction's rollback.
- Preserved existing staged context reconciliation, atomic commit, rollback, generation, invalidation, and overlapping transaction behaviour.

## Deliberately deferred

TOI-3 fixes context state ownership. TOI-5 now completes notification and scheduling isolation for immediate context writes.

The following also remain pending:

- TOI-4 explicit event ownership;
- TOI-6 caller operations during an open transaction;
- TOI-7 same-context conflict detection.

## Behaviour

```ts
const pending = runtime.transaction(async transaction => {
  transaction.setContext(StagedContext, 2);
  await gate;
  throw new Error("rollback");
});

runtime.setContext(UnrelatedContext, 999);

expect(runtime.getState(UnrelatedContext).data).toBe(999);

releaseGate();
await expect(pending).rejects.toThrow("rollback");

expect(runtime.getState(UnrelatedContext).data).toBe(999);
```

## Validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

The stored workspace does not include installed dependencies and the execution environment cannot download the pinned pnpm package, so validation remains pending.
