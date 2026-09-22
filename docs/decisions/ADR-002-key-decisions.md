# ADR-002: Initial Key Decisions

## Status

Historical. The original decisions have been replaced by focused decision records, except for the synchronous derived-node rule retained below.

## Context

The initial framework design grouped several foundational choices into one record. As the runtime was implemented, each material decision gained enough context, consequences, and alternatives to justify its own ADR.

Keeping duplicate summaries here would create two sources of truth and allow the original wording to drift from the maintained decisions.

## Decision

Use the focused ADRs as the authoritative records:

- Typed node handles: [ADR-003](./ADR-003-typed-handles.md)
- Subscription-driven loading: [ADR-004](./ADR-004-subscription-driven-loading.md)
- Atomic graph transactions: [ADR-005](./ADR-005-atomic-graph-transactions.md)
- Typed domain events: [ADR-006](./ADR-006-domain-events.md)
- Separate status and freshness: [ADR-007](./ADR-007-status-freshness-separation.md)
- Branch-scoped failures: [ADR-008](./ADR-008-branch-scoped-failures.md)
- Refresh policies and polling: [ADR-012](./ADR-012-refresh-policies-and-polling.md)
- Runtime observability and diagnostic snapshots: [ADR-014](./ADR-014-runtime-observability.md)

ADR-009 and ADR-010 remain reserved numbers. Their original polling and diagnostics scopes were consolidated into ADR-012 and ADR-014 before separate decisions were written.

### Derived nodes remain synchronous

A derived node calculates synchronously from successful dependency values. Asynchronous work belongs in a data node so it uses the runtime's standard loading, cancellation, concurrency, failure, refresh, and diagnostic behaviour.

Async derived nodes remain deferred until a concrete use case demonstrates that a separate execution model is necessary.

## Consequences

- This record is historical navigation rather than an independent source of current behaviour.
- The linked ADRs can evolve without requiring duplicated summaries here.
- Derived-node behaviour remains explicit even though it does not have a separate ADR number.
