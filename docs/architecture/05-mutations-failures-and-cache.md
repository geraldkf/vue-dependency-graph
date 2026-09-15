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

## Planned mutation framework

Milestone 9 is planned in detail in [the mutation framework plan](../implementation/87-milestone-9-mutation-framework-plan.md), with the proposed design recorded in [ADR-013](../decisions/ADR-013-mutation-framework.md).

The planned runtime capability uses immutable typed mutation definitions and caller-owned `runtime.mutate(...)` operations. Mutation definitions own remote execution only. Per-call effect callbacks may update successful data-node values, invalidate data or derived nodes, and publish typed events after confirmed success.

Optimistic updates use a different visibility model from graph transactions:

- transactions keep local changes private until successful local commit;
- optimistic mutations expose a projected data-node value before remote completion;
- known remote rejection restores guarded runtime snapshots;
- unknown remote outcome retains the optimistic value, marks it stale, and requests authoritative reconciliation;
- rollback never overwrites a node changed by newer graph work.

The first release deliberately rejects overlapping optimistic ownership of one data node. It does not add layered optimistic patches, mutation retry, offline queues, idempotency generation, or a separate mutation concurrency budget.

Mutation execution must not keep the graph transaction notification buffer open while awaiting remote work. Confirmed success effects are planned and applied through one synchronous local commit so observers do not see partial multi-node reconciliation.

Milestone 9 will not perform a general pre-implementation refactor. A narrow invalidation planner, safer active-attempt iteration, or index-based traversal may be extracted only when a concrete mutation slice requires that seam. Stale-state policy remains outside the state store, refresh-policy strategies remain intact, and optimistic rollback does not use graph transaction cancellation.

## Deferred cache policies

The following remain planned after Milestone 9:

- garbage collection of unused values
- persistent cache restoration

