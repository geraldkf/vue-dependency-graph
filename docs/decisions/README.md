# Architecture Decision Records

Decision records capture choices that materially affect correctness, compatibility, or public API design.

## Index

- ADR-001: Standalone framework and layered monorepo
- ADR-002: Framework-agnostic core
- ADR-003: Typed handles over string-only consumer APIs
- ADR-004: Subscription-driven loading
- ADR-005: Atomic graph transactions
- ADR-006: Domain events over direct cross-store dependencies
- ADR-007: Separate execution status from freshness
- ADR-008: Branch-scoped failure handling
- ADR-009: Polling as a refresh policy
- ADR-010: Diagnostics designed into the core
- ADR-011: Execution concurrency limit
- ADR-012: Subscription-aware refresh policies and polling
- ADR-013: Typed mutations with guarded optimistic rollback
- ADR-014: Runtime observability through a structured event stream

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
