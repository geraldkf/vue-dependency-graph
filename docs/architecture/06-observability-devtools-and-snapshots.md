# Observability, Devtools, and Snapshots

Automatic orchestration reduces consumer code but makes runtime behaviour less visible. The observability architecture provides one optional structured event stream, metrics derived from that stream, safe diagnostic snapshots, and an embeddable inspector built only on public diagnostic contracts. The governing decisions are [ADR-014](../decisions/ADR-014-runtime-observability.md) and [ADR-015](../decisions/ADR-015-devtools-inspector-protocol.md).

## Why observability is part of the runtime

The runtime must make it possible to answer:

- Why did this node load?
- Which subscription, context change, event, mutation, refresh, or policy caused it?
- Which dependency blocked it?
- Was an attempt reused, queued, aborted, or discarded?
- How long did the operation take?
- Why is polling still active or stopped?
- Did a listener or diagnostic sink fail without affecting runtime behaviour?

These questions require lifecycle events and causal links. They cannot be reconstructed reliably from the graph change observer or a point-in-time state snapshot.

## Diagnostic event stream

A runtime emits diagnostics only when a sink is supplied. Events are immutable discriminated records emitted synchronously in runtime-local sequence order.

The stream covers:

- runtime creation and isolated listener failure;
- caller-owned execute, prefetch, refresh, and query operations;
- subscriptions and scheduler flushes;
- context and result invalidation;
- data load and derived execution outcomes;
- fresh-value skips, active-attempt reuse, concurrency queueing, abort, and discard;
- typed event matching and publication;
- transaction start, commit, rollback, and conflict;
- refresh-policy scheduling, retry, pause, resume, completion, failure, and stop;
- value release;
- mutation request, optimistic apply, remote settlement, success commit, rollback, rollback conflict, unknown outcome, and reconciliation failure.

Diagnostic records do not include event payloads, mutation inputs, mutation results, or transaction-staged values.

## Causality and identifiers

Every runtime has a runtime-local diagnostic identifier and monotonically increasing sequence numbers. Operations receive deterministic runtime-local operation identifiers. Cause identifiers connect initiating actions to scheduler work and node execution.

Identifiers are intended for one runtime timeline and deterministic tests. They are not globally unique process identifiers or distributed tracing identifiers. External telemetry adapters may add broader correlation.

## Failure isolation

The diagnostic emitter isolates sink exceptions. A throwing sink cannot change graph state, operation results, notifications, scheduling, settlement, or policy behaviour.

The graph observer also isolates listener failures. When diagnostics are enabled, a failed listener is reported as `runtime.listener-failed`, including safe error details and the committing operation identifier when available. Other listeners continue and runtime state remains committed.

Diagnostic emission is not awaited and is not included in `runtime.whenSettled()`.

## In-memory collector

`createInMemoryGraphDiagnostics(...)` provides a bounded diagnostic sink.

It retains the newest events in insertion order and reports how many older events were dropped. Metrics are reduced cumulatively as events arrive, so event eviction does not reduce historical counts or durations.

`getEvents()` and `getMetrics()` return immutable snapshots. `reset()` clears collector events and metrics only; it does not reset the runtime, subscriptions, scheduler, policies, mutations, or graph state.

A collector may be owned by one runtime or deliberately shared. Shared collectors preserve event runtime identifiers while aggregating metrics.

## Metrics

Metrics are projections of the diagnostic stream and therefore use the same lifecycle vocabulary as the timeline.

The reducer owns one mutable state object. Construction and reset use the same initializer, checked against the public metric snapshot type. Snapshot creation copies and freezes nested counters and durations, so later events and resets cannot change snapshots already returned to consumers.

The metrics snapshot includes:

- operation counts;
- per-node attempt outcomes and durations;
- current and maximum active data loads;
- concurrency queue counts and wait duration;
- fresh-value skips and active-attempt reuse;
- invalidation sources;
- scheduler outcomes;
- refresh-policy outcomes;
- transaction outcomes and durations;
- mutation outcomes and durations;
- current subscription totals;
- dropped-event count.

Metrics do not create a second instrumentation path or alter runtime execution.

## Diagnostic snapshots

`runtime.createDiagnosticSnapshot()` returns a versioned serialisable snapshot containing:

- runtime and schema identity;
- graph topology and event invalidation edges;
- node runtime states;
- scheduler state;
- subscription counts;
- refresh-policy state;
- optional collector metrics;
- retained and dropped diagnostic counts.

Snapshot construction is observational. It does not notify, schedule, execute, emit another diagnostic event, or mutate graph-owned values.

## Value safety and redaction

Node values are omitted by default. A node may opt into value inclusion or provide a synchronous typed redactor.

Included and redacted values must be safely serialisable primitives, arrays, or plain objects. Cycles, non-finite numbers, functions, symbols, `bigint`, and non-plain objects are omitted safely. Redactor exceptions produce a redaction-failed marker and safe error details instead of failing snapshot creation.

Runtime and scheduler errors use bounded serialisation without stack traces. Cyclic or excessively deep causes are marked as truncated.

## Stable normalisation

Public pure normalisers create deterministic snapshots, event streams, and exports for tests and offline comparison.

Normalisation replaces volatile timestamps, runtime identifiers, operation identifiers, cause identifiers, timer due times, and duration totals. Operation and cause identifiers are aliased consistently in first-seen order so causal relationships remain visible.

Functional data remains unchanged, including sequence order, event types, node and event keys, generations, reasons, origins, outcomes, safe errors, approved values, metrics, and graph state. Normalisation is immutable and idempotent.

## Devtools protocol

The devtools protocol is a framework-independent transformation layer over diagnostic snapshots, events, and metrics.

It computes:

- a deterministic graph view;
- node details;
- categorised timeline entries;
- grouped metrics views.

The protocol does not import Vue and does not read private runtime internals. The embeddable panel is one renderer; another renderer can reuse the same contracts.

## Deterministic graph view

Nodes are placed in columns by dependency depth and sorted deterministically within each column. Typed events occupy a separate lane with edges to nodes declaring them in `invalidatedBy`.

The layout avoids force-simulation jitter and produces stable positions for tests, exports, and repeated debugging sessions.

## Devtools panel

`GraphDevtoolsPanel` is an embeddable Vue component with four views:

- Graph
- Node
- Timeline
- Metrics

A live panel receives a `GraphRuntime` and the same `InMemoryGraphDiagnostics` instance used as the runtime's diagnostic sink. The panel does not create diagnostics implicitly and cannot reconstruct past events from runtime state alone.

The panel is read-only except for diagnostic snapshot export and import. It does not invalidate nodes, refresh nodes, publish synthetic events, or simulate failures.

## Offline snapshot inspection

Snapshot export combines current snapshot, retained events, and metrics into a versioned JSON document. Offline loading validates the document and feeds it through the same protocol transforms and rendering components as live mode.

Offline mode requires no live runtime. Returning to live mode resumes the current runtime and collector views, including activity that occurred while the offline snapshot was displayed.

Offline import does not restore graph values or state into a live runtime.

## Current limitations

The current observability and devtools surface deliberately does not include:

- runtime write or remote-control commands;
- `@vue/devtools-api` browser-extension integration;
- live cache restoration from diagnostic snapshots;
- globally unique or distributed tracing identifiers;
- built-in vendor-specific production telemetry adapters;
- automatic capture of node values without explicit inclusion or redaction.

These remain separate capabilities that require concrete consumer needs and their own compatibility and security decisions.
