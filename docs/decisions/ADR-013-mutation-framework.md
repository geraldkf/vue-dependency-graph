# ADR-013: Typed Mutations with Guarded Optimistic Rollback

## Status

Accepted, implemented, and validated.

## Context

The graph runtime owns server-backed read state, but applications also issue remote commands whose outcomes may need to update, invalidate, or reconcile that state.

Graph transactions do not solve this problem. They stage local context and event changes until commit and cannot roll back a backend operation. Optimistic commands require the opposite visibility model: expose a local projection immediately, then confirm, reconcile, or recover it after the remote request settles.

The mutation model must distinguish a confirmed rejection from an ambiguous transport outcome and must never restore an old snapshot over newer graph work.

## Decision

Add immutable typed mutation definitions and caller-owned `runtime.mutate(...)` operations.

A mutation definition contains a stable key and a typed remote `execute` function. Each call represents one independent remote attempt. Mutation requests are not graph nodes, are not deduplicated, and do not consume the data-loader `maxConcurrentLoads` budget.

### Confirmed-success effects

After remote success, a synchronous `onSuccess` callback may prepare a local graph commit that:

- updates data nodes that already contain a successful value;
- explicitly invalidates data or derived nodes;
- publishes typed events.

The runtime prepares and validates the complete effect draft before changing graph state. Direct updates, explicit invalidation, event invalidation, and their descendants are combined into one local commit. Each affected node advances generation at most once, observers receive one coherent notification, and subscribed stale work requests at most one scheduler pass.

Update callbacks are pure replacement functions. They must not mutate graph-owned values in place. Development and test builds guard plain arrays and objects to detect such writes before commit.

Event predicates evaluate before mutation-owned state changes commit. They may read final direct data updates through the prepared overlay, but they may not read a derived dependency affected by the same mutation draft because that value has not recomputed yet.

### Optimistic effects

An optional synchronous `optimistic` callback may update successful data nodes before remote execution begins.

The runtime validates the complete optimistic draft, captures the target and affected-descendant snapshots, acquires private ownership of the effective target nodes, and applies the projection atomically. Only one unresolved optimistic mutation may own a data node. A conflicting same-node mutation is rejected before its remote request starts; disjoint mutations remain independent.

Optimistic invalidation participates in normal graph scheduling immediately. Subscribed derived descendants may recompute and subscribed data descendants may reload while the remote command is still pending.

### Remote outcomes

Optimistic failure handling distinguishes two application-classified outcomes:

- `rejected`: the application has reliable evidence that the server did not commit the command;
- `unknown`: the command may have committed, such as after a timeout, disconnect, abort, malformed response, or classifier failure.

A missing classifier defaults to `unknown`.

For a known rejection, the runtime restores the captured logical snapshots only when the optimistic session still owns every target and no captured node contains newer graph work. Restoration is itself a new committed transition, so generations advance rather than returning to previous values. If newer work is detected, no snapshot is restored; current state is retained as stale for authoritative reconciliation.

For an unknown outcome, optimistic values are not rolled back. The affected graph remains available but stale, subscribed nodes reconcile through the scheduler, and the caller receives an error that preserves the original remote cause.

If the remote command succeeds but optimistic success reconciliation fails, rollback is also unsafe. The runtime retains the optimistic projection as stale, releases ownership, schedules authoritative recovery, and reports that the remote operation succeeded but local reconciliation did not.

### Transaction interaction

A mutation remains independent while a graph transaction is open. It reads committed graph state and is not committed or rolled back with that transaction.

Do not hold a graph transaction open around remote mutation work. Confirmed mutation effects already use one synchronous local graph commit, while the remote command requires its own outcome and recovery semantics.

## Consequences

- Remote commands have typed input and result contracts without becoming graph nodes.
- Confirmed server responses can reconcile cached values immediately or invalidate authoritative data.
- Optimistic UI is supported without unsafe last-writer-wins rollback.
- Known rejection and ambiguous remote outcome deliberately produce different recovery behaviour.
- Newer context, event, refresh, polling, execution, or mutation work is never overwritten by an obsolete optimistic snapshot.
- Same-node optimistic overlap is rejected rather than introducing layered optimistic patches and ordering rules.
- Mutation retry, idempotency keys, offline queues, and global command concurrency remain application or future concerns.

Detailed usage guidance, public error handling, idempotency considerations, and examples belong in the [user guide's mutations section](../guides/00-user-guide.md#12-mutations).

## Alternatives considered

### Use graph transactions around remote requests

Rejected. A graph transaction cannot roll back the server, and holding one open across network latency would introduce incorrect ownership and settlement expectations.

### Roll back every thrown request error

Rejected. A timeout or disconnect may occur after the server committed the command. Automatic rollback would present a potentially false local result.

### Never roll back automatically

Rejected. Explicit validation or business rejection can prove that the server did not commit, allowing a guarded snapshot restoration.

### Allow overlapping optimistic layers on one node

Deferred. Correct composition requires ordering rules across success, rejection, refresh, invalidation, and event effects. Per-node ownership is smaller and safer.

### Put graph reconciliation on shared mutation definitions

Rejected for the initial API. Shared remote command contracts should not need to import page-specific graph nodes. Per-call effects keep command definitions reusable.

### Update context or derived nodes directly

Rejected. Context changes use their existing APIs, and derived values remain functions of their dependencies. Direct mutation updates are limited to successful data-node values.
