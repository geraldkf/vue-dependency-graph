# Roadmap

## Current status

The initial Vue Dependency Graph framework capabilities are implemented and validated. The runtime includes typed graph definitions, dependency-aware execution, subscription-driven scheduling, Vue and Pinia integration, isolated local graph transactions, typed event invalidation, query groups, refresh policies and polling, typed and optimistic mutations, diagnostics, snapshots, devtools, automatic value release, retention hardening, and overlapping scheduler flushes.

The framework is pre-1.0 (`0.x`) and its public APIs may change between minor versions. The bounded existing-application migration trial is planned for Helix; npm publication may precede its completion, while API stabilization at 1.0 will be informed by the trial's evidence.

The October 2026 maintenance pass adds context-protected mutation updates, generation-aware polling restart, diagnostic collector observation, explicit owner shutdown, parsed architecture boundaries, separate Node/DOM test projects, production Chromium smoke checks, and scale measurements. Dependency advisories were addressed and CI now covers Node 22/24. See [the staged maintenance record](../MAINTENANCE.md) and [application trial plan](./maintenance/migration-trial.md).

## Completed capabilities

### Foundation and graph model

- One package with enforced logical boundaries between core, Vue, devtools, and playground code
- Immutable typed context, data, and derived node handles
- Validated graph topology with deterministic parent and child indexes
- Separate runtime state for values, status, freshness, errors, generations, subscriptions, and active work

See [System overview](./architecture/01-system-overview.md), [Graph and node model](./architecture/02-graph-and-node-model.md), and [ADR-001](./decisions/ADR-001-foundation.md).

### Execution and scheduling

- Dependency-aware execution with concurrent independent branches
- Branch-scoped failure handling
- Generation and active-attempt protection against obsolete results
- Runtime-wide FIFO data-load concurrency limits
- Subscription-driven microtask scheduling
- Overlapping scheduler flushes without unrelated head-of-line blocking
- Abort completion that preserves runtime liveness even when a loader ignores its signal

See [Execution, scheduling, transactions, and concurrency](./architecture/03-scheduler-transactions-and-concurrency.md), [ADR-011](./decisions/ADR-011-execution-concurrency-limit.md), [ADR-018](./decisions/ADR-018-abort-ends-the-attempt.md), and [ADR-019](./decisions/ADR-019-overlapping-scheduler-flushes.md).

### Vue integration

- Scope-safe `useNode(...)`, `useNodes(...)`, and `useQuery(...)`
- Explicit or injected runtime resolution
- Pinia-owned runtime integration without mirrored graph state
- Browser lifecycle timer environment
- Runtime shutdown tied to the owning application or store

See [Vue and Pinia integration](./architecture/07-vue-and-pinia-integration.md).

### Transactions, events, and queries

- Independent top-level transaction sessions
- Explicit same-session composition through `transaction.transaction(...)`
- Generation-based context conflict detection
- Typed immediate, transaction-owned, and mutation-success event publication
- Immutable query groups reused for prefetch, subscription, aggregate state, and refresh

See [ADR-005](./decisions/ADR-005-atomic-graph-transactions.md), [ADR-006](./decisions/ADR-006-domain-events.md), and the [Public API](./api/01-public-api.md).

### Refresh, polling, and cache lifecycle

- Stale-after, fixed-interval, and poll-until policies
- Bounded retry, backoff, jitter, pause, and resume
- Subscription-owned policy activity
- Per-node and runtime-default automatic value release
- Explicit `release: Infinity` opt-out
- Runtime disposal of background policies and lifecycle listeners
- Retention and garbage-collection regression coverage

Cache lifecycle is complete against its exit criterion: unused graph data can be released automatically, and retention tests verify cleanup of values, attempts, subscriptions, timers, listeners, mutation state, and transaction state.

See [Events, refresh policies, and polling](./architecture/04-events-refresh-and-polling.md), [ADR-012](./decisions/ADR-012-refresh-policies-and-polling.md), and [ADR-016](./decisions/ADR-016-value-release-policies.md).

### Mutations

- Typed caller-owned remote commands
- Atomic confirmed-success reconciliation
- Explicit invalidation and typed event publication
- Guarded optimistic updates
- Known rejection, unknown outcome, rollback conflict, and reconciliation-failure handling
- Monotonic rollback generations
- Protection against overwriting newer graph work

See [Mutations, failures, and cache behaviour](./architecture/05-mutations-failures-and-cache.md), [ADR-013](./decisions/ADR-013-mutation-framework.md), and the [user guide's mutations section](./guides/00-user-guide.md#12-mutations).

### Diagnostics and devtools

- Optional structured diagnostic events with runtime-local causality
- Bounded in-memory collection and cumulative metrics
- Safe versioned snapshots with explicit value inclusion or redaction
- Stable diagnostic normalisation
- Pure devtools protocol transforms
- Embeddable graph, node, timeline, and metrics views
- Snapshot export and offline inspection

See [Observability, devtools, and snapshots](./architecture/06-observability-devtools-and-snapshots.md), [ADR-014](./decisions/ADR-014-runtime-observability.md), and [ADR-015](./decisions/ADR-015-devtools-inspector-protocol.md).

## Active objective: Existing-application migration trial

The next active objective is to prove the framework in one bounded production-shaped workflow before broader adoption.

### Scope

- Select one workflow with multiple data dependencies, existing behavioural coverage, low operational risk, and clear request-count expectations.
- Inventory its context, data, derived state, manual loading, invalidation, mutations, errors, subscriptions, and cross-domain interactions.
- Map the workflow to typed graph definitions and one runtime ownership model.
- Compare API request counts, loading order, time to useful data, cancellation, and stale-data behaviour.
- Validate initial failure, refresh failure, retry, unmount, context switching, and overlapping work.
- Validate transaction, event, query, mutation, polling, and release behaviour only where the chosen workflow requires them.
- Confirm diagnostics provide enough evidence to explain loading, invalidation, failure, abort, discard, and recovery.
- Document compatibility gaps, operational risks, adoption guidance, and a practical rollback path.

### Exit criteria

The migration trial is complete when:

- One production-shaped workflow runs successfully using the graph framework.
- Existing observable behaviour is preserved or intentionally improved.
- Request-count and loading-order differences are measured and understood.
- Failure, stale-data, cancellation, and cleanup behaviour are validated.
- Diagnostics are sufficient to support investigation without adding ad hoc console logging.
- Integration risks, compatibility findings, and rollback steps are documented.
- The trial produces a clear recommendation to adopt, revise, or stop.

## Documentation follow-up

The caching guidance is complete in [Recipe 10 — Reference data and cache budgets](./recipes/10-reference-data-and-cache-budgets.md): retained reference lists, large values with per-node/runtime release durations, application-managed keyed maps, and selecting durations from value size, reload cost and navigation patterns. Validate the chosen policies in the application migration trial.

## Deferred until demonstrated necessary

### SSR hydration and server prefetch

Revisit when a concrete server-rendered consumer requires cache transfer or pre-render execution semantics.

### Persistent cache restoration

Revisit when an application requires values to survive runtime or browser-session recreation. Diagnostic snapshots are not a persistence format.

### Cross-tab synchronisation

Revisit when one application must propagate invalidation or cache state between browser contexts. Typed runtime events remain local and non-durable.

### Async derived nodes

Revisit when a synchronous derivation cannot represent a real use case. Asynchronous work currently belongs in data nodes so it uses the standard loading, cancellation, failure, and diagnostic model. See [ADR-002](./decisions/ADR-002-key-decisions.md).

### Durable or distributed event transport

Revisit when a consumer requires server delivery, replay, cross-process transport, or exactly-once semantics. External transports currently validate and map messages into local runtime publication. See [ADR-006](./decisions/ADR-006-domain-events.md).

### Offline mutation queue

Revisit when a consumer has explicit offline command, retry, idempotency, ordering, and conflict requirements. See [ADR-013](./decisions/ADR-013-mutation-framework.md).

### Runtime extension host

Revisit when a third policy with materially different needs is implemented, an external policy is required, or measured policy reconciliation cost justifies a host. See [ADR-017](./decisions/ADR-017-runtime-extension-host-deferred.md).

### Count-bounded or LRU release policy

Revisit if timer-based value release does not provide sufficient memory control for real application data. See [ADR-016](./decisions/ADR-016-value-release-policies.md) and [ADR-017](./decisions/ADR-017-runtime-extension-host-deferred.md).

### Explicit scheduler debounce

Revisit if real application invalidation storms require deliberate same-node coalescing. It must be an explicit policy rather than an accidental consequence of serialized scheduler flushes. See [ADR-019](./decisions/ADR-019-overlapping-scheduler-flushes.md).
