# TOI-8D Playground Coverage Reconciliation Note

## Status

Prepared. Offline validation pending.

## Objective

Reconcile the Atomic Transaction and Typed Events playground tests after adding transaction ownership isolation and conflict demonstrations. This slice adds coverage only and does not change runtime or playground behaviour.

## Atomic Transaction coverage

Added behaviour-focused checks that:

- unrelated and conflicting runtime actions are disabled before a transaction starts;
- both actions become available while the transaction is paused at `first-staged`;
- selecting the unrelated action disables both actions for that transaction, preventing mixed demonstrations;
- conflict rejection exposes the immediate `999 + 10` observer snapshot;
- no `2 + 20` or `999 + 20` partial staged snapshot is exposed.

Existing coverage continues to verify:

- staged values remain hidden;
- successful commit is atomic;
- rollback restores transaction-owned values;
- unrelated context work reloads before transaction closure and survives rollback;
- same-context conflict preserves the immediate value;
- reset and unmount are deterministic.

## Typed Events coverage

Added behaviour-focused checks that:

- unrelated publication is disabled before an event transaction starts;
- it becomes available only while the event transaction is staged;
- it becomes disabled after one publication, preventing duplicate demonstration work;
- reset restores the unrelated event request count, result, and outcome after an isolated publication and staged-event rollback.

Existing coverage continues to verify:

- matching and non-matching immediate appointment publications;
- staged appointment event commit and rollback;
- unrelated event reload before transaction closure;
- unrelated event preservation after staged-event rollback;
- deterministic reset and unmount cleanup.

## Test strategy update

The maintained test strategy now explicitly requires phase-valid playground controls, pre-closure visibility of unrelated work, rollback preservation, absence of partial conflict snapshots, and deterministic reset of isolation state.

## Validation commands

```text
pnpm typecheck --pretty false
pnpm test:run tests/playground/scenarios/atomic-transaction.spec.ts --reporter verbose --no-color
pnpm test:run tests/playground/scenarios/typed-events.spec.ts --reporter verbose --no-color
pnpm test:run --reporter verbose --no-color
pnpm build
```

Offline validation remains pending.
