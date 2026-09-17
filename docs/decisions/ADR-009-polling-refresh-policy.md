# ADR-009: Polling as a Refresh Policy

## Status

Superseded by [ADR-012](./ADR-012-refresh-policies-and-polling.md) before this record was written out in full.

## Context

This number was reserved in the decision index for the original ADR-002 bullet "Polling is subscription aware": polling stops when subscription disappears unless explicitly configured otherwise.

## Decision

No separate decision record was written. By the time polling was actually designed and implemented (Milestone 8), the decision had grown to cover the full refresh-policy model - `staleAfter`, `refreshInterval`, and `pollUntil` together, subscription ownership, recursive-timeout scheduling, retry/backoff, and the injected environment abstraction - and was recorded in full as ADR-012 rather than as a polling-only record split from ADR-002's original bullet.

## Consequences

None beyond what ADR-012 documents. This record exists only so the number is not silently missing from the index.

## Superseded by

[ADR-012: Subscription-Aware Refresh Policies and Polling](./ADR-012-refresh-policies-and-polling.md) contains the actual context, decision, consequences, and alternatives considered.
