# ADR-001

## Title
Dependency Graph Framework

## Status
Accepted

## Decision
Build a reusable framework instead of continuing as store-specific infrastructure.

## Rationale

The current implementation already supports:

- dependency execution
- subscriptions
- invalidation
- dependency resolution

The next evolution should be a standalone framework.
