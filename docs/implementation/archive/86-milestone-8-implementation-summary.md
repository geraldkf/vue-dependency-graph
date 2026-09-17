# Milestone 8: Refresh Policies and Polling Implementation Summary

## Status

Complete and validated.

The combined Milestone 8 checkout passed the full repository command suite and the Polling Progress manual browser paths, as reported after M8F. M8A through M8G are complete.

## Delivered capability

Milestone 8 adds subscription-aware refresh policies to data nodes without introducing a second cache, loader, scheduler, or execution path.

The public policy helpers are:

```ts
staleAfter({ durationMs })
refreshInterval({ intervalMs, retry })
pollUntil<TValue>({
  intervalMs,
  timeoutMs,
  stopWhen,
  failWhen,
  retry,
})
```

The runtime now supports:

- stale-after refresh based on successful-value age;
- fixed recurring refresh while subscribed;
- typed polling until completion or business failure;
- active-time polling timeout;
- fixed and exponential retry backoff;
- bounded proportional jitter;
- pause and resume with remaining-delay preservation;
- optional browser visibility and network lifecycle integration;
- generation-safe terminal errors that preserve the latest successful value;
- runtime-local policy sessions and deterministic injected environments.

## Runtime architecture

One runtime-local refresh-policy controller interprets immutable metadata from data-node definitions. All policy work delegates to the existing refresh operation and execution engine. Existing rules for generation protection, cancellation, stale-data retention, shared attempts, descendant invalidation, and concurrency limiting remain authoritative.

Recursive timeouts prevent overlapping recurring work. Policy-owned attempts are distinct from manual refresh ownership, so final unsubscribe can stop automatic-only work without cancelling shared caller-owned work.

Polling sessions distinguish policy-owned generations from external invalidation. Successful policy attempts continue the current polling cycle; dependency, event, or manual invalidation starts a clean cycle from the next successful value.

## Terminal behaviour

Completion leaves the latest value successful and fresh. Business failure, predicate failure, timeout, and retry exhaustion preserve the latest successful data and transition the node to stale error state.

Exported error types are:

- `GraphPollingConditionError`
- `GraphPollingTimeoutError`
- `GraphRefreshRetryExhaustedError`

## Vue and browser integration

`createBrowserRefreshPolicyEnvironment(...)` is exported from the Vue entry point. It can pause policy timers while the document is hidden or the browser is offline. Core remains free of Vue, Pinia, and browser imports.

## Deterministic playground

The Polling Progress scenario demonstrates progress, completion, business failure, timeout, retry, pause/resume, unmount cleanup, and reset without wall-clock waits or random outcomes. It displays request and timer diagnostics so non-overlap and cleanup are observable.

## Validation completed

The following combined-checkout commands passed:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

The reported manual browser validation also passed the Polling Progress paths for progress, completion, business failure, timeout, deterministic retry, pause/resume, unmount, reset, and tab-switch cleanup.

## Milestone slices

- M8A: policy definitions, typing, validation, and compile-time coverage
- M8B: runtime controller, deterministic environment, and stale-after
- M8C: fixed interval with non-overlapping recursive scheduling
- M8D: poll-until completion, failure, timeout, and terminal errors
- M8E: retry, backoff, jitter, pause/resume, and browser integration
- M8F: deterministic Polling Progress playground
- M8G: documentation reconciliation and final validation

## Release handoff

Milestone 8 is ready for integration and migration review. No known Milestone 8 validation gaps remain. APIs remain subject to the repository's broader existing-application migration and release process.
