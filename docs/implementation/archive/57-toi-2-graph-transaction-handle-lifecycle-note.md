# TOI-2 Graph Transaction Handle and Lifecycle Note

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Prepared. Offline validation pending.

## Implemented

- Added the public `GraphTransaction` contract.
- `runtime.transaction(...)` now supplies a transaction handle to each callback.
- The handle exposes only typed `setContext(...)` and `publish(...)` operations.
- Transaction-owned repository call sites now use the explicit handle.
- Handles are group-bound and reject use after successful commit or rollback.
- Root and joined callbacks receive separate facades backed by the existing shared transaction group.
- Added focused lifecycle tests for successful closure, rollback closure, publication closure, and joined handle closure.

## Deliberately unchanged

TOI-2 establishes ownership plumbing only. The following remain for later slices:

- plain runtime context writes becoming independent of an open transaction;
- plain runtime event publications becoming independent;
- notification and scheduler dispatch isolation;
- unrelated execution-operation guards;
- same-context conflict detection.

## Validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

The current execution environment could not download the pinned pnpm version, so offline validation remains pending.
