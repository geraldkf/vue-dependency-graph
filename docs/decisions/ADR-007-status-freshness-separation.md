# ADR-007: Separate Execution Status From Freshness

## Status

Accepted and implemented.

## Context

The most common way to model async state is a single enum: `idle | loading | success | error`. That model cannot represent "the last successful value is still what we have, but it's out of date and a new load is in flight" without either discarding the previous value while `loading` is shown (a UI flash back to a blank or spinner state on every refresh) or building an ad hoc secondary "last known good value" cache outside the framework - the same kind of per-consumer boilerplate this framework exists to remove.

The same gap exists for errors: if a refresh fails, a single-enum model forces a choice between showing the error (and losing the still-valid previous data) or showing the previous data (and losing the fact that the most recent refresh attempt failed).

## Decision

Node runtime state tracks three independent facts rather than one enum:

- `status`: `idle | loading | success | refreshing | error` - what the current or most recent execution attempt is doing.
- `freshness`: `fresh | stale` - whether the current data reflects the latest known inputs.
- `hasSuccessfulValue` (with the associated `data`): whether a successful value exists at all, independent of whether it is currently fresh.

These are updated together but are not collapsed into each other. Invalidation marks a node stale without deleting its data. A re-execution that already has a successful value uses `refreshing` rather than `loading`, and on failure retains the previous successful data, records the error, and leaves the node stale rather than clearing the value. Context nodes begin successful and fresh; data nodes begin with their initial value but no successful execution; derived nodes begin `undefined` with no successful derivation.

## Consequences

- A component can render "stale-but-still-useful data" and "the refresh that just failed" simultaneously, which is not representable in a single-enum model.
- Every place that transitions node state (execution.ts's success and failure paths, invalidation, mutation reconciliation and rollback) must update these fields together correctly; getting one field's transition wrong while leaving the others alone is a real correctness risk the implementation has to guard against explicitly, rather than getting consistency for free from a single assignment.
- The public per-node state surface (`useNode`'s result, `runtime.getState(...)`) exposes more than a single status field, which is a larger but more expressive API than a single enum would be.
- Fresh-value reuse (skipping re-execution) is defined precisely as: has a successful value, `status === "success"`, `freshness === "fresh"` - all three, not just one.

## Alternatives considered

### Single `idle | loading | success | error` status enum

Rejected. Cannot represent stale-but-successful data during a refresh or after a refresh failure without an external cache, which reintroduces the per-consumer bookkeeping this framework is meant to remove.

### Two-field model (status, and a separate `hasData` boolean) without a distinct freshness concept

Rejected. Collapses "has a value" and "that value reflects current inputs" into one bit, which cannot distinguish a value that is simply present from one that is present but known out of date - the exact case fresh-value reuse depends on being able to tell apart.
