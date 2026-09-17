# TOI-8B Conflict Playground Note

## Status

Prepared. TOI-8D coverage reconciliation added; offline validation pending.

## Implemented

- Extended Atomic Transaction with a separate **Same-context conflict** section.
- Added an **Apply conflicting runtime update** action while the first context is staged.
- The action commits `999` immediately to the same context without changing the staged transaction value.
- Completing the transaction produces `GraphTransactionConflictError`.
- The UI distinguishes conflict rejection from an explicit rollback.
- The UI displays immutable conflict keys and a consumer-focused explanation that the immediate value was preserved.
- The second staged context remains uncommitted when conflict detection rejects the transaction.
- Reset clears conflict state and restores initial committed values.
- Added behaviour-focused tests for conflict detection, immediate-value preservation, no generic error alert, and reset.

## Demonstrated outcome

1. Start the transaction.
2. Confirm the first staged value remains hidden.
3. Apply the conflicting runtime update.
4. Confirm committed values show `999 + 10`.
5. Stage the second transaction value and commit.
6. Confirm phase `conflicted` and outcome `conflict rejected`.
7. Confirm conflict key `atomic-transaction-first`.
8. Confirm committed values remain `999 + 10`, proving the second staged value did not partially commit.

## Validation commands

```text
pnpm typecheck --pretty false
pnpm test:run tests/playground/scenarios/atomic-transaction.spec.ts --reporter verbose --no-color
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```
