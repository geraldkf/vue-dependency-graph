# ADR-010: Diagnostics Designed Into the Core

## Status

Superseded by [ADR-014](./ADR-014-runtime-observability.md) before this record was written out in full.

## Context

This number was reserved in the decision index for the original ADR-002 bullet "Snapshots are diagnostic first": snapshot restore as cache persistence is deferred, diagnostics come first.

## Decision

No separate decision record was written. By the time observability was actually designed and implemented (Milestone 10), the decision had grown well beyond "diagnostics before persistence" into the full structured event stream model - deterministic causation, a bounded in-memory collector, metrics reduced from the same stream, and versioned safe snapshots - and was recorded in full as ADR-014 rather than as a narrower record split from ADR-002's original bullet.

## Consequences

None beyond what ADR-014 documents. This record exists only so the number is not silently missing from the index.

## Superseded by

[ADR-014: Runtime Observability Through a Structured Event Stream](./ADR-014-runtime-observability.md) contains the actual context, decision, consequences, and alternatives considered.
