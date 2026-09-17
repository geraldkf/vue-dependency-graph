# ADR-002: Initial Key Decisions

## Status

Historical. Every decision below has since been split into its own record, except "Derived nodes are synchronous initially," which never had a number reserved for it and remains here.

## Decisions

### Typed handles

Public consumer APIs use typed node and event handles. String keys remain for identity and diagnostics.

Split into its own record: see `ADR-003-typed-handles.md`.

### Subscription-driven execution

Registration does not load data. Consumer subscription, prefetch, refresh, or an active refresh policy schedules execution.

Split into its own record: see `ADR-004-subscription-driven-loading.md`.

### Freshness is distinct from execution status

A node can retain stale data while refreshing or after a refresh error.

Split into its own record: see `ADR-007-status-freshness-separation.md`.

### Transactions provide local atomicity

A graph transaction batches local context, event, mutation, and invalidation changes. It does not promise backend transactional rollback.

Split into its own record once the implementation approach was decided: see `ADR-005-atomic-graph-transactions.md`.

### Domain events avoid direct store coupling

Domains publish typed business events. Other graph nodes declare event-based invalidation.

Split into its own record once the implementation approach was decided: see `ADR-006-domain-events.md`.

### Partial failure is branch scoped

A failed node blocks dependent descendants but does not stop unrelated branches.

Split into its own record: see `ADR-008-branch-scoped-failures.md`.

### Derived nodes are synchronous initially

Async work uses data nodes to retain one execution and error model.

### Polling is subscription aware

Polling stops when subscription disappears unless explicitly configured otherwise.

Superseded, without a separate write-up of this bullet alone, by the fuller `ADR-012-refresh-policies-and-polling.md`; see `ADR-009-polling-refresh-policy.md` for the pointer.

### Snapshots are diagnostic first

Snapshot restore as cache persistence is deferred.

Superseded, without a separate write-up of this bullet alone, by the fuller `ADR-014-runtime-observability.md`; see `ADR-010-diagnostics-in-core.md` for the pointer.
