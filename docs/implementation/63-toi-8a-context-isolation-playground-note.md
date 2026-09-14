# TOI-8A Context Isolation Playground Note

## Status

Prepared. TOI-8D coverage reconciliation added; offline validation pending.

## Implemented

- Extended the existing Atomic Transaction scenario instead of adding another playground tab.
- Added a separate unrelated context and subscribed data node.
- Added an **Apply unrelated runtime update** action available while the transaction is paused.
- Displayed the unrelated committed context value, dependent result, loader count, and update state.
- Kept the original staged context values hidden while the transaction remains open.
- Demonstrated that the unrelated dependent reload completes before transaction closure.
- Demonstrated that rolling back the staged transaction does not discard the unrelated runtime update.
- Reset now restores the unrelated context and isolation display state.
- Added a behaviour-focused playground test covering immediate visibility, independent reload, rollback, and preservation.

## Deliberate boundary

TOI-8A uses a separate unrelated context so the scenario explains ownership isolation without combining it with same-context conflict handling. TOI-8B will provide a distinct conflict demonstration.

## Manual validation

1. Open Atomic Transaction.
2. Start the transaction and confirm it pauses at `first-staged`.
3. Select **Apply unrelated runtime update**.
4. Confirm the unrelated context and dependent result both become `999` while the transaction remains `first-staged`.
5. Stage the second transaction value.
6. Roll back with error.
7. Confirm the transaction-owned values remain `1 + 10`.
8. Confirm the unrelated context and dependent result remain `999`.
9. Reset and confirm the scenario returns to its initial state.

## Validation commands

```text
pnpm typecheck --pretty false
pnpm test:run tests/playground/scenarios/atomic-transaction.spec.ts --reporter verbose --no-color
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```
