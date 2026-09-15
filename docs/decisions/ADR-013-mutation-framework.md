# ADR-013: Typed Mutations with Guarded Optimistic Rollback

## Status

Accepted and implemented in Milestone 9. Full combined-checkout validation remains pending.

## Context

Before Milestone 9, the graph runtime could load, refresh, invalidate, transact local context changes, and publish typed invalidation events, but did not own remote command execution or the local cache effects that follow a command.

Application code therefore has no common way to coordinate:

- an optimistic cache update before a request settles;
- direct reconciliation from a successful response;
- invalidation and typed event publication after success;
- restoration after a known rejection;
- safe behaviour when a transport failure leaves the remote outcome unknown;
- races with refresh, invalidation, or another optimistic command.

Graph transactions are not a solution to this problem. They hide local writes until commit and provide no backend rollback. Optimistic mutations require the opposite visibility model: apply a local projection immediately, then confirm, reconcile, or restore it after remote work settles.

## Decision

Add immutable typed mutation definitions and `GraphRuntime.mutate(...)`.

A mutation definition owns a stable key and a typed remote execute function. One mutate call owns one remote attempt and optional local effect callbacks.

Local effects use narrow typed capabilities:

- direct update of data nodes that already have a successful value;
- invalidation of data or derived nodes;
- typed event publication after confirmed success.

Optimistic effect callbacks are planned before they mutate runtime state. Their target handles, successful-value requirements, duplicate writes, and ownership conflicts are validated first. The runtime then captures complete rollback snapshots and applies all optimistic values atomically.

Only one unresolved optimistic mutation may own a given data node. A conflicting mutation is rejected before its request starts. Disjoint optimistic mutations and non-optimistic mutations may proceed concurrently.

Optimistic failures are classified as `rejected` or `unknown`:

- `rejected` means the application knows the remote command did not commit. Eligible snapshots are restored atomically.
- `unknown` means the command may have committed. The runtime does not restore optimistic values. It marks affected state stale and requests authoritative reconciliation.

An omitted classifier defaults to `unknown` for optimistic work.

Rollback is guarded by mutation ownership and node generation. If newer graph work changed a target after the optimistic write, the old snapshot is not restored over that work. The mutation rejects with a rollback-conflict error and leaves the node available for normal reconciliation.

Confirmed success applies direct updates, explicit invalidation, and typed event effects through one local commit. Event publication does not occur for optimistic apply, known rejection, unknown outcome, or rollback.

Mutation execution does not keep a graph transaction or notification buffer open while awaiting the remote request. Mutation requests do not consume `maxConcurrentLoads`, which remains specific to data-node loaders.

## Consequences

- Consumers receive a typed, reusable remote-command primitive without turning mutations into graph nodes.
- Optimistic UI is possible while preserving the existing graph as the single cache owner.
- Known rejection and ambiguous transport failure have deliberately different behaviour.
- The framework avoids unsafe last-writer-wins rollback.
- The first release cannot layer two optimistic mutations over the same data node.
- Optimistic ownership is acquired before remote execution. A conflicting same-node request does not start.
- Known rejection restores complete target and affected-descendant snapshots only when private ownership and all expected generations still match.
- Rollback conflicts preserve newer values, mark affected state stale, schedule authoritative reconciliation, and report immutable sorted conflict keys with the original rejection as cause.
- Unknown outcomes retain optimistic values, mark the affected subgraph stale, schedule subscribed reconciliation, and preserve the remote error as the cause of `GraphMutationOutcomeUnknownError`.
- Direct updates cannot create a first successful value from a node's placeholder initial value.
- Application code must classify API-specific known rejection when it wants automatic rollback.
- Remote success followed by local reconciliation failure remains possible and must be reported honestly. No client library can roll back a committed server command automatically.
- Confirmed success updates, explicit invalidation, and typed event effects share one local commit. Event predicates evaluate against final direct-update values before any graph mutation.
- A directly updated value is retained as stale when the same node is invalidated, enabling immediate display followed by authoritative reload.
- Mutation retries, idempotency keys, offline queues, and global command concurrency remain application or later-milestone concerns.
- Mutation implementation may extract a narrow invalidation planner or safer active-attempt iteration only when required by a concrete commit or rollback path.
- The runtime state store remains a storage capability and does not become the owner of stale-state, subscription, or cancellation policy.
- Existing refresh-policy, transaction-buffer, execution, and Vue adapter structures are not prerequisites for mutation work and remain unchanged unless a mutation test exposes a concrete integration need.

## Alternatives considered

### Use graph transactions around remote requests

Rejected. It would keep local notification and scheduling state open across network latency, still could not roll back the server, and conflicts with the established explicit transaction ownership model.

### Roll back every thrown request error

Rejected. Timeouts, disconnects, and aborts can occur after server commit. Automatic rollback would falsely present the command as not having happened.

### Never roll back automatically

Rejected. Known validation and business rejections can safely restore optimistic state, and automatic snapshot restoration is the milestone's primary user value.

### Allow overlapping optimistic layers

Deferred. Correct layer composition requires ordering rules for success, rejection, refresh, invalidation, and event effects. Per-node ownership is smaller and safer for the first release.

### Put reconciliation callbacks on mutation definitions

Not selected for the first API. Shared mutation contracts should not need to import page-specific graph nodes. Per-call effects keep the remote command reusable across application surfaces. An application wrapper may standardise repeated effects.

### Update context and derived nodes directly

Rejected. Context changes already have explicit APIs and derived values must remain functions of dependencies. Direct mutation writes are limited to successful data-node cache values.

### Add a Vue mutation composable immediately

Deferred. The core capability should be proven first. A composable is justified only if the playground and application trial reveal repeatable reactive lifecycle needs.

### Add transaction IDs or explicit transaction rollback as mutation infrastructure

Rejected for Milestone 9. Transaction identifiers belong with structured diagnostics, where generation, stability, and snapshot normalization can be designed together. Optimistic rollback has different semantics from transaction discard and must remain guarded by mutation ownership, snapshots, generations, and remote-outcome classification.

### Refactor adjacent runtime capabilities before mutation implementation

Rejected as a prerequisite. Similar assignments or large files do not by themselves justify changing established capability ownership. Small cleanup may be included only when the active mutation slice already touches the code and the change preserves focused behavioural coverage.

## Detailed plan

See `docs/implementation/87-milestone-9-mutation-framework-plan.md`.
