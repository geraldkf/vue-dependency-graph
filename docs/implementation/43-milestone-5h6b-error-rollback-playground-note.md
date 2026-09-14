# Milestone 5H.6B: Error-Driven Rollback Playground

## Status

Error-driven rollback flow prepared. Offline automated and manual browser validation pending.

## Objective

Complete the Atomic Transaction playground by allowing the user to choose between successful commit and rollback caused by a local transaction error after both context values have been staged.

## User flow

After **Start transaction** and **Stage second value**, two actions become available:

- **Commit transaction** resolves the transaction normally.
- **Rollback with error** resolves the decision gate and causes the transaction body to throw `Playground transaction rollback`.

The scenario displays:

- the current transaction phase;
- the final transaction outcome;
- the rollback error through an accessible alert;
- committed runtime state;
- transaction progress and preview;
- committed observer snapshots.

## Commit behaviour

Selecting commit:

- moves through `committing` to `committed`;
- commits both staged values atomically;
- changes committed state to `2 + 20 = 22`;
- sets outcome to `committed`;
- clears the local draft;
- records only the coherent committed observer snapshot.

## Rollback behaviour

Selecting rollback:

- moves through `rolling-back` to `rolled-back`;
- throws inside `runtime.transaction(...)`;
- discards both staged context values;
- leaves committed state at `1 + 10 = 11`;
- emits no committed observer snapshot;
- sets outcome to `rolled back`;
- displays `Playground transaction rollback`;
- clears the local draft.

This demonstrates local graph rollback only. It does not imply rollback of remote API work.

## Lifecycle

Unmount resolves an outstanding decision as rollback. The transaction rejection is handled by the scenario promise chain, and no component state is updated after unmount.

## Tests

Extended `tests/playground/scenarios/atomic-transaction.spec.ts` to verify:

- rollback occurs after both values are staged;
- committed contexts and derived result remain unchanged;
- no committed observer snapshot is emitted;
- the transaction draft is cleared;
- outcome and accessible error are displayed;
- reset after rollback clears outcome and error as well as existing counters and snapshots.

Existing progress, commit, unmount, and reset coverage remains.

## Scope

No core runtime source or public API changed. The rollback error is deliberately scenario-local.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. Full Vue type checking and component test execution remain offline responsibilities.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Then complete both commit and rollback paths in `docs/PLAYGROUND.md`.
