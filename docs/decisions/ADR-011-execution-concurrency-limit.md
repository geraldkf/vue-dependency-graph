# ADR-011: Execution Concurrency Limit

## Status

Accepted and implemented. Full offline validation is pending after the final integration-test update.

## Context

A request came in describing the scheduler as running "everything sync" and asking for sibling dependencies to run via `Promise.all`, plus a configurable concurrency cap. Checked directly against `src/core/execution/execution.ts` and then verified empirically (see `docs/implementation/26-execution-concurrency-limit-plan.md` for the test and its output): dependency resolution already uses `Promise.allSettled` over a `.map()`, not a sequential loop, for both sibling dependencies of one node and independent top-level targets in one `execute()` call. Three sibling loads with a 100ms artificial delay each completed in ~102ms total, confirming genuine concurrency, not sequential execution.

What the current implementation genuinely lacks is a cap: nothing limits how many `load()` calls can be in flight simultaneously. A context change that invalidates many subscribed nodes at once fires all of their loads with no throttling, which can overwhelm a backend or a browser's connection pool. That gap is real and is what this ADR addresses.

## Decision

Add an optional, construction-time concurrency limit, applied only to `DataNodeDefinition.load()` calls, implemented as a hand-rolled FIFO counting semaphore rather than a third-party dependency, shared globally across the whole runtime rather than scoped per call site or per execution origin.

```ts
createGraphRuntime(graph, { maxConcurrentLoads: 6 });
```

Default: unlimited (`Infinity`), making the feature backward-compatible by construction rather than by a separate opt-out — every existing caller passes no options and observes identical behavior to today.

## Consequences

- `createGraphRuntime`'s signature changes from `(graph: Graph)` to `(graph: Graph, options?: GraphRuntimeOptions)`. Every existing call site continues to compile and behave identically, since the new parameter is optional and its absence is equivalent to no limit.
- A load queued behind a full limiter and then aborted (unsubscribe, invalidation, superseded generation) needs to leave the queue and reject without ever calling `load()`. This is handled by listening to the same per-attempt `AbortSignal` `executeNode` already creates, and requires no change to the existing obsolete-attempt classification in `run()`'s catch block — by the time that check runs, the aborted signal is already reflected in `controller.signal.aborted`, one of the conditions it already tests.
- Update (ADR-018): an aborted attempt now ends without waiting for its loader, so its slot is released at abort. For a loader that ignores its abort signal the underlying request can outlive the slot, and real concurrency can briefly exceed the limit; loaders that honour the signal are unaffected.
- Derived nodes are never gated. They are synchronous by design and gating them would add queueing overhead for work that takes no meaningful time.
- The limit is global and shared across every execution origin (`scheduler`, `explicit`, `prefetch`, `refresh`). A per-origin budget was considered and rejected: if a subscription-driven load and a `prefetch()` each had their own separate allowance, the combined in-flight total could exceed the number the caller actually configured, defeating the purpose of the setting.
- No dynamic adjustment after construction, and no priority ordering among queued waiters (FIFO only) — both are plausible future work, neither has a concrete need driving it yet, and both add real complexity (mid-flight limit changes affecting already-queued waiters; priority inversion between origins) that isn't worth taking on speculatively.
- Orthogonal to Milestone 5's transaction work. Transactions govern when state mutations and notifications become observable; this governs how many loads run concurrently. Neither depends on the other, and this can be implemented independently of Milestone 4 or Milestone 5's sequencing.

## Alternatives considered

- **A third-party limiter library (e.g. `p-limit`).** Rejected. The primitive is small and well-understood (a counter plus a FIFO wait queue), and this project currently has exactly one runtime dependency (`vue`). Adding a package for something this size, in a framework other projects will depend on, costs more than it saves.
- **Per-call or per-origin limits instead of one global limiter.** Rejected — see Consequences above. A global ceiling is the only shape that actually bounds total in-flight work regardless of which part of the runtime requested it.
- **Treat the request's "make siblings run via `Promise.all`" premise at face value and add explicit `Promise.all` calls somewhere.** Rejected, because it was checked first and found not to describe an actual gap — the existing `Promise.allSettled` + `.map()` pattern already achieves this. Implementing a redundant mechanism on top of a already-working one would have added complexity without fixing anything.
