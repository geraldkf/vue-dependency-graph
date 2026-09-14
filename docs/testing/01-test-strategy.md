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
- Aggregate partial failure and retained successful data
- Explicit runtime precedence over injection
- One stable runtime per Pinia instance
- Independent runtimes across separate Pinia instances
- Components can use a Pinia-owned runtime without the graph runtime plugin
- Scenario tab changes release the previous scope's subscriptions
- No consumer `loadData()` call

Use a real `createPinia()` instance and the real dependency graph store for Pinia integration tests. Do not install the graph runtime plugin in those tests. Prefer direct deterministic instances over broad module mocking.

Compile-time `.test.ts` files are checked by `vue-tsc` and excluded from Vitest. Register Vue Testing Library cleanup globally. Use fake timers only for deterministic playground delays, not for graph execution ordering.

## Compile-time type tests

Add a type-test mechanism to verify:

- Node result inference
- Context set value type
- Event payload type
- Query alias result type
- Invalid node usage fails compilation

## Offline validation responsibility

The contained environment creates tests but does not claim they pass unless it actually ran them successfully. The developer runs the required commands offline and reports results. Test-related roadmap items remain in `Validation pending` state until that feedback is received.
