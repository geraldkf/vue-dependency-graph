# ADR-002: Initial Key Decisions

## Status

Proposed. Split decisions into separate ADRs when each design is implemented.

## Decisions

### Typed handles

Public consumer APIs use typed node and event handles. String keys remain for identity and diagnostics.

### Demand-driven execution

Registration does not load data. Consumer demand, prefetch, refresh, or an active refresh policy schedules execution.

### Freshness is distinct from execution status

A node can retain stale data while refreshing or after a refresh error.

### Transactions provide local atomicity

A graph transaction batches local context, event, mutation, and invalidation changes. It does not promise backend transactional rollback.

### Domain events avoid direct store coupling

Domains publish typed business events. Other graph nodes declare event-based invalidation.

### Partial failure is branch scoped

A failed node blocks dependent descendants but does not stop unrelated branches.

### Derived nodes are synchronous initially

Async work uses data nodes to retain one execution and error model.

### Polling is demand aware

Polling stops when demand disappears unless explicitly configured otherwise.

### Snapshots are diagnostic first

Snapshot restore as cache persistence is deferred.
