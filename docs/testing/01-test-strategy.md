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

Event tests cover payload typing, declaration validation, deterministic graph indexing, conditional matching, atomic predicate failure, direct and descendant invalidation, stale-data retention, unrelated branches, scheduler reload, shared-descendant deduplication, generation-before-abort ordering, and ignored-abort protection. M6D adds transaction coverage for staged visibility, rollback, final-context predicate matching, combined invalidation deduplication, publication order, predicate-failure atomicity, joined transactions, and scheduler settlement.

### Mutations

- Success invalidation
- Optimistic update
- Rollback
- Success reconciliation
- Event publication

### Diagnostics

- Load reason
- Bounded event history
- Redaction
- Stable snapshot normalisation

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

M8A adds behavioural coverage for immutable policy descriptors, normalized defaults, invalid configuration, data-node integration, and defensive graph validation. Compile-time coverage verifies polling value types and confirms context and derived nodes reject refresh metadata.

Later Milestone 8 timer and polling tests must use an injected deterministic environment rather than real delays.

### Stale-after runtime coverage

M8B uses an injected deterministic environment rather than real delays. Coverage verifies timer creation, duration expiry, remaining age after resubscription, timer cleanup, automatic-only cancellation, and shared manual-refresh ownership.

### Fixed-interval runtime coverage

M8C uses the injected deterministic environment to verify repeated settled refresh, non-overlap during slow loads, full-delay restart after settlement and resubscription, context-invalidation restart, timer cleanup, and isolation between runtimes.

### Poll-until runtime coverage

M8D uses the deterministic environment to verify intermediate progress, completion, business failure, failure-before-completion ordering, timeout, predicate exceptions, generation changes, obsolete-result protection, retained successful data, and final-unsubscribe cleanup.

### Retry and lifecycle coverage

M8E uses deterministic clock and random sources to verify fixed and exponential delay calculation, jitter bounds, retry reset and exhaustion, timer preservation during pause, coalesced resume, suppression of paused requests, and active-time polling timeout. Browser adapter tests cover visibility, network state, options, and listener cleanup.

### Polling Progress playground coverage

M8F uses Vue Testing Library against a deterministic virtual-time scenario. Tests cover progress, non-overlap metrics, completion, retained-data failure, timeout, retry delay, pause/resume, unmount timer cleanup, reset, and shell tab mounting.

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


## Offline validation responsibility

Milestone 8 validation is complete. The combined checkout passed boundary checks, strict typechecking, the complete Vitest suite, and the production build. The Polling Progress manual browser paths also passed. Future milestones must continue to report validation against the exact combined checkout.
