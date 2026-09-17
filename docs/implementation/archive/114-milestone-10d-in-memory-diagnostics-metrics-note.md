# Milestone 10D: In-Memory Diagnostics and Metrics

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10D adds one optional bounded in-memory diagnostic collector and projects cumulative metrics from the same structured event stream introduced in M10A through M10C.

No runtime capability depends on the collector. It is a reusable public sink that can be supplied through the existing runtime diagnostics option.

## Bounded event retention

`createInMemoryGraphDiagnostics({ capacity })` requires a positive integer capacity.

The collector:

- retains the newest events in insertion order;
- evicts exactly one oldest event when capacity is exceeded;
- records cumulative dropped-event count;
- returns immutable event-list snapshots;
- never mutates received diagnostic events.

Retention is intentionally independent from metrics reduction. Evicting a record does not reverse or recalculate a previously recorded metric.

## Metrics projection

The collector maintains cumulative metrics for:

- operation counts by operation kind;
- per-node started, succeeded, failed, aborted, discarded, and blocked attempts;
- per-node duration count, total, and maximum;
- current and maximum active data loads;
- concurrency queue count and wait duration;
- fresh-value skips and active-attempt reuse;
- context and changed-result invalidations;
- scheduler requests, starts, completions, and failures;
- refresh-policy starts, retries, completions, failures, timeouts, pauses, resumes, and stops;
- transaction starts, commits, rollbacks, conflicts, and duration;
- mutation starts, terminal outcomes, and duration;
- current direct and required subscription totals;
- total received and dropped diagnostic records.

Queue wait duration uses timestamps from matching queued and started records. Load concurrency decrements only for attempts that previously emitted a start record, preventing a queued cancellation from reducing another active load.

## Reset behaviour

`reset()` clears retained events, dropped count, cumulative counters, duration accumulators, queue baselines, and active-attempt tracking owned by the collector.

It does not interact with or mutate any graph runtime. Reset establishes a new observation baseline for subsequent events.

## Shared collector behaviour

One collector may receive events from multiple runtimes deliberately. Runtime IDs remain present on retained records. Cumulative metrics aggregate the complete received stream, including overlapping active loads across those runtimes.

Applications that need isolated metrics should create one collector per runtime.

## Public contracts

M10D exports:

- `createInMemoryGraphDiagnostics(...)`;
- `InMemoryGraphDiagnostics`;
- `InMemoryGraphDiagnosticsOptions`;
- `GraphMetricsSnapshot`;
- `GraphNodeAttemptMetrics`;
- `GraphDurationMetrics`.

The metrics reducer remains internal. Runtime code does not import the collector or metrics implementation.

## Behavioural coverage

Focused tests verify:

- capacity validation;
- newest-record retention and FIFO eviction;
- cumulative metrics after retained-event eviction;
- operation, transaction, mutation, queue, concurrency, outcome, and duration metrics;
- immutable event and metrics snapshots;
- reset without runtime mutation;
- deliberate collection of independent runtime streams;
- public collector and metrics typing.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict TypeScript compilation of the complete core public entry passed.
- Strict TypeScript compilation of the M10D collector tests passed using a local Vitest declaration shim.
- Static architecture checks confirmed runtime capabilities do not depend on the collector.
- ZIP integrity and repository-relative paths were verified.

Project dependencies were unavailable, so the complete repository type check, Vitest suite, and production build were not run or claimed.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10D was validated successfully against the combined checkout during Milestone 10 closure.

## Completion

M10D is complete and was validated as part of the successful combined Milestone 10 offline verification.
