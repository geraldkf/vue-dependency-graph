# ADR-018: Aborting an attempt ends it, even if the loader ignores the signal

## Status

Accepted, implemented, and validated.

## Context

Every data-node attempt has an `AbortSignal`. The runtime aborts it when nothing needs the work any more: the last subscriber leaves, an invalidation or write supersedes the attempt, or a queued attempt is cancelled.

Until now aborting only _signalled_. The attempt itself kept waiting for its loader to settle, so an attempt lived exactly as long as the loader chose to. A loader that honours the signal (`fetch(url, { signal })`) ends promptly, and nothing was wrong. A loader that ignores the signal - a third-party SDK call, a promise that is never rejected on abort - kept the abandoned attempt alive, and an attempt that stays alive keeps three things:

- its **concurrency slot** (`maxConcurrentLoads`);
- its **place in the active attempt table**, so a later request for the same node reuses the abandoned attempt instead of starting a new one;
- the **scheduler flush** awaiting it. Flushes run one at a time per runtime, so a flush that never finishes stops every later automatic load in the whole runtime, for every node, not just the one that stalled.

This was found by the retention tests: one loader that ignores its signal and never settles, unsubscribed, left the scheduler running forever; an unrelated node subscribed afterwards stayed `idle`. Only explicit `execute` calls, which bypass the scheduler, still worked.

## Decision

When an attempt's signal aborts, the attempt ends immediately, without waiting for the loader.

- The loader call is raced against the signal (`settleOrAbort` in `execution/execution.ts`). Abort settles the attempt with an `AbortError`, which goes through the same classification as before: superseded attempts are discarded, the rest are reported as aborted.
- The attempt leaves the active attempt table, its concurrency slot is released, its node returns to `idle` (or `success` with its value) if it still owns the node's state, and the scheduler flush awaiting it completes.
- Whatever the loader eventually produces, success or failure, is ignored. A failure after abandonment is not an unhandled rejection.
- Loaders that honour the signal are unaffected: they reject on abort as before, and the outcome is identical.

The runtime cannot stop work that ignores the signal; it stops _waiting_ for it. Passing the signal on (to `fetch` or an API client) is still what actually cancels the request, and stays the documented advice.

## Consequences

- One stalled, signal-ignoring request can no longer stop the rest of the runtime once nothing needs it. The retention tests (`tests/retention/attempt-cleanup.spec.ts`) pin this: unsubscribe, invalidation, queued cancellation, and a mixed churn of every outcome all leave the attempt table empty, the scheduler idle, and every slot free.
- **Accounting trade-off.** ADR-011 describes `maxConcurrentLoads` as bounding real in-flight work. For a loader that ignores its signal, an abandoned request can now keep running after its slot is given back, so real concurrency can briefly exceed the configured limit. Loaders that honour the signal are unaffected. Holding the slot until the loader settles would keep the number exact, but one stalled request per slot would then starve the runtime permanently, which is the failure this decision removes. Liveness was chosen over exact accounting.
- Loads take one extra microtask to settle, because they now settle through the race. Independent concurrent loads that finish in the same tick can therefore complete in a different relative order (the diagnostic golden trace shows one event moving two positions later). No semantics depend on that order.
- For a signal-ignoring loader, the terminal diagnostic event is now `node.load.aborted` when its attempt was abandoned; it used to be `node.load.discarded` when the late result finally arrived. Exactly one terminal event is reported per attempt.
- A still-subscribed load that is merely slow still holds the scheduler flush until it finishes. That is the documented one-flush-at-a-time behaviour (architecture 03) and is separate from this decision.

## Alternatives considered

### Document that loaders must honour the signal

Rejected: signals are commonly ignored in practice, and the consequence was disproportionate - a runtime-wide stall, not a wasted request.

### Release the flush but keep the concurrency slot until the loader settles

Keeps `maxConcurrentLoads` exact, but a loader that never settles would hold its slot for the life of the runtime. With a limit of N, N such loaders stop all loading. Rejected for the same reason as the status quo.

### A per-load timeout

Useful, but it is a different feature (a policy about how long to wait) and would not fix waiting on work nobody wants. Not part of this decision.
