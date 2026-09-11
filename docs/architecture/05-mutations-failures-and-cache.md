# Mutations, Failures, and Cache Behaviour

## Implemented runtime value behaviour

Milestone 2 retains successful values across invalidation and refresh failures.

- A context node begins with a successful fresh value.
- A data node begins with its initial value but no successful load.
- A derived node begins with `undefined` and no successful derivation.
- Invalidation marks descendants stale without deleting data.
- Initial execution uses `loading`.
- Re-execution with previous successful data uses `refreshing`.
- Success stores the value, clears errors, and marks the node fresh.
- Initial failure stores an error with no successful value.
- Refresh failure retains successful data, stores the error, and remains stale.

## Failure scopes

Failure is evaluated by dependency branch rather than globally.

- A child cannot execute when a required parent fails.
- Independent branches continue.
- Blocked nodes are reported separately from directly failed nodes.
- Abort and superseded attempts are not business failures.
- Non-`Error` thrown values are normalised to `Error`.

`GraphExecutionError` aggregates the outcome after all executable requested branches settle. Per-node state remains available for UI and later diagnostics.

## Fresh value reuse

Explicit execution skips a node only when it has a successful value, `success` status, and `fresh` freshness. A stale or failed node is eligible for another attempt.

No stale-time policy or garbage collection exists yet.

## Proposed mutations

A later mutation milestone will support:

- Invalidate affected nodes after remote success
- Reconcile known node data
- Optimistic local updates
- Rollback snapshots
- Domain event publication

Graph rollback will restore local runtime state only. It cannot guarantee backend rollback.

## Deferred cache policies

The following remain proposed:

- Time-based staleness
- Refresh on focus or reconnect
- Polling
- Retry and backoff
- Garbage collection of unused values
- Persistent cache restoration
