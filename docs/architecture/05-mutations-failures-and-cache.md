# Mutations, Failures, and Cache Behaviour

The graph runtime keeps server-backed read state useful during invalidation and failure, while typed mutations coordinate remote commands with local graph reconciliation. The governing decisions are [ADR-007](../decisions/ADR-007-status-freshness-separation.md), [ADR-008](../decisions/ADR-008-branch-scoped-failures.md), and [ADR-013](../decisions/ADR-013-mutation-framework.md).

## Runtime value behaviour

Successful values survive invalidation and refresh failure:

- Context nodes begin with successful fresh values.
- Data nodes begin with their initial values but do not claim a successful load.
- Derived nodes begin with `undefined` and no successful derivation.
- Invalidation marks descendants stale without deleting their data.
- Initial execution uses `loading`.
- Re-execution with previous successful data uses `refreshing`.
- Success stores the value, clears the error, and marks the node fresh.
- Initial failure records an error without claiming a successful value.
- Refresh failure retains the last successful data, records the new error, and leaves the node stale.

Status, freshness, error, and successful-value history are separate facts. Consumers can therefore show useful stale data and a refresh error together.

## Fresh-value reuse

Execution reuses a node only when it has a successful value, `status === "success"`, and `freshness === "fresh"`. Stale, failed, idle, and never-successful nodes remain eligible for work.

Automatic value release is a separate cache-lifecycle concern described by [ADR-016](../decisions/ADR-016-value-release-policies.md).

## Failure scopes

Failure is evaluated by dependency branch rather than globally:

- A failed node records its error.
- A child does not execute when a required parent fails.
- Independent branches continue.
- Blocked requested nodes are reported separately from direct failures.
- Abort and superseded attempts are not business failures.
- Unknown thrown values are normalised to `Error`.

Caller-owned execution, prefetch, and refresh reject with `GraphExecutionError` after independent executable branches settle. Automatic scheduler failures are captured in scheduler state rather than becoming unhandled rejections. A failed refresh retains previous successful data and remains stale.

## Mutation responsibility

A mutation is a typed caller-owned remote command. It is not a graph node, is not deduplicated, and does not consume the data-loader `maxConcurrentLoads` budget.

```ts
const SaveAppointment = defineMutation({
  key: "appointment.save",
  execute: ({ input, signal }) => api.saveAppointment(input, signal),
});
```

Each `runtime.mutate(...)` call owns one remote attempt and optional synchronous local effect callbacks. Mutation execution remains independent from graph transactions and from other runtime operations.

## Confirmed-success effects

After remote success, `onSuccess` may prepare:

- direct replacement updates for data nodes that already have successful values;
- explicit invalidation of data or derived nodes;
- typed event publication.

The runtime prepares and validates the complete draft before changing graph state. Direct updates, explicit invalidation, event matches, and affected descendants are combined into one local commit. Each affected node advances generation at most once, obsolete work is aborted after generation advancement, observers receive one coherent notification, and subscribed stale work requests at most one scheduler pass.

A directly updated node that is also invalidated retains the response value as successful stale data so the UI can show it while an authoritative reload proceeds.

### Pure replacement updates

Update functions must treat current graph values as read-only and return replacement values. Development and test builds protect plain arrays and plain objects recursively so detected in-place writes reject before any mutation effect commits. Production builds omit that guard overhead, so immutable replacement remains an application contract for all values, including non-plain objects.

Callbacks and update functions are synchronous. Duplicate writes, malformed targets, missing successful values, asynchronous effects, callback failure, and updater failure reject before a local commit.

### Event matching during success preparation

Mutation event predicates are evaluated before graph mutation. They can read final directly updated data through the prepared overlay and can read unaffected committed dependencies.

A predicate cannot read a derived dependency affected by the same optimistic targets, direct updates, or explicit invalidation. That derived value has not recomputed yet, so preparation rejects rather than evaluating stale data. A failed predicate or prohibited dependency read applies no partial success update, invalidation, or event publication.

## Optimistic application

An optional `optimistic` callback may update successful data nodes before the remote request settles. The runtime:

1. Collects and validates the complete optimistic draft.
2. Determines the affected descendants.
3. Captures logical snapshots for targets and affected descendants.
4. Acquires private ownership of effective optimistic targets.
5. Applies the optimistic values atomically.
6. Invalidates changed-result descendants through the normal graph path.

Only one unresolved optimistic mutation may own a data node. A same-node conflict rejects before the conflicting remote request starts. Disjoint optimistic mutations remain independent.

Optimistic invalidation schedules subscribed work immediately. Derived descendants may recompute and data descendants may reload while the remote command remains pending. Data descendants use the normal load limiter; the mutation request does not.

## Optimistic ownership and snapshots

The optimistic session records:

- its private ownership token;
- target and affected-descendant snapshots;
- expected post-optimistic generations;
- the affected node set used for reconciliation and recovery.

Ownership and generation checks prevent an obsolete mutation from restoring snapshots over newer context changes, event invalidation, refresh, polling, execution, or independent mutation work.

## Known rejection rollback

A failure classified as `rejected` means the application has reliable evidence that the remote command did not commit.

Rollback restores the complete captured logical state only when ownership and expected state still match. Restoration is a new graph transition: previous data, status, freshness, error, and successful-value flags return, but generation advances rather than rewinding. Generations therefore remain monotonic, and work made obsolete by optimistic application cannot become current again.

If a captured non-target data descendant has already committed a changed successful value, rollback treats that as newer graph work even when its invalidation generation did not change. No snapshot is restored; current values are retained as stale for authoritative reconciliation.

After safe rollback, one scheduler pass is requested when restored state is stale and currently subscribed. Fresh restored state and stale unsubscribed state do not schedule work.

## Unknown outcome recovery

A timeout, disconnect, abort, malformed response, absent classifier, classifier failure, or other ambiguous transport result cannot prove that the server rejected the command.

For an `unknown` outcome, optimistic values are retained, the complete affected graph is marked stale, ownership is released, and subscribed nodes reconcile through the normal scheduler. The caller receives `GraphMutationOutcomeUnknownError` with the original remote error as its cause.

## Rollback conflicts

When known rejection arrives after newer graph work changed captured state, the runtime restores none of the snapshots. It retains current values as stale, releases ownership, schedules authoritative reconciliation for subscribed nodes, and rejects with `GraphMutationRollbackConflictError` identifying the conflicting node keys.

This all-or-nothing rollback decision prevents a mixture of old target state and newer descendant state.

## Confirmed remote success with local reconciliation failure

If an optimistic command succeeds remotely but local success preparation fails, rollback is unsafe because the server may already contain the change.

The runtime keeps optimistic values as stale, advances affected generations, aborts obsolete work, releases ownership, and schedules authoritative recovery. It rejects with `GraphMutationReconciliationError`, which records the mutation key, affected node keys, `remoteSucceeded: true`, and the local cause. No success update, explicit invalidation, or event publication partially commits.

Non-optimistic success-effect failure surfaces the original local error because there is no optimistic projection requiring recovery.

## Internal mutation responsibilities

The mutation implementation is split into focused internal capabilities:

- The update planner collects and validates synchronous replacement drafts without mutating graph state.
- The optimistic-session manager owns tokens, snapshots, expected state, conflict calculation, and ownership release.
- The mutation committer owns mutation-specific graph transitions, generation-before-abort ordering, notification, and scheduler decisions.
- The settlement coordinator selects confirmed success, exact rollback, rollback conflict, unknown outcome, or reconciliation-failure behaviour.
- The mutation controller is the only runtime-facing composition point and owns remote request orchestration.

These modules are private implementation boundaries. Public behaviour is specified through `runtime.mutate(...)`, public errors, diagnostics, and behaviour-focused tests rather than direct tests of private delegation.

## Transaction interaction

A mutation remains independent while a graph transaction is open. It reads committed graph state and is not committed or rolled back with that transaction.

Do not hold a graph transaction open around remote work. Mutation success effects already provide one synchronous local graph commit after remote settlement, while remote outcome classification and recovery require mutation-specific semantics.

## Deferred mutation capabilities

The current mutation model deliberately does not provide:

- automatic command retry;
- generated or persisted idempotency keys;
- offline mutation queues;
- layered optimistic writes to one data node;
- a global mutation concurrency limit;
- a generic Vue mutation composable.

Applications should generate and reuse domain-appropriate idempotency keys when retrying a logical command after an unknown outcome. Detailed adoption and error-handling guidance is maintained in the [Mutation Adoption Guide](../guides/04-mutation-adoption.md).
