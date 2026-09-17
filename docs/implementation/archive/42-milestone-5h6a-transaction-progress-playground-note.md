# Milestone 5H.6A: Transaction Progress Playground

## Status

Progress display and staged commit flow prepared. Offline automated and manual browser validation pending.

## Objective

Extend the Atomic Transaction playground so users can compare caller-owned in-progress values with committed runtime state while preserving the runtime's committed-read transaction model.

## Design

The scenario now presents two separate sections:

### Committed runtime state

This section uses `useNode(...)` and therefore shows only graph state that the runtime has committed:

- first context value;
- second context value;
- committed derived result;
- derivation count.

### Transaction progress

This section uses scenario-local `TransactionDraft` state to explain what the transaction body has staged:

- first in-progress value;
- second in-progress value;
- locally calculated preview result.

The draft is explicitly a playground representation. No staged-state inspection API was added to the runtime.

## Transaction phases

The scenario uses an explicit state union:

```text
idle
first-staged
second-staged
committed
```

The controls advance deterministically:

1. **Start transaction** stages the first value as `2` and pauses.
2. **Stage second value** stages the second value as `20` and pauses again.
3. **Commit transaction** releases the final gate and commits both values atomically.

While either staging phase is active, committed state remains `1 + 10 = 11`. The local preview progresses from `2 + 10 = 12` to `2 + 20 = 22`.

After commit, the draft is cleared and committed state becomes `2 + 20 = 22`.

## Lifecycle

Both transaction gates are released during unmount.

If unmount occurs after only the first value is staged, transaction work exits before creating the second gate. If unmount occurs after the second value is staged, the final commit gate is released. Promise settlement does not update component state after unmount.

## Tests

Updated `tests/playground/scenarios/atomic-transaction.spec.ts` to verify:

- first-stage draft values and preview;
- second-stage draft values and preview;
- committed runtime state remains unchanged during both phases;
- committed observer history remains empty during both phases;
- commit exposes only the coherent final pair;
- the draft is cleared after commit;
- unmount releases the second waiting phase without warnings;
- atomic reset continues to clear progress, snapshots, and counters.

## Scope

This step does not add rollback controls or simulated transaction failure. Error-driven rollback remains M5H.6B.

No core runtime source or public API changed.

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

Then complete the updated Atomic Transaction manual steps in `docs/PLAYGROUND.md`.
