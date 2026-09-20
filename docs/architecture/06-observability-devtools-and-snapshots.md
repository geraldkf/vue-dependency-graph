# Observability, Devtools, and Snapshots

## Status

Milestone 10 is implemented and validated. M10A through M10G delivered diagnostic foundations, lifecycle causality, advanced diagnostics, the bounded in-memory collector and metrics, versioned safe snapshots, stable normalisation and regression coverage, and the Runtime Observability playground. Final reconciliation also completed transaction-overlap isolation, documentation cleanup, and the Transaction Isolation playground. See [the Milestone 10 observability plan](../implementation/110-milestone-10-observability-plan.md), [the transaction overlap isolation plan](../implementation/114-transaction-overlap-isolation-plan.md), and [ADR-014](../decisions/ADR-014-runtime-observability.md).

The accepted direction is one optional structured diagnostic event stream with deterministic runtime-local causation, a bounded in-memory collector, metrics reduced from the same stream, and safe versioned snapshots. Milestone 11 (complete) delivered the devtools UI as an embeddable Vue component panel (`src/devtools`) - see [ADR-015](../decisions/ADR-015-devtools-inspector-protocol.md) for why that shape rather than a `@vue/devtools-api` browser-extension integration, and the per-view status notes below for what shipped against the original vision versus what's still open.

## Devtools panel

`GraphDevtoolsPanel` (`src/devtools/components/GraphDevtoolsPanel.vue`) is a tabbed panel a consuming app mounts against its own `runtime` and an `InMemoryGraphDiagnostics` collector. Every view is a thin renderer over a pure, framework-agnostic transform in `src/devtools/protocol/` - see ADR-015. `useGraphDevtools` wires a live runtime in; `useOfflineDevtoolsSnapshot` loads a previously exported JSON snapshot into the exact same views with no runtime attached, so a snapshot can be captured from one session and inspected or shared later.

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
- Change listener failed (`runtime.listener-failed`): listeners are isolated from one another, and this is how a failure in one, including one of the runtime's own background policies, stays visible
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

Status against this original vision: Graph view, Node inspector, and Timeline are delivered as described below, with two exceptions noted inline. Controls (the write/remote-control section) was **not** built - the panel that shipped is a read-only inspector plus export/import, not a remote-control console. Extending it with write controls remains open future work, not something ADR-015 rejected; it just wasn't in Milestone 11's scope.

### Graph view

- Nodes and dependency edges
- Event invalidation edges
- Node kind
- Runtime status and freshness
- Active subscriptions

### Node inspector

- Current value with configurable redaction
- Dependencies and descendants
- ~~Last execution~~ - not surfaced as a distinct field; cross-reference the Timeline, filtered to the selected node, instead
- ~~Last invalidation reason~~ - same as above; the Timeline's `node.invalidated` entries carry this, the inspector doesn't duplicate it
- Error
- Refresh and retry policies
- Metrics

### Timeline

- Scheduler flushes
- Executions
- Transactions
- Events
- Mutations
- Poll cycles (via `refresh-policy.*` events, which cover both interval refresh and poll-until sessions)

### Controls

Not delivered in Milestone 11. Development-only controls may still be added later:

- Invalidate a node
- Refresh a node
- Publish a synthetic event
- Simulate failure or delay through the playground adapter
- Export a snapshot (this one *is* delivered, as `GraphDevtoolsPanel`'s "Export snapshot" button)

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
