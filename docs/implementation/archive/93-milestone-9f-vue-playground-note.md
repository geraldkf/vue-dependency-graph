# Milestone 9F: Vue-Facing Usage and Deterministic Playground

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds one deterministic Optimistic Appointment Booking scenario to the existing playground. It demonstrates the M9A through M9E core API through the Pinia-owned runtime and adds Vue Testing Library behaviour coverage.

No core or Vue mutation composable was added. The scenario revealed only application-specific request state, labels, and controls, so a framework abstraction would add unnecessary surface area.

## Scenario model

The scenario contributes one data node containing confirmed and pending appointments plus one typed booking mutation. A small deterministic API harness owns the currently pending mock request and exposes manual success, known rejection, unknown outcome, release, and reset controls.

The harness is scenario infrastructure only. Graph values remain owned by the runtime and are observed through the existing `useNode(...)` composable.

## User-visible states

The scenario displays:

- ready;
- submitting;
- optimistic appointment visible;
- confirmed response reconciliation;
- known rejection and rollback;
- unknown outcome and authoritative reload;
- same-node overlap rejection.

It also displays appointment status values, runtime node status and freshness, mutation request count, capability status, capability reload count, outcome text, and error text.

## Confirmed-success integration

On success, the scenario replaces the pending appointment with the confirmed server result and publishes the existing typed appointment-booked event. The existing capability-status node matches that event by jobseeker ID, becomes stale, and reloads through its existing subscription.

This demonstrates direct response reconciliation and event-driven cross-domain reload within the same mutation success commit.

## Lifecycle handling

Reset releases a pending deterministic request through the unknown-outcome path, waits for the application-local mutation task to settle, resets counters and labels, and refreshes the appointment and capability nodes.

Unmount releases a pending mock request so tests and tab changes leave no unresolved promise. This is cleanup for the deterministic harness only. The scenario does not claim that releasing local work proves remote cancellation or rollback.

## Behavioural coverage

Vue Testing Library tests cover:

- optimistic data appearing before completion;
- confirmed replacement and capability-status reload;
- known rejection restoring the previous appointment list;
- unknown-outcome messaging and authoritative reload;
- same-node overlap rejection before a second request starts;
- deterministic reset of data, counters, and labels;
- pending-work release on unmount without Vue warnings;
- playground tab registration and subscription release.

## Validation completed in the contained environment

Core boundary checks, strict TypeScript checks for non-SFC source, static documentation checks, and ZIP integrity checks are completed when the cumulative package is produced. Repository dependencies are not installed in the contained environment, so Vue SFC typechecking, Vitest execution, and production build remain offline responsibilities.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9F remains validation pending until all four commands succeed against the combined checkout.

## Next task

Proceed with M9G final documentation, migration guidance, complete repository validation, and milestone closure.
