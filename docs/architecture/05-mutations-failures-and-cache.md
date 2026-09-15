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

## Mutation framework

Milestone 9 is implemented as described in [the mutation framework plan](../implementation/87-milestone-9-mutation-framework-plan.md), with the accepted design recorded in [ADR-013](../decisions/ADR-013-mutation-framework.md). Full combined-checkout validation remains pending.

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

### Implemented direct reconciliation

Milestone 9B adds synchronous `onSuccess` update drafts for data nodes that already hold a successful value. The complete draft is validated and evaluated before the runtime changes graph state. Effective updates commit atomically, advance target generations once, abort obsolete target work after generation advancement, invalidate changed-result descendants once, notify once, and use the existing scheduler for subscribed stale descendants.

The mutation controller owns this success-reconciliation boundary. The invalidation controller exposes one narrow dispatch-free changed-result descendant operation so direct root updates and dependent invalidation can share one observer commit. The state store remains storage-only and does not own mutation or stale-state policy.

Updater preparation treats graph-owned values as immutable. Development and test builds pass recursively protected views for plain arrays and plain objects, convert attempted writes to `GraphMutationStateError`, and unwrap protected nested references before commit. The committed runtime value itself is not frozen, and production builds avoid recursive guard overhead.

Direct reconciliation is not optimistic. It runs only after remote success. Local reconciliation failure is caller-visible but cannot roll back a remote command that has already committed.

### Implemented success invalidation and events

Milestone 9C adds explicit data or derived invalidation and typed event publication to the same synchronous success draft. Event predicates are evaluated before graph mutation and receive final direct-update values through an overlay. Direct updates, explicit roots, event roots, and descendants are deduplicated into one commit with one generation advancement per affected node, one observer notification, and at most one scheduler request.

Milestone 9H-F prevents mutation predicates from reading derived values invalidated by that same draft. Before event matching, mutation reconciliation computes a preliminary affected set from optimistic targets, effective direct success updates, explicit invalidation roots, and descendants. Affected derived keys are passed to the shared event matcher as prohibited dependencies. The matcher reports a generic dependency-read error, which optimistic remote-success handling exposes through `GraphMutationReconciliationError`. Runtime publication and transaction publication do not supply this restriction.

A directly updated node that is also invalidated retains the response value as successful stale data. Mutation events are success-only and are not published when remote execution rejects or local effect preparation fails.

### Implemented optimistic apply and known-rejection rollback

Milestone 9D applies validated optimistic data-node updates before remote execution. It snapshots each effective optimistic target and every descendant affected by changed-result invalidation, assigns private per-node ownership, commits optimistic values atomically, and uses the existing invalidation and scheduler path for dependants.

A failure explicitly classified as `rejected` restores the complete snapshots and rethrows the original error. Success releases ownership and reconciles directly over optimistic state without exposing a transient rollback. Same-node optimistic overlap is rejected before the conflicting request starts.

Unclassified failures default to `unknown` and are deliberately not rolled back.

### Implemented race and unknown-outcome handling

Milestone 9E guards rollback with private ownership and expected generations for every captured target and descendant. When newer context, event, refresh, polling, or independent mutation work changes a captured generation, snapshot restoration is skipped atomically. Current values are retained as stale, subscribed nodes reconcile through the existing scheduler, and `GraphMutationRollbackConflictError` preserves the original rejection as its cause.

Milestone 9H-A makes successful rollback a new graph transition. Snapshot data and visible state are restored, but generations advance monotonically instead of returning to their pre-optimistic values. This preserves the execution engine's obsolete-attempt protection for loaders that ignore abort signals.

Milestone 9H-D applies the existing subscribed-stale scheduler rule after safe rollback. If any restored target or descendant was stale in its snapshot and currently has direct or required subscribers, rollback emits its atomic notification and requests one scheduler pass. Fresh restored state and stale unsubscribed state do not create scheduler work.

Milestone 9H-E confirms that optimistic invalidation is not deferred until command settlement. Subscribed data descendants can load while the command is pending, under the normal data-load limiter. Mutation requests remain independent of that limiter. If a non-target data descendant commits a changed fresh value before known rejection, rollback treats it as newer graph state even when its invalidation generation is unchanged, retains current values as stale, and schedules authoritative reconciliation. Active unsettled descendant work remains protected by rollback generation advancement and abort ordering.

Milestone 9H-C distinguishes confirmed remote success from successful local reconciliation. If an optimistic command succeeds remotely but local success preparation fails, rollback is unsafe because the server may already contain the change. The runtime retains optimistic values as stale, invalidates the captured affected subgraph, advances generations, aborts obsolete work, releases ownership, and schedules subscribed reload. `GraphMutationReconciliationError` reports the mutation key, immutable affected node keys, remote success, and the original local cause. No success update, explicit invalidation, or event publication partially commits.

Unknown outcomes retain optimistic values, mark the complete affected subgraph stale, and reject with `GraphMutationOutcomeUnknownError`. A missing or failing classifier cannot prove rejection and therefore follows this safe path. Non-optimistic mutation failures continue to preserve their original errors.

## Deferred cache policies

The following remain planned after Milestone 9:

- garbage collection of unused values
- persistent cache restoration

Milestone 9H-G1 extracts synchronous update draft collection and preparation into an internal mutation update planner. The planner owns target validation, updater protection, asynchronous-effect rejection, replacement unwrapping, and changed-value calculation. It receives only registered-node resolution and mutable-state lookup, performs no graph mutation, and remains private to the mutation controller. Optimistic ownership, graph transitions, and settlement remain coordinated by the controller until their later M9H-G stages.

Milestone 9H-G2 extracts optimistic session policy into an internal manager. The manager exclusively owns optimistic tokens, target and descendant snapshots, expected-generation baselines, rollback conflict calculation, owner-safe release, and the restored stale subscribed scheduling decision. It does not mutate graph state, inspect or abort active attempts, notify, schedule, or construct public errors. The mutation controller continues to own commit ordering until M9H-G3.

Milestone 9H-G3 extracts mutation-owned graph transitions into an internal committer with four named operations: optimistic commit, confirmed success commit, exact rollback, and stale reconciliation. Each method keeps its preservation semantics explicit, advances generations before aborting obsolete work, and owns its notification and scheduler decision. The controller no longer writes mutable graph fields or commits invalidation plans directly; settlement branching remains there until M9H-G4.

Milestone 9H-G4 extracts remote settlement coordination into an internal coordinator. It owns confirmed-success effect preparation, event matching, affected-derived restrictions, failure classification, exact-rejection selection, rollback-conflict conversion, unknown outcomes, and reconciliation-failure error translation. It never edits graph state directly and delegates every transition to the committer. The mutation controller retains remote request orchestration and delegates fulfilled and rejected results.

Milestone 9H-G5 leaves the mutation controller as the sole runtime-facing composition root and names four private lifecycle boundaries: optimistic start, remote execution, remote-success settlement, and remote-failure settlement. These are stable future instrumentation seams, but no observer, hook, telemetry, or devtools event is added until Milestone 10 defines its event model. The extracted mutation module graph is acyclic and none of its support modules are public exports.
