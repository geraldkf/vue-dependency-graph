## ADR-014: Runtime Observability Through a Structured Event Stream

### Status

Accepted for Milestone 10 implementation.

### Context

The graph runtime automatically coordinates subscriptions, scheduling, dependency execution, invalidation, transactions, typed events, refresh policies, polling, and optimistic mutations. This reduces consumer orchestration but makes it difficult to answer why work occurred, which operation caused it, whether work was reused or discarded, and how long a lifecycle took.

The existing graph observer intentionally has no payload and exists to tell reactive consumers that committed runtime state may have changed. Expanding that observer into diagnostics would mix UI state propagation with tracing, would make transaction notification buffering affect diagnostics, and would encourage consumers to infer lifecycle events from snapshots.

Maintaining separate instrumentation and metrics call paths would also risk semantic drift. A counter could report a mutation rollback that does not correspond to the diagnostic timeline, or a newly added lifecycle could be instrumented in one system but omitted from the other.

Diagnostic output may contain sensitive graph data. A safe default is required before snapshots or future devtools can expose values.

### Decision

Add one optional, framework-agnostic structured diagnostic event stream to each `GraphRuntime`.

The runtime will create one failure-isolating diagnostic emitter when a sink is configured. Core capabilities emit immutable discriminated events through that emitter at established lifecycle boundaries. Sink exceptions do not alter graph state, operation promises, observer notification, scheduling, or settlement.

Events use deterministic runtime-local sequence and operation identifiers. Causal links connect subscriptions, invalidations, caller-owned operations, transactions, policies, and mutations to node execution. Runtime-local IDs are diagnostic identities, not distributed tracing identifiers.

Metrics are reduced from the diagnostic stream. The first provided sink is a bounded in-memory collector that retains recent events and maintains cumulative counters independently of event eviction.

Diagnostic snapshots are versioned and separate from public runtime state snapshots. Node values are omitted by default. Inclusion or redaction requires explicit immutable node-definition metadata. Snapshot import and live cache restoration are not included.

Diagnostics remain outside the graph observer and transaction notification buffer. Diagnostic emission is not awaited and is not included in `whenSettled()`.

### Consequences

- Existing runtimes that omit diagnostics retain their current behaviour and do not retain event history.
- Every emitted event has a deterministic order within one runtime.
- A diagnostic sink cannot break graph behaviour by throwing.
- Metrics and timelines share one lifecycle vocabulary.
- Correlation can explain causal chains without exposing transaction-staged values, mutation inputs, mutation results, or event payloads.
- Future devtools can consume stable events and snapshots rather than private runtime internals.
- Event contracts become public compatibility surface and must be added deliberately.
- Synchronous emission adds bounded work at instrumented lifecycle points when diagnostics are enabled.
- A bounded collector may drop old events, so dropped-record count is part of its inspection contract.
- Safe snapshot defaults may omit values needed for a specific investigation. Consumers must explicitly opt in at node definition time.

### Alternatives considered

#### Add payloads to `runtime.onChange(...)`

Rejected. The observer is a reactive invalidation signal with transaction-aware dispatch behaviour. Diagnostics require start, queue, abort, discard, causation, and duration events that do not all correspond to committed reactive state changes.

#### Maintain metrics directly in every capability

Rejected. Independent counters and event emission would duplicate lifecycle decisions and could drift. Metrics will consume the same diagnostic records used by the timeline.

#### Always retain a runtime event history

Rejected. Production consumers may not need diagnostics, and unbounded history would leak memory. Retention belongs to an optional bounded sink.

#### Use globally unique random identifiers

Rejected for the first release. Runtime-local deterministic identifiers are easier to test and are sufficient for one runtime timeline. External telemetry adapters may add process or distributed correlation later.

#### Include node values by default

Rejected. Graph values may contain personal or operationally sensitive information. Omission is the safe default, with explicit inclusion or redaction where justified.

#### Build the devtools protocol at the same time

Rejected. Milestone 10 must first prove the event, metrics, and snapshot contracts. UI transport, command handling, and offline viewing remain Milestone 11 concerns.

### Implementation plan

See `docs/implementation/110-milestone-10-observability-plan.md`.
