## Milestone 10: Runtime Observability Plan

### Status

Approved for sequential implementation. Planning and documentation are complete. Runtime implementation has not started.

Milestone 9 and Milestone 9H combined offline validation were reported successful by the project owner on 15 September 2026. Milestone 10 may therefore proceed from the validated mutation lifecycle seams.

### Objective

Add a framework-agnostic observability layer that explains runtime behaviour without changing that behaviour.

Milestone 10 will provide:

- one structured diagnostic event stream;
- deterministic runtime-local identifiers and causation links;
- traceable load and invalidation reasons;
- a bounded in-memory collector;
- metrics projected from the diagnostic stream;
- a versioned diagnostic snapshot with safe value handling;
- a stable snapshot normaliser for tests;
- one deterministic playground scenario.

The exit criterion is that a developer can trace every node execution back to the subscription, invalidation, refresh policy, transaction, event, mutation, prefetch, refresh, or explicit execution that caused it.

### Constraints inherited from the current architecture

- `src/core` remains framework-agnostic and must not import Vue, browser APIs, devtools UI, or playground code.
- Existing runtime state, notification, scheduling, settlement, cancellation, and transaction semantics remain authoritative.
- Diagnostics observe committed lifecycle boundaries. They do not become a second state machine.
- Diagnostics must not keep graph work alive, delay scheduler settlement, or participate in transaction rollback.
- A failing diagnostic sink must not fail or alter the graph operation being observed.
- The default runtime has no collector allocation and no retained diagnostic history unless diagnostics are configured.
- Public runtime state snapshots remain unchanged. Diagnostic snapshots are a separate versioned representation.
- Node values are omitted by default. Value inclusion requires explicit node-level diagnostic configuration.
- Existing internal mutation lifecycle seams are instrumentation points, not new public mutation hooks.

### Design decisions

The accepted architecture is recorded in `docs/decisions/ADR-014-runtime-observability.md`.

#### One event stream

Diagnostics and metrics use one structured event stream. Metrics are reduced from diagnostic events rather than maintained by separate counters at every runtime call site. This prevents two observability models from drifting.

#### Runtime-local sequence identifiers

Every emitted event receives a monotonically increasing runtime-local sequence number. Operations that span multiple events receive a runtime-local operation identifier. Child work records a `causeId` that points to the operation or event that caused it.

Identifiers are deterministic within one runtime and suitable for tests. They are not promised to be globally unique across runtimes, browser tabs, processes, or application sessions.

#### Synchronous and failure-isolated emission

Emission occurs synchronously after the relevant committed transition, or immediately before an externally meaningful attempt begins when a start event is required. The sink is called through one failure-isolating diagnostic emitter. Sink exceptions are ignored by core runtime behaviour.

The emitter must not use the graph observer, transaction notification buffer, scheduler, or `whenSettled()` path.

#### Immutable public records

Public diagnostic records and snapshots are immutable. Payload fields use stable node keys, mutation keys, event keys, operation IDs, and serialisable primitives or frozen arrays. Internal mutable runtime records are never exposed.

#### Bounded retention

The in-memory collector requires an explicit positive capacity and retains the newest records in insertion order. Dropped-record count is reported so consumers know history is incomplete.

#### Safe snapshot values

Diagnostic snapshots omit node values by default. A node may explicitly opt in to value inclusion or provide a redactor. Redactor failure produces an omitted value with a redaction error marker rather than failing snapshot creation.

### Proposed public API shape

The exact exported names are confirmed in M10A compile-time tests before implementation. The target shape is:

```ts
interface GraphDiagnosticsOptions {
  readonly sink?: GraphDiagnosticSink;
}

interface GraphDiagnosticSink {
  readonly emit: (event: GraphDiagnosticEvent) => void;
}

const runtime = createGraphRuntime(graph, {
  diagnostics: {
    sink,
  },
});
```

The runtime will expose snapshot creation only after the snapshot contract is implemented:

```ts
const snapshot = runtime.createDiagnosticSnapshot();
```

The bounded collector is a reusable optional consumer:

```ts
const diagnostics = createInMemoryGraphDiagnostics({ capacity: 500 });
const runtime = createGraphRuntime(graph, {
  diagnostics: { sink: diagnostics },
});

const events = diagnostics.getEvents();
const metrics = diagnostics.getMetrics();
```

Node-level value policy is planned as immutable definition metadata:

```ts
diagnostics: {
  value: "omit",
}
```

Supported first-release modes are:

- `"omit"`, the default;
- `"include"`, explicit full inclusion;
- a synchronous redactor returning a serialisable diagnostic value.

The final syntax will be selected in M10E with compile-time tests. It must not weaken node value typing or require serialisability for ordinary runtime values.

### Diagnostic event envelope

Every event shares a stable envelope:

```ts
interface GraphDiagnosticEventBase {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly timestamp: number;
  readonly runtimeId: string;
  readonly type: string;
  readonly operationId?: string;
  readonly causeId?: string;
}
```

`timestamp` comes from an injectable diagnostics clock when configured and otherwise uses the platform clock. Tests must not depend on wall-clock time.

The initial event union is grouped by lifecycle rather than by source file.

#### Subscription events

- `subscription.added`
- `subscription.removed`

Fields include direct target keys and the affected direct and required ownership counts after commit.

#### Scheduling events

- `scheduler.requested`
- `scheduler.started`
- `scheduler.completed`
- `scheduler.failed`

Fields include selected target keys, follow-up status where meaningful, and serialised scheduler failure details.

#### Operation events

- `operation.execute.requested`
- `operation.prefetch.requested`
- `operation.refresh.requested`
- `operation.query-prefetch.requested`
- `operation.query-refresh.requested`

Fields include requested node keys and an operation ID. Query wrappers should identify the query key while retaining the resolved node keys.

#### Node execution events

- `node.load.queued`
- `node.load.started`
- `node.load.succeeded`
- `node.load.failed`
- `node.load.aborted`
- `node.load.discarded`
- `node.derive.started`
- `node.derive.succeeded`
- `node.derive.failed`
- `node.execution.reused`
- `node.execution.skipped`

Fields include node key, node kind, generation, execution origin, reason, duration where applicable, and operation or cause linkage.

`queued` is emitted only when a data load actually waits for concurrency capacity. It must not be inferred from promise timing.

`reused` means an active same-generation attempt was shared. `skipped` means a fresh successful value avoided work. These are distinct for diagnostics and metrics.

#### Invalidation events

- `context.changed`
- `node.invalidated`
- `event.published`
- `event.matched`

Fields include source kind, source key, directly affected roots, transitive affected keys, generation changes, and whether subscribed work was requested.

One logical invalidation commit emits one summary event rather than one event per mutable field. Node-level detail is represented by immutable key arrays in the summary.

#### Transaction events

- `transaction.started`
- `transaction.joined`
- `transaction.committed`
- `transaction.rolled-back`
- `transaction.conflicted`

Fields include transaction operation ID, staged context keys, publication count, affected node keys, duration, and serialised error or conflict keys where applicable.

Joined transaction calls share the root transaction operation ID. No diagnostic event exposes staged values.

#### Refresh-policy events

- `refresh-policy.scheduled`
- `refresh-policy.started`
- `refresh-policy.retry-scheduled`
- `refresh-policy.paused`
- `refresh-policy.resumed`
- `refresh-policy.completed`
- `refresh-policy.failed`
- `refresh-policy.timed-out`
- `refresh-policy.stopped`

Fields include node key, policy kind, attempt number, scheduled delay, elapsed active time where meaningful, and stop reason.

#### Mutation events

- `mutation.started`
- `mutation.optimistic-committed`
- `mutation.remote-started`
- `mutation.remote-succeeded`
- `mutation.remote-failed`
- `mutation.success-committed`
- `mutation.rolled-back`
- `mutation.rollback-conflicted`
- `mutation.outcome-unknown`
- `mutation.reconciliation-failed`
- `mutation.completed`

Fields include mutation key, operation ID, affected node keys, duration, outcome, and serialised error details. Mutation input and result values are not included.

### Execution reason model

Every node execution start carries one reason:

```ts
type GraphExecutionReason =
  | "explicit"
  | "subscription"
  | "prefetch"
  | "refresh"
  | "query-prefetch"
  | "query-refresh"
  | "context-invalidation"
  | "event-invalidation"
  | "transaction-commit"
  | "refresh-policy"
  | "mutation-optimistic"
  | "mutation-success"
  | "mutation-reconciliation"
  | "dependency";
```

The reason describes why this node needed work. The existing execution origin continues to describe who owns the attempt. These concepts must not be collapsed because a scheduler-owned attempt can have a context, event, transaction, mutation, or subscription cause.

When an execution is required only as an ancestor of another node, it uses `dependency` and links to the requesting child operation through `causeId`.

### Metrics model

The in-memory collector projects metrics from retained and cumulative event processing. Its metrics snapshot includes:

- operation counts by operation kind;
- node attempt counts by node key and outcome;
- load and derive durations;
- active and maximum observed data loads;
- concurrency queue count and wait duration;
- fresh-value skip and active-attempt reuse counts;
- invalidation counts by source kind;
- scheduler pass, failure, and follow-up counts;
- refresh-policy attempt, retry, completion, failure, timeout, pause, and active-duration counts;
- transaction started, committed, rolled-back, conflicted, and duration values;
- mutation started and terminal outcome counts;
- current direct and required subscription totals where derivable;
- dropped diagnostic record count.

Metrics must remain meaningful when event retention has dropped older records. Cumulative counters are therefore updated as events arrive and are not recalculated solely from the retained event ring.

Percentiles, histograms, aggregation windows, telemetry export formats, and cross-runtime aggregation are deferred.

### Diagnostic snapshot schema

The first schema version contains:

```ts
interface GraphDiagnosticSnapshotV1 {
  readonly schemaVersion: 1;
  readonly createdAt: number;
  readonly runtimeId: string;
  readonly topology: readonly DiagnosticNodeDefinition[];
  readonly nodes: readonly DiagnosticNodeState[];
  readonly scheduler: DiagnosticSchedulerState;
  readonly subscriptions: readonly DiagnosticSubscriptionState[];
  readonly refreshPolicies: readonly DiagnosticRefreshPolicyState[];
  readonly metrics?: GraphMetricsSnapshot;
  readonly diagnostics: {
    readonly retainedEventCount: number;
    readonly droppedEventCount: number;
  };
}
```

Topology ordering follows graph registration order. Child collections used for deterministic inspection use existing graph ordering. Runtime state entries use graph registration order.

Snapshot values are omitted unless allowed by node metadata. Errors are converted to a safe serialisable shape containing name and message, with optional cause depth bounded to prevent cycles and unbounded output. Stack traces are omitted by default.

Snapshots are diagnostic exports only. Importing a snapshot into live runtime state is not part of Milestone 10.

### Stable snapshot normaliser

The normaliser supports deterministic assertions and offline comparison. It removes or replaces volatile fields such as:

- timestamps;
- runtime IDs;
- operation IDs;
- cause IDs where the caller chooses structural comparison;
- duration values.

It preserves sequence order, event types, keys, outcomes, generations, state, redaction markers, and metrics counts.

The normaliser returns a new immutable object and never mutates the source snapshot or events.

### Delivery sequence

Each step starts from the previous validated cumulative checkout. Do not combine steps unless a dependency makes separate compilation impossible.

#### M10A: Diagnostic foundation

Status: Implemented and statically reviewed. Dependency-backed repository validation pending. See `docs/implementation/111-milestone-10a-diagnostic-foundation-note.md`.

Deliver:

- `GraphDiagnosticEvent` envelope and initial discriminated union contracts;
- diagnostic sink and optional runtime configuration;
- central failure-isolating emitter;
- injectable clock;
- deterministic runtime, operation, and sequence identifiers;
- no-op behaviour when diagnostics are omitted;
- ADR and public API draft updates.

Instrumentation scope is intentionally narrow in this step. Emit only runtime-created and explicit-operation-requested events required to validate the foundation.

Tests:

- diagnostics omitted produces no retained history or behaviour change;
- sink receives immutable records in sequence order;
- separate runtimes have independent deterministic counters;
- sink exceptions do not alter operation results or state;
- injected clock controls timestamps;
- public option typing and exact optional-property behaviour;
- internal emitter is not exported.

Exit criteria:

- one runtime-local emitter exists;
- no capability invokes a sink directly;
- existing runtime behaviour and public state remain unchanged.

#### M10B: Core execution causality

Status: Implemented and statically reviewed. Dependency-backed repository validation pending. See `docs/implementation/112-milestone-10b-core-execution-causality-note.md`.

Deliver instrumentation for:

- subscriptions;
- scheduler requests and passes;
- explicit execute, prefetch, refresh, and query operations;
- execution planning, active-attempt reuse, fresh-value skip, queueing, start, success, direct failure, abort, discard, and derived evaluation;
- context and changed-result invalidation;
- operation and cause propagation through dependency execution.

Tests:

- one subscribed node trace from subscription to scheduler to load success;
- context change trace through invalidation and reload;
- explicit, prefetch, refresh, query, and dependency reasons;
- active attempt sharing versus fresh skip;
- concurrency queue wait and abort-before-admission;
- ignored-abort discarded result;
- branch failure and blocked descendant trace;
- stable event ordering around existing observer notifications.

Exit criteria:

- every ordinary node execution has a reason, operation ID, and causal path;
- no additional load, notification, scheduler pass, or settlement delay occurs.

#### M10C: Advanced lifecycle diagnostics

Status: Implemented and statically reviewed. Dependency-backed repository validation pending. See `docs/implementation/113-milestone-10c-advanced-lifecycle-diagnostics-note.md`.

Deliver instrumentation for:

- immediate and transaction-owned typed events;
- transaction start, join, commit, rollback, and conflict;
- stale-after, interval, poll-until, retry, pause, resume, terminal failure, timeout, and unsubscribe stop;
- mutation optimistic start, remote attempt, success commit, exact rollback, rollback conflict, unknown outcome, and reconciliation failure.

Tests:

- transaction commit and rollback event ordering;
- plain runtime operations remain independently traced while a transaction is open;
- event predicate failure emits failure information without a false invalidation commit;
- polling completion, business failure, retry, timeout, pause/resume, and unsubscribe stop;
- mutation terminal outcome matrix;
- ownership release and graph transition happen before terminal diagnostic emission where required;
- mutation input, result, staged context values, and event payloads are absent from diagnostic records.

Exit criteria:

- every advanced lifecycle has one terminal outcome;
- diagnostics report the committed result without changing ownership or rollback semantics.

#### M10D: In-memory collector and metrics

Status: Implemented and statically reviewed. Dependency-backed repository validation pending. See `docs/implementation/114-milestone-10d-in-memory-diagnostics-metrics-note.md`.

Deliver:

- bounded `createInMemoryGraphDiagnostics(...)` collector;
- immutable retained event snapshots;
- capacity validation;
- newest-record retention and dropped-record count;
- cumulative metrics reducer;
- immutable metrics snapshots;
- reset behaviour that does not affect the runtime.

Tests:

- exact capacity and FIFO eviction;
- cumulative metrics remain correct after event eviction;
- reset clears collector state only;
- active and maximum concurrency metrics;
- duration calculations with deterministic clock;
- transaction, polling, mutation, invalidation, reuse, skip, failure, abort, and discard counters;
- collector can be shared deliberately or owned per runtime without changing runtime IDs.

Exit criteria:

- one collector can explain recent events and provide cumulative metrics without unbounded memory growth.

#### M10E: Snapshot schema and redaction

Status: Implemented and statically reviewed. Dependency-backed repository validation pending. See `docs/implementation/115-milestone-10e-diagnostic-snapshots-redaction-note.md`.

Deliver:

- node diagnostic value metadata and validation;
- versioned diagnostic snapshot creation;
- topology, node state, scheduler, subscription, refresh-policy, metrics, and collector summary sections;
- safe serialisation of errors;
- default value omission;
- explicit inclusion and custom redaction;
- redactor failure isolation;
- deterministic ordering.

Tests:

- sensitive values omitted by default;
- include and typed redactor paths;
- redactor exception does not fail the snapshot;
- cyclic or non-serialisable values cannot break snapshot creation;
- error cause cycles and depth are bounded;
- topology and node order are deterministic;
- snapshot creation performs no graph mutation, notification, scheduling, or diagnostics emission;
- compile-time typing for redactors.

Exit criteria:

- a snapshot is safe to export by default and complete enough for future devtools inspection.

#### M10F: Stable normaliser and regression suite

Deliver:

- public or testing-entry snapshot normaliser decision based on actual consumers;
- deterministic normalisation of timestamps, IDs, and durations;
- behavioural regression suites covering complete causal traces;
- architecture boundary checks preventing diagnostic dependencies from reversing layer direction.

Tests:

- independently created equivalent runtimes normalise identically;
- meaningful state, cause, outcome, and ordering changes remain visible;
- source snapshot remains unchanged and frozen;
- already normalised input is stable under repeated normalisation.

Exit criteria:

- deterministic tests can compare observability output without asserting volatile implementation details.

#### M10G: Observability playground

Deliver one deterministic `Runtime Observability` scenario using a dedicated runtime and collector.

The scenario demonstrates:

- mount subscription and initial load;
- context invalidation and reload;
- explicit refresh;
- one failed request and recovery;
- a transaction commit or rollback;
- a mutation outcome;
- recent event timeline;
- metrics summary;
- redacted snapshot preview and export.

The scenario must not introduce the Milestone 11 devtools protocol or inspector UI. It is an executable behavioural demonstration only.

Tests:

- deterministic event sequence for each control;
- metrics update from the same events;
- snapshot omits protected values;
- reset creates clean runtime, collector, IDs, and metrics;
- unmount and tab switch release subscriptions and timers.

Exit criteria:

- a contributor can reproduce and inspect one complete causal chain without console logging.

#### M10H: Documentation and final validation

Deliver:

- current public API documentation;
- architecture document reconciliation;
- test strategy additions;
- ADR status update;
- roadmap completion status;
- implementation summary and validation handoff;
- release-facing examples covering production sink integration and safe snapshots.

Validation commands:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Manual validation:

- run every Runtime Observability playground control;
- confirm event order and reason labels;
- confirm metrics match the visible actions;
- confirm snapshot values are omitted or redacted as configured;
- confirm reset and tab-switch cleanup;
- confirm no unexpected warnings or unhandled rejections.

Exit criteria:

- all repository commands pass against the combined checkout;
- manual playground validation passes;
- maintained documentation describes implemented behaviour only;
- Milestone 10 is marked complete only after reported validation.

### File and module direction

The expected core structure is:

```text
src/core/diagnostics/
  diagnostic-emitter.ts
  diagnostic-event.ts
  in-memory-diagnostics.ts
  metrics.ts
  snapshot.ts
  snapshot-normaliser.ts
  types.ts
```

Names may be adjusted during each focused step to match the concrete responsibility. Avoid a generic utilities module.

Allowed direction:

```text
runtime and core capabilities
  -> narrow diagnostic emitter contract
       -> configured sink

in-memory collector
  -> public diagnostic event contracts
  -> metrics reducer

snapshot builder
  -> graph and runtime inspection contracts
  -> node diagnostic metadata
  -> optional collector inspection
```

Prohibited direction:

- diagnostic modules importing Vue, playground, or devtools;
- state, scheduling, or execution depending on the in-memory collector;
- sink implementations calling private runtime mutation APIs;
- snapshot creation reaching into private capability closures through type assertions;
- diagnostics becoming required for ordinary runtime creation;
- devtools protocol types entering core during Milestone 10.

### Change-control rules

Each step must:

- make the smallest coherent change for that step;
- preserve existing public behaviour unless the plan explicitly adds a public diagnostics API;
- add behaviour-focused tests with the implementation;
- avoid refactoring unrelated runtime code;
- use existing capability seams rather than moving lifecycle ownership;
- update the plan if source evidence invalidates an assumption;
- produce a cumulative changed-files package;
- remain validation pending until offline results are reported.

Stop and revise the plan if:

- instrumentation requires changing transaction, mutation, polling, or scheduler semantics;
- a sink must be awaited for correctness;
- node values would be included without explicit opt-in;
- an event cannot be emitted without exposing mutable internal state;
- correlation requires globally unique identifiers rather than runtime-local deterministic IDs;
- metrics require a second independent lifecycle state machine.

### Deferred work

The following are not part of Milestone 10:

- graphical devtools;
- inspector transport protocol;
- snapshot import or live cache restoration;
- persistent diagnostic storage;
- OpenTelemetry or vendor-specific adapters;
- cross-tab or distributed trace correlation;
- server-generated correlation IDs;
- percentile and histogram aggregation;
- production sampling configuration;
- remote control of runtime operations;
- logging node values by default.

These remain candidates for Milestone 11 or later work after the event and snapshot contracts are proven.
