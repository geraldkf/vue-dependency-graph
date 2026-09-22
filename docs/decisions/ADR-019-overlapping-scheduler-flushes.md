# ADR-019: Scheduler flushes overlap instead of queuing behind one another

## Status

Accepted, implemented, and validated.

## Context

The scheduler coalesces every `schedule()` request made in the same synchronous turn into one flush, run on the next microtask. Until now, a flush also blocked the next one: while a flush's `execute()` call was in flight, any further `schedule()` request set a `followUpRequired` flag and waited for the running flush to finish before starting fresh.

That meant one slow load could hold up everything else in the runtime for as long as it took to settle:

- a node subscribed while an unrelated slow load was in flight did not start loading until the slow load finished;
- an unrelated node's context change did not reload it until the slow load finished, so the UI kept showing stale data;
- several components mounting one after another during a slow load all waited for it;
- explicit `execute()` calls and refresh-policy polls were unaffected, because they bypass the scheduler - only scheduler-driven (subscription and invalidation) work queued behind it.

Measured: a fast node subscribed 30 ms into a 200 ms slow load started loading at about 207 ms instead of at about 34 ms.

This is the classic queuing-theory failure of first-come-first-served-with-blocking, sometimes called head-of-line blocking: one item at the front of a queue that takes a long time delays every unrelated item behind it, even though nothing about their work depends on it. Prior art treats a slow request and independent later requests as separable: TanStack Query runs independent queries in parallel by default and dedupes by query key; DataLoader coalesces same-tick requests into one batch and does not hold that batch's callers hostage to a previous batch.

## Decision

A flush no longer blocks the next one. `schedule()` still coalesces synchronous requests into one flush, but as soon as a flush starts executing, a further request is served by its own new flush at the next microtask - it does not wait for the running flush's `execute()` to resolve.

Concretely (`scheduling/scheduler.ts`):

- `inFlight` is a count of concurrently executing flushes, not a single `running` flag.
- Each flush gets its own diagnostic context from `beginFlush` (`composition/scheduler-diagnostics.ts`), so concurrent flushes never share or overwrite one another's attribution. `beginFlush` reads and resets the shared `schedulerRequest` tracker immediately, so a later, unrelated `schedule()` call starts from a clean tracker.
- `getSubscribedTargetsNeedingWork` (`composition/graph-coordination.ts`) excludes a node that already has an unaborted attempt in flight, so two flushes never target the same node - the existing per-node attempt reuse in `executeNode` (see architecture 03, "In-flight sharing") still applies across flushes, it is just no longer the only thing preventing duplicate scheduler-level work.
- `whenSettled()` resolves once every overlapping flush has finished, not just the most recent one.
- `getSchedulerState().error` reports the most recently *finished* flush's outcome (cleared to `null` on any flush's success), not "any flush has ever failed" - a snapshot of the last thing that happened, consistent with what a single flush reported before.

What did not change: dependency ordering. `execute()` still resolves a node's ancestors before invoking the node's own loader, so a node whose parent is the slow load still cannot start - not because a flush is blocking it, but because it does not yet have a value to read. Its own state is untouched (not "loading") while it waits, which is a pre-existing characteristic of dependency-aware execution, not something this change introduces.

## Consequences

- Independent work is never held up by an unrelated slow load. `tests/core/scheduler-overlap.spec.ts` (34 tests) pins this for: a newly subscribed node, a context change for an unrelated subscribed node, several mounts during one slow load, a same-call sibling, a full concurrency limit queuing and moving on when a slot frees, work never starting twice, invalidation and supersession races (including loaders that ignore their abort signal), `whenSettled` and scheduler-state semantics across overlap, attribution and diagnostics staying correctly separated per flush, and storms of reentrant scheduling.
- **Diagnostic golden trace changed.** The recorded scenario exercises several caller-owned operations (`execute`, `prefetch`, `refresh`, query variants) back to back; some of these now overlap with each other and with scheduler-driven work where they used to run strictly in sequence, producing a different but still fully attributed event grouping (extra `node.execution.reused` events, wider `nodeKeys` on one `scheduler.started`). Confirmed by comparing the two traces as sets: the same events occur, attributed the same way: this is regrouping, not new or lost behaviour. Re-recorded; review the diff in the same PR as this ADR.
- **Cost: per-change-notification overhead on very large graphs.** Each flush independently scans `graph.getNodes()`. Measured on a 1,000-node graph under a storm of 500 context changes, each in its own microtask: about 0.28 ms per change before this change, about 1.0 ms after, because flushes now overlap rather than fully draining before the next starts. A dirty-set inside `getSubscribedTargetsNeedingWork`, tracking only nodes actually invalidated since the last scan, would remove this cost if it is ever measured to matter; not built now, since nothing indicates it does at the graph sizes this project targets.
- **A burst of invalidations for one node no longer coalesces "for free" while something else is loading.** Before, 50 rapid context changes for one node made exactly one loader call if an unrelated slow load happened to be in flight (an accidental effect of blocking, not a documented guarantee - the same burst with nothing in flight already made 50 calls). After, it makes 50 calls regardless. If deliberate coalescing is wanted, it should be an explicit debounce policy, not a side effect of scheduler serialization.
- Scheduler diagnostics (`scheduler.requested`/`started`/`completed`/`failed`) are now per-flush and can overlap in the event stream; the devtools Timeline already groups by `operationId`, so overlapping flushes show as separate operations without changes there.

## Alternatives considered

### Keep serialized flushes; add a per-load timeout

Would bound how long unrelated work waits, but does not fix the actual problem - waiting on work nobody else needs - and adds a policy question (how long is a "slow" load allowed to run) that is orthogonal to head-of-line blocking.

### Priority lanes (subscription work jumps ahead of a running flush)

Adds API surface and a new prioritization model for what overlap fixes structurally: nothing needs to jump ahead of the slow load if it is not, in fact, behind it.

### A timed hybrid (serialize flushes under some duration, overlap above it)

Introduces an arbitrary threshold and two different behaviours to reason about, for no benefit over overlapping unconditionally: overlap has no downside for a fast flush (it simply finishes before the next one starts) and removes the downside for a slow one.
