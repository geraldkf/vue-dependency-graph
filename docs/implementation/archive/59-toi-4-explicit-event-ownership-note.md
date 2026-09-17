# TOI-4 Explicit Event Ownership Note

## Status

Prepared. Offline validation pending.

## Implemented

- `transaction.publish(...)` remains the only transaction-owned event staging path.
- Plain `runtime.publish(...)` now always performs event matching and commits matching graph invalidation immediately.
- A plain runtime publication is no longer added to the staged publication list of an unrelated open transaction.
- Rollback discards only event publications staged through `GraphTransaction`.
- Added focused regression coverage proving an unrelated publication applies while another transaction is open and survives that transaction's rollback.
- Preserved ordered staged publications, final-context predicate overlays, atomic predicate failure, combined context and event invalidation, and overlapping transaction behaviour.

## Deliberately deferred

TOI-4 fixes event state ownership. TOI-5 now completes observer and scheduler dispatch isolation for immediate event publications.

The following also remain pending:

- TOI-6 caller operations during an open transaction;
- TOI-7 same-context conflict detection.

## Behaviour

```ts
const pending = runtime.transaction(async transaction => {
  transaction.publish(StagedEvent, undefined);
  await gate;
  throw new Error("rollback");
});

runtime.publish(UnrelatedEvent, undefined);

expect(runtime.getState(UnrelatedTarget).generation).toBe(1);

releaseGate();
await expect(pending).rejects.toThrow("rollback");

expect(runtime.getState(UnrelatedTarget).generation).toBe(1);
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
