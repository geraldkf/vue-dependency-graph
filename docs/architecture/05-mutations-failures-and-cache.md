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

## Automatic scheduler failures

Step 3B captures automatic orchestration failures in `SchedulerState.error`. The scheduler waits for branch-scoped execution to settle before recording the error. The failed node retains its normal per-node error state.

Automatic failures do not create unhandled promise rejections and do not immediately retry. A new node subscription or context change provides a new external trigger. The scheduler clears its prior error when that pass starts, and successful node execution clears the node error through the existing runtime state machine.

Cancellation caused by the final subscriber unsubscribing is not a business failure and is not stored as a node or scheduler error.

### Prefetch and refresh failures

Prefetch and manual refresh are caller-visible operations. They reject with the existing `GraphExecutionError` after independent executable branches settle. Their failures update normal per-node state and do not become scheduler errors unless the scheduler independently owns failing orchestration.

A refresh failure retains a previous successful value, records the error, and leaves the node stale. A later successful refresh clears the node error. Prefetch creates no persistent subscription or cache-lifecycle ownership.
