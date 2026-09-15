# Observability, Devtools, and Snapshots

## Status

Milestone 10 has an approved detailed implementation plan. M10A through M10C diagnostic foundations, core execution causality, and advanced lifecycle diagnostics are implemented with offline validation pending. M10D collector and metrics work has not started. See [the Milestone 10 observability plan](../implementation/110-milestone-10-observability-plan.md) and [ADR-014](../decisions/ADR-014-runtime-observability.md).

The accepted direction is one optional structured diagnostic event stream with deterministic runtime-local causation, a bounded in-memory collector, metrics reduced from the same stream, and safe versioned snapshots. Devtools UI and inspector transport remain Milestone 11 work.

## Why observability is part of the architecture

Automatic orchestration reduces consumer code but makes hidden execution possible. The framework must make it easy to answer:

- Why did this node load?
- Which context or event invalidated it?
- Which dependencies blocked it?
- Was the result discarded as obsolete?
- How long did each execution take?
- Why is polling still active?

## Diagnostic event stream

The core should emit structured diagnostic events through an optional observer:

- Node registered
- Subscription added or removed
- Node invalidated
- Execution scheduled
- Node execution started, succeeded, failed, aborted, or discarded
- Transaction started, committed, or rolled back
- Domain event published
- Poll scheduled or stopped
- Mutation started, committed, or rolled back

Diagnostics must be bounded or stream-based so long-running applications do not leak memory.

## Metrics

Initial metrics:

- Execution count
- Node load count
- Success, failure, abort, and discarded-result counts
- Cache/fresh-value reuse count
- Node execution duration
- Query time-to-ready
- Retry count
- Poll attempt count and total polling duration
- Active subscription count
- Transaction count and duration

Metrics are projected from the structured diagnostic event stream so counters and timelines share one lifecycle vocabulary. The core provides an optional bounded in-memory collector. Vendor-specific telemetry adapters remain application or later-milestone work.

## Devtools views

### Graph view

- Nodes and dependency edges
- Event invalidation edges
- Node kind
- Runtime status and freshness
- Active subscriptions

### Node inspector

- Current value with configurable redaction
- Dependencies and descendants
- Last execution
- Last invalidation reason
- Error
- Refresh and retry policies
- Metrics

### Timeline

- Scheduler flushes
- Executions
- Transactions
- Events
- Mutations
- Poll cycles

### Controls

Development-only controls may:

- Invalidate a node
- Refresh a node
- Publish a synthetic event
- Simulate failure or delay through the playground adapter
- Export a snapshot

## Snapshot diagnostics

A snapshot is a serialisable diagnostic representation, not a default cache-persistence mechanism.

Include:

- Schema version
- Framework version
- Timestamp
- Registered topology
- Node status and freshness
- Redacted or omitted values
- Errors in serialisable form
- Last invalidation reason
- Subscription counts
- Selected metrics

## Redaction and privacy

Node values are omitted from diagnostic snapshots by default. A node may explicitly opt in to value inclusion or provide a synchronous custom redactor through immutable definition metadata. The exact public metadata shape is finalised with compile-time coverage in M10E. Redactor failure must omit the value rather than fail snapshot creation.

## Snapshot testing

Tests should assert stable functional fields, not timestamps or incidental execution IDs. Provide a normaliser that excludes volatile fields.

## Importing snapshots

Snapshot import for visual inspection is useful. Restoring snapshots as live cache state is a separate persistence feature and should not be included initially.
