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

- Any registration order
- Duplicate keys
- Missing dependencies
- Cycles
- Diamond graph indexing

### Scheduler

- Automatic execution from demand
- Coalesced synchronous changes
- Independent concurrency
- In-flight deduplication
- Concurrency limit
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
- Demand removal cleanup

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

## Vue integration tests

Use Vitest 3.0.7 and Vue Testing Library.

Verify:

- Mount creates demand
- Unmount releases demand
- Two consumers share one load
- Reactive status and data changes
- `useNodes` alias typing and runtime values
- Query aggregate partial failure
- No consumer `loadData()` call

Prefer direct deterministic core instances over broad module mocking.

## Compile-time type tests

Add a type-test mechanism to verify:

- Node result inference
- Context set value type
- Event payload type
- Query alias result type
- Invalid node usage fails compilation

## Offline validation responsibility

The contained environment creates tests but does not claim they pass unless it actually ran them successfully. The developer runs the required commands offline and reports results. Test-related roadmap items remain in `Validation pending` state until that feedback is received.
