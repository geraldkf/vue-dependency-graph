# Test Strategy

## Principles

- Test observable behaviour rather than private implementation details.
- Use deterministic clocks, schedulers, and loaders.
- Avoid real network calls.
- Verify request ordering only where dependency behaviour requires it.
- Exercise public APIs wherever practical.
- Keep core tests independent of Vue.
- Keep tests in one package while preserving logical test areas.

## Suggested test layout

```text
tests/
├── core/
├── vue/
├── devtools/
├── playground/
└── types/
```

Co-located tests are also acceptable if one convention is used consistently.

## Core boundary test

Add a static boundary test or tooling rule that fails when `src/core` imports from:

- `src/vue`
- `src/devtools`
- `src/playground`
- `vue`
- `pinia`

The first bootstrap milestone may use a simple deterministic source scan. A dedicated boundary tool should only be added later if the simple approach becomes insufficient.

## Core unit tests

### Registry

- Any subscription order
- Duplicate keys
- Missing dependencies
- Cycles
- Diamond graph indexing

### Scheduler

- Automatic execution from subscription
- Coalesced synchronous changes
- Independent concurrency
- In-flight deduplication
- Concurrency limit:
  - Runtime-wide maximum across explicit, scheduler, prefetch, and refresh work
  - FIFO admission
  - Queued abort before loader invocation
  - Slot release after loader settlement
  - Unlimited default
  - Derived nodes do not consume slots
  - Limits remain isolated between runtime instances
- No-progress detection

### Context and transactions

- Single changes
- Multi-context atomic commit
- Nested transaction
- Rollback on callback failure
- One invalidation and execution pass

### Races and cancellation

- Old generation result discarded
- Aborted execution does not become business error
- API ignoring abort still cannot overwrite newer data

### Failures

- Initial load failure
- Refresh failure with stale data
- Parent failure blocks descendants
- Independent branch continues
- Retry matching and exhaustion

### Events

- Payload typing compile tests
- Conditional invalidation
- Event publication inside transaction
- No cross-store reference required

### Polling

Use fake timers.

- No overlapping requests
- Completion
- Failure condition
- Timeout
- Backoff and jitter bounds
- Subscription removal cleanup

### Atomic transactions

Use deferred promises and public runtime behaviour.

Verify:

- Committed reads while a transaction is open
- Final-value reconciliation and reverted no-ops
- Nested success, propagated failure, and caught inner failure
- Shared and diamond descendants invalidate once
- Generation changes and aborts occur at commit
- Synchronous and asynchronous rollback
- Independent execution remains committed across rollback
- Transaction-time settlement on commit and rollback
- Completion before commit is preserved as stale data
- Ignored-abort completion after commit remains obsolete
- Execute, prefetch, and refresh guards
- Playground observers never receive partial related context values
- Playground transaction progress remains explicitly local and separate from committed runtime state
- Playground rollback displays a caller-visible outcome and error without graph notification

Keep transaction integration coverage grouped by behaviour: staging, invalidation, rollback, settlement, execution races, and overlapping transaction calls. Prefer adding a test to the narrowest matching suite rather than rebuilding one broad transaction file.

### Typed event publication

Event tests cover payload typing, declaration validation, deterministic graph indexing, conditional matching, atomic predicate failure, direct and descendant invalidation, stale-data retention, unrelated branches, scheduler reload, shared-descendant deduplication, generation-before-abort ordering, and ignored-abort protection. Transaction coverage includes staged visibility, rollback, final-context predicate matching, combined invalidation deduplication, publication order, predicate-failure atomicity, explicit nested composition, isolated overlapping sessions, conflict handling, and scheduler-specific settlement. Mutation coverage verifies success-only publication, direct-update overlays, and rejection of affected-derived predicate reads without partial success effects.

### Mutations

Mutation tests exercise the public `runtime.mutate(...)` entry point and verify observable behaviour rather than private coordination calls. Coverage includes:

- typed definition, input, and result inference;
- independent remote attempts and exact input and signal mapping;
- atomic confirmed-success updates, invalidation, and event publication;
- successful-value preconditions, duplicate-target rejection, callback lifetime, and asynchronous-effect rejection;
- pure replacement updaters and development/test protection against nested in-place writes;
- no-op updates and one notification with at most one scheduler request per local commit;
- immediate optimistic visibility and subscribed descendant execution;
- same-node optimistic ownership conflicts and disjoint mutation concurrency;
- known-rejection rollback with monotonic generations and generation-before-abort ordering;
- rollback scheduling for restored stale subscribed state;
- rollback conflicts when newer graph or settled descendant work exists;
- unknown outcome retention and authoritative reconciliation;
- confirmed remote success followed by local reconciliation failure;
- success-only typed event publication, direct-update predicate overlays, and affected-derived read restrictions;
- independence from graph transactions and from the data-load concurrency budget;
- ownership release after every terminal settlement path;
- immutable, sorted public error metadata and preserved causes.

Keep runtime-level behavioural suites as the primary specification for the update planner, optimistic-session manager, mutation committer, settlement coordinator, and runtime-facing controller. Static decomposition tests should protect private exports, acyclic dependency direction, and single-controller runtime wiring without coupling tests to internal delegation details.

### Diagnostics and devtools

Diagnostics tests verify observable event and snapshot contracts rather than private emitter calls. Coverage includes:

- diagnostics disabled when no sink is supplied;
- immutable runtime-local sequence, operation, and cause identifiers;
- caller intent and node-execution causality across scheduler, event, transaction, policy, mutation, and release paths;
- sink failure isolation without changes to runtime state or operation results;
- listener failure isolation and `runtime.listener-failed` attribution;
- bounded event retention, dropped-event counts, and cumulative metrics independent of eviction;
- safe snapshot construction with values omitted by default;
- explicit inclusion, typed redaction, unsupported values, cycles, and redactor failure;
- bounded safe error serialisation;
- pure, immutable, idempotent normalisation with stable identifier aliasing;
- deterministic graph, node, timeline, and metrics protocol transforms;
- stable dependency-depth graph layout and event lanes;
- live panel updates, selection, snapshot export, invalid import errors, offline inspection, and return to live mode;
- the requirement that a live panel receives the same in-memory collector configured as the runtime sink.

Use deterministic diagnostic environments in tests. Assert functional fields and causal relationships rather than real timestamps or incidental runtime identifiers.

- State transitions: `tests/core/state-transitions.spec.ts` pins the exact field and generation effect of each transition and checks that every transition maps every valid state to a valid state
- State write rule: `tests/core/state-types.test.ts` asserts with `@ts-expect-error` that every node-state field, compound assignment, and `generation++` is rejected outside the transitions (checked by `pnpm typecheck`, like the other `*.types.test.ts` files). `pnpm check:boundaries` fails on a writable mapped type outside `state/transitions.ts` and on a transitions import from a module not on its allowlist
- State traces: `tests/core/runtime-state-trace.spec.ts` snapshots every observable change to node `status`, `freshness`, `generation`, `hasSuccessfulValue`, `error`, and `data`, per change notification, for scenarios that reach each transition (load, failure and recovery, refresh after failure, context, event, and transaction invalidation, mutation success, unknown and rejected failure, release, retry exhaustion, polling timeout, abort while loading or refreshing, cancellation while queued, and supersession by an invalidation or a mutation write), and fails on any state-invariant violation. Diagnostics traces cannot see these fields
- Coordination module: `tests/core/graph-coordination.spec.ts` builds execution, scheduler, subscriptions, and invalidation without a runtime and pins the two backward edges (changed refresh result -> descendant invalidation; scheduler flushes only directly subscribed nodes), scheduler-cause attribution through the shared tracker, and abort of automatic-only work on last unsubscribe
- Golden trace: `tests/core/runtime-golden-trace.spec.ts` snapshots the whole normalised diagnostic stream of one scenario that covers every execution reason (subscription, context invalidation, changed result, refresh policy, explicit, prefetch, refresh, query variants, dependency), transactions, mutations, and the release policy. Structural refactors of the runtime composition must leave it unchanged; a diff means event order, content, or attribution moved. Operation ids are normalised, so it pins how events group and cause each other rather than literal id values.

## Scheduler overlap tests

`tests/core/scheduler-overlap.spec.ts` (34 tests) pins that scheduler flushes no longer block one another (ADR-019): independent work is never held up by a slow load; work is never started twice; invalidation, supersession, and abort races resolve correctly, for loaders that honour their abort signal and ones that ignore it; `whenSettled` and `getSchedulerState()` behave correctly across overlapping flushes, including which flush's error is reported; each flush's diagnostic attribution stays separate from every other's, including under reentrancy and storms of rapid scheduling. A companion unit test on `scheduler-diagnostics.ts` directly checks that attribution does not leak from one flush into the next. Loaders are driven by hand (no wall-clock waits), so every interleaving is exact and repeatable.

## Retention and cleanup tests

`tests/retention` checks that the runtime lets go of what it is finished with. Vitest workers start with `--expose-gc` (see `vitest.config.ts`) and the helpers fail if `gc` is missing rather than skipping.

- **Garbage collection** (`garbage-collection.spec.ts`): holds only a `WeakRef` to a value the runtime saw, lets the runtime move on, forces collection, and expects the value gone. Covers values freed by a release policy, values replaced by a refresh or a recomputation (with and without diagnostics), event payloads, the late result of an aborted or superseded attempt, optimistic, rolled-back and replaced mutation values, discarded and replaced transaction values, and a whole runtime once it is disposed - through the browser timer environment, a Vue app unmount, and a Pinia instance disposal. Values the runtime is meant to keep (the current value) are asserted as retained, and a harness check proves collection is neither too eager nor too lazy. Undisposed browser-environment runtimes stay reachable from document listeners, which is asserted as the reason owners must dispose.
- **Structural cleanup** (`runtime-cleanup.spec.ts`): after a thousand subscribe, change, and unsubscribe cycles the runtime has no subscriptions, timers, or running work; unsubscribing is idempotent; policy timers are cleared and re-armed correctly and never accumulate; change listeners are really removed; the browser environment's listeners are balanced across creation and disposal; diagnostics stay within capacity; Vue components release their subscriptions across many mounts.
- **Attempt cleanup** (`attempt-cleanup.spec.ts`): the active attempt table empties after success, failure, abort, supersession, and cancellation while queued; concurrency slots are not lost; a loader that ignores its abort signal and never settles cannot stall the runtime (ADR-018), leaves one terminal event, and never causes an unhandled rejection.

Every check in these suites was confirmed to fail when the cleanup it covers is removed or a leak is deliberately injected.

## Vue and Pinia integration tests

Use Vitest 3.0.7, Vue Testing Library, and real deterministic graph runtimes.

Verify:

- Mount creates graph subscription ownership
- Unmount releases subscription ownership
- Two consumers share one load
- Reactive status and data changes
- `useNodes` tuple typing and runtime values
- `defineQuery(...)` alias and exact node-handle typing
- `useQuery(...)` aliased result typing and aggregate runtime values
- One combined query subscription and cleanup on scope disposal
- Query prefetch without persistent subscription ownership
- Query refresh forwarding only data and derived members
- Query Groups playground fresh-prefetch reuse and tab cleanup
- Aggregate partial failure and retained successful data
- Explicit runtime precedence over injection
- One stable runtime per Pinia instance
- Independent runtimes across separate Pinia instances
- Components can use a Pinia-owned runtime without the graph runtime plugin
- Scenario tab changes release the previous scope's subscriptions
- Transaction playground controls are enabled only during valid phases
- Unrelated context and event work becomes observable before transaction closure
- Unrelated work survives staged transaction rollback
- Same-context conflict preserves immediate state and exposes no partial staged snapshot
- Scenario reset restores isolation, conflict, request-count, and outcome state deterministically
- No consumer `loadData()` call

Use a real `createPinia()` instance and the real dependency graph store for Pinia integration tests. Do not install the graph runtime plugin in those tests. Prefer direct deterministic instances over broad module mocking.

Compile-time `.test.ts` files are checked by `vue-tsc` and excluded from Vitest. Register Vue Testing Library cleanup globally. Use fake timers only for deterministic playground delays, not for graph execution ordering.

## Refresh policy tests

Policy-definition coverage verifies immutable descriptors, normalised defaults, invalid configuration, data-node integration, and defensive graph validation. Compile-time coverage verifies polling value types and confirms context and derived nodes reject refresh metadata.

Timer and polling tests must use an injected deterministic environment rather than real delays.

### Stale-after runtime coverage

Stale-after coverage verifies timer creation, duration expiry, remaining age after resubscription, timer cleanup, automatic-only cancellation, and shared manual-refresh ownership.

### Fixed-interval runtime coverage

Fixed-interval coverage verifies repeated settled refresh, non-overlap during slow loads, full-delay restart after settlement and resubscription, context-invalidation restart, timer cleanup, and isolation between runtimes.

### Poll-until runtime coverage

Poll-until coverage verifies intermediate progress, completion, business failure, failure-before-completion ordering, timeout, predicate exceptions, generation changes, obsolete-result protection, retained successful data, and final-unsubscribe cleanup.

### Retry and lifecycle coverage

Retry and lifecycle coverage uses deterministic clock and random sources to verify fixed and exponential delay calculation, jitter bounds, retry reset and exhaustion, timer preservation during pause, coalesced resume, suppression of paused requests, and active-time polling timeout. Browser adapter tests cover visibility, network state, options, and listener cleanup.

### Polling Progress playground coverage

The Polling Progress playground uses Vue Testing Library with deterministic virtual time. Tests cover progress, non-overlap metrics, completion, retained-data failure, timeout, retry delay, pause and resume, unmount timer cleanup, reset, and shell tab mounting.

## Compile-time type tests

Add a type-test mechanism to verify:

- Node result inference
- Query alias and node-map inference
- Query operation argument and result types
- Context set value type
- Event payload type
- Query alias result type
- Invalid node usage fails compilation

## Mutation testing

Mutation tests treat remote execution and local graph effects as separate phases.

Core behavioural coverage uses deferred promises and deterministic outcomes for:

- typed mutation execution and runtime isolation;
- atomic direct reconciliation across multiple data nodes;
- success invalidation and typed event publication;
- optimistic visibility before request settlement;
- exact logical snapshot restoration after known rejection with monotonic generations;
- ignored-abort completion remaining obsolete after rollback;
- multi-node target and descendant generations advancing once during rollback;
- rollback scheduling for stale subscribed snapshots;
- no rollback scheduling for fresh or unsubscribed snapshots;
- one scheduler pass for multiple or shared restored graph paths;
- `whenSettled()` including rollback-triggered authoritative work;
- subscribed data descendant reload before mutation settlement;
- descendant success remaining intact after command success;
- changed descendant completion producing a guarded rollback conflict;
- active ignored-abort descendant work remaining obsolete after rollback;
- mutation execution remaining independent from the data-load concurrency limiter;
- rejection of affected-derived reads in mutation event predicates;
- no partial update, explicit invalidation, event invalidation, or notification after prohibited reads;
- optimistic reconciliation recovery after prohibited reads;
- unaffected derived predicate reads remaining supported;
- direct data overlay predicate reads remaining supported;
- unchanged runtime and transaction event predicate behaviour;
- immutable array and object updater replacements;
- rejection of direct and nested in-place updater writes;
- no partial optimistic or success effect when purity validation fails;
- no protected development proxy retained in committed replacement values;
- documented immutable replacement behaviour for non-plain values;
- optimistic remote success followed by callback, updater, target, and asynchronous-effect failure;
- stale retention and ownership release after reconciliation failure;
- immutable sorted reconciliation error metadata and preserved local cause;
- subscribed authoritative reload after reconciliation failure;
- no partial success update, invalidation, or event publication;
- unknown outcome retention and authoritative reconciliation;
- same-node optimistic overlap rejection;
- disjoint mutation concurrency;
- generation-protected rollback conflicts;
- active-load abort and ignored-abort races;
- transaction ownership boundaries;
- one notification and at most one scheduler pass per local mutation commit.

Compile-time tests verify mutation input/result inference, data-node-only direct updates, refreshable invalidation targets, and typed event payloads. Vue Testing Library coverage exercises the deterministic Optimistic Appointment Booking playground through success, known rejection, unknown outcome, overlap, reset, and unmount paths.

Tests must not use real network requests, real delays, or framework-inferred HTTP semantics. Known rejection versus unknown outcome is supplied explicitly by the test classifier.

## Combined validation responsibility

Before release or history deletion, validate the exact combined checkout with boundary checks, strict typechecking, the complete Vitest suite, and the production build. Timer and polling behaviour must remain deterministic in automated tests; manual playground checks supplement but do not replace those suites.
