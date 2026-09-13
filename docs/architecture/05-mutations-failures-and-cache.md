# Mutations, Failures, and Cache Behaviour

## Runtime value behaviour

Successful values survive invalidation and refresh failure:

- A context node begins with a successful fresh value.
- A data node begins with its initial value but no successful load.
- A derived node begins with `undefined` and no successful derivation.
- Invalidation marks descendants stale without deleting data.
- Initial execution uses `loading`.
- Re-execution with previous successful data uses `refreshing`.
- Success stores the value, clears the error, and marks the node fresh.
- Initial failure stores an error without claiming a successful value.
- Refresh failure retains successful data, stores the error, and remains stale.

Status, freshness, error, and successful-value history are independent facts. A consumer can therefore show useful stale data and a new refresh error together.

## Fresh-value reuse

Execution reuses a node only when it has a successful value, `success` status, and `fresh` freshness. Stale, failed, idle, and never-successful nodes remain eligible for work.

No time-based staleness or cache garbage collection exists yet.

## Failure scopes

Failure is evaluated by dependency branch rather than globally:

- A failed node records an error.
- A child does not execute when a required parent fails.
- Independent branches continue.
- Blocked nodes are reported separately from direct failures.
- Abort and superseded attempts are not business failures.
- Unknown thrown values are normalised to `Error`.

`GraphExecutionError` aggregates failures after all executable requested branches settle.

## Automatic scheduler failures

Automatic execution failures are captured in `SchedulerState.error`. The failed node retains its normal per-node error state.

The scheduler settles without an unhandled rejection and does not immediately retry. A later external trigger, such as a context change or new subscription, starts a new pass and clears the prior scheduler error at pass start.

Scheduler-owned cancellation caused by disappearing subscription ownership is not stored as a node or scheduler business error.

## Prefetch and refresh failures

Prefetch and refresh are caller-owned operations. They reject with `GraphExecutionError` after independent executable branches settle.

Their failures update normal per-node state. They do not become scheduler errors unless the scheduler independently owns the same failing orchestration.

A failed refresh retains previous successful data, records the error, and leaves the node stale. A later successful refresh clears the error.

## Current cache scope

The current runtime cache is in-memory and belongs to one `GraphRuntime`. Definition and graph objects may be shared by multiple runtimes, but values and attempts are not shared across runtime instances.

A Pinia store may own a runtime instance, but Pinia does not mirror or persist graph cache state.

## Planned mutations

A later mutation milestone will cover:

- invalidation after remote success
- direct cache reconciliation
- optimistic local updates
- rollback snapshots
- mutation event publication

Atomic graph transactions and optimistic mutation rollback have different semantics. Transaction staging defers local state visibility until commit. Optimistic mutation applies local state immediately and restores a snapshot on failure.

## Deferred cache policies

The following remain planned:

- stale-after duration
- refresh on focus or reconnect
- polling
- retry and backoff
- garbage collection of unused values
- persistent cache restoration
