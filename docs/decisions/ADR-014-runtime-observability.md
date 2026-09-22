# ADR-014: Runtime Observability Through a Structured Event Stream

## Status

Accepted, implemented, and validated.

## Context

The graph runtime automatically coordinates subscriptions, scheduling, dependency execution, invalidation, transactions, typed events, refresh policies, polling, release policies, and optimistic mutations. This reduces consumer orchestration but makes it difficult to answer why work occurred, which operation caused it, whether it was reused or discarded, and how long a lifecycle took.

The graph change observer intentionally has no payload and only tells reactive consumers that committed runtime state may have changed. Expanding that observer into diagnostics would mix UI state propagation with lifecycle tracing and encourage consumers to reconstruct causes from snapshots.

Independent instrumentation and metrics paths would also risk semantic drift. A metric could report an outcome that does not correspond to the diagnostic timeline, or a new lifecycle could be added to one path and omitted from the other.

Diagnostic output may expose sensitive graph values. Safe omission and explicit redaction are required before snapshots or tooling can inspect runtime state.

## Decision

Add one optional, framework-independent structured diagnostic event stream to each `GraphRuntime`.

### Diagnostic emission

When a sink is configured, the runtime creates one failure-isolating diagnostic emitter. Core capabilities emit immutable discriminated events at established lifecycle boundaries. Sink exceptions do not alter graph state, operation promises, observer notification, scheduling, settlement, policy work, or mutation outcomes.

Diagnostics remain separate from the graph change observer. They are emitted synchronously, are not awaited, and are not included in `runtime.whenSettled()`.

### Identity and causality

Events use monotonically increasing runtime-local sequence numbers and deterministic runtime-local operation identifiers. Cause identifiers connect subscriptions, invalidations, caller-owned operations, scheduler flushes, transactions, policies, and mutations to the node work they trigger.

Runtime identifiers and operation identifiers are diagnostic labels. They are not globally unique process identifiers or distributed tracing identifiers.

### Metrics and bounded collection

Metrics are reduced from the same diagnostic event stream rather than maintained through a separate instrumentation path.

The provided in-memory collector retains a bounded window of recent events while maintaining cumulative metrics independently of event eviction. It reports how many older events were dropped. Collector reset affects only retained diagnostic state and metrics; it does not mutate the runtime.

### Diagnostic snapshots

`runtime.createDiagnosticSnapshot()` creates a versioned serialisable diagnostic representation of current topology, node state, scheduler state, subscriptions, policy state, retained diagnostics, and available metrics.

Snapshots are observational. Creating one does not notify observers, schedule work, emit another diagnostic event, or mutate graph-owned values.

Node values are omitted by default. A node may explicitly include its value or provide a synchronous redactor. Included or redacted values must be safely serialisable. Unsupported values are omitted, and a redactor failure produces a safe marker rather than failing snapshot creation.

Diagnostic snapshots are not a cache-persistence or live-state restoration format.

### Stable normalisation

Public pure normalisers replace volatile timestamps, runtime identifiers, operation identifiers, cause identifiers, timer due times, and duration totals with deterministic values while preserving event order, causal relationships, keys, generations, outcomes, errors, and explicitly approved values.

Normalisation returns new immutable values, does not mutate its input, and is stable when applied repeatedly.

## Consequences

- Runtimes without a configured sink retain no diagnostic history and preserve normal behaviour.
- Sink failure cannot break runtime correctness.
- Timelines and metrics share one lifecycle vocabulary.
- Causal chains can be inspected without exposing event payloads, mutation inputs, mutation results, or transaction-staged values.
- Bounded collection prevents unbounded event retention while preserving cumulative metrics.
- Snapshot value omission is safe by default but requires explicit node-level configuration when a value is needed for investigation.
- Diagnostic event contracts are a public compatibility surface and must be extended deliberately.
- Synchronous emission adds bounded work at instrumented lifecycle points when diagnostics are enabled.

Transaction ownership and scheduler settlement are defined by [ADR-005](./ADR-005-atomic-graph-transactions.md). The devtools consumption model is defined by [ADR-015](./ADR-015-devtools-inspector-protocol.md). Public contracts are maintained in the [Public API](../api/01-public-api.md).

## Alternatives considered

### Add payloads to `runtime.onChange(...)`

Rejected. The observer is a reactive invalidation signal, while diagnostics require start, queue, reuse, abort, discard, causation, duration, and policy events that do not all correspond to committed UI state changes.

### Maintain metrics directly in each capability

Rejected. Independent counters and timeline emission would duplicate lifecycle decisions and could drift.

### Always retain runtime event history

Rejected. Production consumers may not need diagnostics, and unbounded history would leak memory. Retention belongs to an optional bounded sink.

### Use globally unique random identifiers

Rejected for the core runtime. Deterministic runtime-local identifiers are easier to test and sufficient for one runtime timeline. External telemetry adapters may add process or distributed correlation.

### Include node values by default

Rejected. Graph values may contain personal or operationally sensitive information. Omission is the safe default, with explicit inclusion or redaction where justified.

### Restore diagnostic snapshots into live cache state

Rejected. Offline inspection and live cache restoration have different compatibility and correctness requirements. Persistence remains a separate deferred capability.
