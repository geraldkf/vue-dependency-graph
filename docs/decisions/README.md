# Architecture Decision Records

Decision records capture choices that materially affect correctness, compatibility, or public API design.

## Index

- ADR-001: Standalone framework with logical source layers
- ADR-002: Historical index of the initial key decisions
- ADR-003: Typed handles over string-only consumer APIs
- ADR-004: Subscription-driven loading
- ADR-005: Atomic graph transactions
- ADR-006: Domain events over direct cross-store dependencies
- ADR-007: Separate execution status from freshness
- ADR-008: Branch-scoped failure handling
- ADR-009: Reserved scope consolidated into ADR-012; no separate decision record
- ADR-010: Reserved scope consolidated into ADR-014; no separate decision record
- ADR-011: Execution concurrency limit
- ADR-012: Subscription-aware refresh policies and polling
- ADR-013: Typed mutations with guarded optimistic rollback
- ADR-014: Runtime observability through a structured event stream
- ADR-015: Devtools as an embeddable component over a protocol layer
- ADR-016: Automatic value release through timer-based release policies
- ADR-017: Runtime extension host deferred
- ADR-018: Aborting an attempt ends it, even if the loader ignores the signal
- ADR-019: Scheduler flushes overlap instead of queuing behind one another

ADR-009 and ADR-010 are reserved numbers without separate files. By the time polling and observability were designed, each had grown beyond its original ADR-002 scope. Their decisions are recorded once in ADR-012 and ADR-014 respectively rather than duplicated.

## Template

```md
# ADR-NNN: Title

## Status

Proposed | Accepted | Superseded | Rejected

## Context

## Decision

## Consequences

## Alternatives considered
```
