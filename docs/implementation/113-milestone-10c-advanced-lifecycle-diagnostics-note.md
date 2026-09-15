# Milestone 10C: Advanced Lifecycle Diagnostics

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10C extends the diagnostic event stream to typed event publication, transactions, refresh policies, polling-related policy activity, and mutations. It preserves the existing lifecycle implementations and uses their established public or internal seams rather than introducing a second state machine.

## Typed events

Immediate and transaction-owned publications emit:

- `event.published` with event key and ownership;
- `event.matched` with the deduplicated matched node keys.

Payloads are intentionally absent. Predicate evaluation and graph commit behaviour remain owned by the existing event matcher and invalidation controller.

## Transactions

Public transaction calls emit:

- `transaction.started`;
- `transaction.committed` after successful commit;
- `transaction.rolled-back` after work failure;
- `transaction.conflicted` for `GraphTransactionConflictError`.

Terminal records include duration and safe error details where applicable. Conflict records include immutable context conflict keys. Staged context values and event payloads are not emitted.

## Refresh policies and polling

The policy controller exposes one narrow internal diagnostic callback. It reports:

- scheduling and retry scheduling;
- policy refresh start and completion;
- policy failure;
- global pause and resume.

Records contain only node key, policy kind, delay, and safe errors where relevant. Polling values and predicate inputs remain private.

The event union reserves terminal timeout and stopped event types for the existing terminal paths. Focused follow-up validation may add narrower callbacks if the dependency-backed tests reveal a missing terminal transition.

## Mutations

The mutation controller accepts a per-call internal lifecycle listener, preserving independent correlation for concurrent calls of the same mutation definition.

It reports:

- effective optimistic commit after graph commit;
- remote attempt start;
- confirmed remote success or failure;
- confirmed success effects after local commit.

The runtime adds request, terminal outcome, duration, and safe error records. Public mutation errors determine rollback conflict, unknown outcome, reconciliation failure, or known rejection records.

Inputs, results, optimistic values, response values, event payloads, and updater values are not emitted.

## Privacy and failure isolation

M10C records keys, lifecycle state, timings, affected node keys, and safe `{ name, message }` errors only. It does not retain domain values. All events continue through the single M10A failure-isolating emitter, so sink failure cannot change transaction, event, policy, polling, or mutation behaviour.

## Behavioural coverage

Focused tests verify:

- transaction commit and rollback outcomes;
- staged values are absent;
- immediate and transaction-owned event publication;
- event payloads are absent;
- successful and rejected mutation outcomes;
- mutation inputs and results are absent;
- refresh-policy scheduling and execution records.

Existing transaction, event, refresh-policy, polling, and mutation suites remain the primary behavioural regression specification.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of the complete core public entry passed.
- Strict TypeScript compilation of the M10A through M10C diagnostic tests passed using a local Vitest declaration shim.
- Static checks confirmed the diagnostic emitter remains the only sink invocation point.

Project dependencies were unavailable, so the complete repository type check, Vitest suite, and production build were not run or claimed.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10C was validated successfully against the combined checkout during Milestone 10 closure.

## Next step

After successful offline validation, implement M10D bounded in-memory diagnostics and cumulative metrics projection from the same event stream.
