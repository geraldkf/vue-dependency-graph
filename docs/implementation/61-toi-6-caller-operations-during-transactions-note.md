# TOI-6 Caller Operations During Transactions Note

## Status

Prepared. Offline validation pending.

## Implemented

- Removed runtime-wide transaction guards from `runtime.execute(...)`, `runtime.prefetch(...)`, and `runtime.refresh(...)`.
- Removed the operation-guard dependency from the operations controller and transaction coordinator.
- Caller-owned operations remain available while another transaction is open.
- Operations read committed graph state and do not observe staged context values.
- Execution and refresh notifications use direct observer dispatch so completion is not held behind an unrelated transaction.
- `GraphTransaction` remains narrow and does not expose execution, prefetch, or refresh operations.
- Replaced rejection-focused tests with behaviour tests for execute, prefetch, refresh, committed-context reads, and immediate execution completion notification.

## Race semantics

Existing generation and attempt-token rules remain authoritative. Work that completes before transaction commit may be retained and then marked stale by the commit. Work that completes after commit advances an affected generation remains obsolete and cannot overwrite newer state, including when abort is ignored.

## Deliberately deferred

TOI-7 now adds same-context conflict detection and confirms the selected joined overlapping transaction semantics.

## Validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Offline validation remains pending because dependencies are not installed in the stored workspace.
