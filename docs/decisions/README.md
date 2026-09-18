# Architecture Decision Records

Decision records capture choices that materially affect correctness, compatibility, or public API design.

## Index

- ADR-001: Standalone framework and layered monorepo
- ADR-002: Framework-agnostic core, and remaining initial decisions not split into their own records
- ADR-003: Typed handles over string-only consumer APIs
- ADR-004: Subscription-driven loading
- ADR-005: Atomic graph transactions
- ADR-006: Domain events over direct cross-store dependencies
- ADR-007: Separate execution status from freshness
- ADR-008: Branch-scoped failure handling
- ADR-009: Polling as a refresh policy - superseded by ADR-012
- ADR-010: Diagnostics designed into the core - superseded by ADR-014
- ADR-011: Execution concurrency limit
- ADR-012: Subscription-aware refresh policies and polling
- ADR-013: Typed mutations with guarded optimistic rollback
- ADR-014: Runtime observability through a structured event stream
- ADR-015: Devtools as an embeddable component over a protocol layer

Every number above now has a file. ADR-009 and ADR-010 are short pointers rather than full records: by the time polling and observability were actually designed, each had grown well beyond its original ADR-002 bullet, so the full decision is recorded once, in ADR-012 and ADR-014 respectively, rather than duplicated.

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
