# Milestone 9D: Optimistic Apply and Known-Rejection Rollback

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds optimistic data-node updates before remote mutation execution and automatic snapshot restoration when the application classifies a failure as a known remote rejection.

M9D does not yet add generation-protected rollback conflict reporting, automatic stale reconciliation for unknown outcomes, dedicated unknown-outcome errors, external cancellation, retries, or diagnostics. Those remain in M9E.

## Public API

```ts
await runtime.mutate(BookAppointment, input, {
  optimistic: (effects, originalInput) => {
    effects.update(Appointments, current => [
      ...current,
      createPendingAppointment(originalInput),
    ]);
  },
  onSuccess: (effects, saved) => {
    effects.update(Appointments, current =>
      replacePendingAppointment(current, saved)
    );
  },
  classifyFailure: error =>
    isKnownRejectedResponse(error) ? "rejected" : "unknown",
});
```

`MutationFailureKind` is `"rejected" | "unknown"`.

The optimistic capability intentionally exposes `update(...)` only. Explicit invalidation and event publication remain confirmed-success effects.

## Preparation before request execution

The optimistic callback is synchronous and records update drafts without changing graph state. Before starting the remote request, the runtime:

1. resolves every target by registered key;
2. validates data-node target kinds;
3. rejects duplicate writes;
4. verifies that every target has a successful value;
5. evaluates every updater;
6. rejects Promise-like callback or updater results;
7. checks private optimistic ownership for every effective target;
8. computes affected changed-result descendants;
9. captures complete rollback snapshots.

Any failure in this phase applies no optimistic state and starts no remote request.

## Optimistic commit

Effective target values commit together as successful fresh data. Each target advances generation once. Changed-result descendants use the existing invalidation transition. Active work is aborted after affected generations advance. Observers receive one coherent notification, and subscribed stale descendants use the existing scheduler.

Equal-value successful fresh updates remain local no-ops and acquire no optimistic ownership.

## Snapshot scope

Snapshots include the complete runtime fields required for exact restoration:

- data;
- status;
- freshness;
- error;
- generation;
- successful-value history.

The snapshot set includes effective optimistic targets and all descendants affected by their changed-result invalidation. This prevents a simple known rejection from restoring only the root while leaving dependent graph state stale.

## Ownership and overlap

Each runtime keeps private optimistic ownership by registered data-node key. Only effective optimistic targets are owned. A second unresolved optimistic mutation that changes an owned node rejects with `GraphMutationConflictError` before its remote execute function runs.

The exported error exposes immutable, sorted `nodeKeys`. Disjoint optimistic mutations remain independent. Full concurrency and race hardening remains M9E.

## Settlement

### Confirmed success

Success effects run directly over currently visible optimistic state. Ownership is released after success settlement. No rollback notification or previous-value flash occurs.

When no success update replaces an optimistic value, that value remains as the confirmed local value.

### Known rejection

A classifier result of `"rejected"` restores every captured snapshot in one synchronous rollback, aborts work started against the optimistic generations, releases ownership, notifies once, and rethrows the original remote error.

### Unknown outcome

An omitted classifier defaults to `"unknown"`. M9D retains optimistic state and rethrows the original error rather than performing an unsafe rollback. M9E will mark affected nodes stale, schedule authoritative reconciliation, and wrap the cause in `GraphMutationOutcomeUnknownError`.

## Behavioural coverage

Focused tests cover:

- atomic multi-node optimistic visibility before settlement;
- complete target and descendant snapshot restoration;
- preservation of the original known-rejection error;
- success reconciliation without transient rollback;
- same-node overlap rejection before request execution;
- never-successful target rejection before request execution;
- unclassified outcome retention pending M9E.

Compile-time tests cover optimistic input typing, data-node update typing, context and derived target rejection, valid failure classification, and invalid classifier results.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict standalone TypeScript compilation of core source passed.
- Focused strict TypeScript compilation of mutation source and tests passed using a local Vitest declaration shim because repository dependencies are not installed.
- Static documentation and ZIP integrity checks are completed when the prepared package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9D remains validation pending until all four commands succeed against the combined checkout.

## Next task

After successful M9D validation, proceed with M9E rollback conflict protection, disjoint concurrency coverage, and unknown-outcome reconciliation.
