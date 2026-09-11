# Runtime Composition Refactor Plan

## Status

Planned. Milestone 3 is validated offline. This behavior-preserving refactor is scheduled before Milestone 4.

## Objective

Refactor the framework-agnostic runtime into small closure-based capabilities with private mutable state, explicit dependencies, and narrow structural interfaces.

The public `GraphRuntime` API remains unchanged throughout the refactor.

## Work sequence

### R1A: Documentation and repository cleanup

Status: Validated offline.

### R1B: Name existing runtime invariants

Status: Validated offline.

### R1C: Standardise registered-node validation

Status: Validated offline.

### R1D: Document notification ownership

Status: Validated offline.

### R2: Extract runtime observation

Status: Prepared; offline validation pending.

Listener storage and synchronous snapshot dispatch now belong to a small closure-based observer. Notification ownership and call sites remain in the capabilities that commit state. The observer has no runtime-state knowledge, and R2 introduces no batching, payloads, or deferred dispatch.

### R3: Extract runtime state and active-attempt storage

Status: Planned.

### R4: Extract the execution controller

Status: Planned.

### R5: Extract subscription storage and lifecycle

Status: Planned.

### R6: Extract the automatic scheduler

Status: Planned.

### R7: Extract invalidation and context updates

Status: Planned.

### R8: Extract prefetch and refresh operations

Status: Planned.

### R9: Simplify runtime assembly and document internal boundaries

Status: Planned.

## Composition decisions

- Preserve the public `GraphRuntime` API.
- Preserve runtime behavior throughout the refactor.
- Use closure-based `createX(...)` factories.
- Use narrow structural interfaces between internal capabilities.
- Keep `createGraphRuntime(...)` as the explicit composition root.
- Keep one private execution engine for explicit, scheduled, prefetch, and refresh work.
- Do not introduce fluent internal builders.
- Do not introduce a dependency-injection container.
- Do not expose internal controllers publicly.
- Validate every refactor task independently before continuing.

## Non-goals

The refactor does not implement transactions, events, Vue composables, query groups, polling, retries, mutations, diagnostics, snapshots, devtools, or cache garbage collection.

## Notification ownership contract

A capability notifies after it commits an externally observable runtime transition. Its caller does not notify again for the same transition.

This rule prevents duplicate notifications as runtime responsibilities are extracted, keeps timing with the capability that commits state, and prevents callers from depending on another capability's internal transitions. It does not imply one notification per public API call. A multi-stage operation may commit and notify several observable transitions.

### Listener lifecycle

`onChange(listener)` registers a graph-runtime listener. The returned stop function is idempotent. Active listeners are called after committed observable transitions, and stopped listeners are not called again.

Listeners receive no payload and no mutable internal state. They inspect current snapshots through public runtime methods:

```ts
const stopObserving = runtime.onChange(() => {
  const node = runtime.getState(Targets);
  const scheduler = runtime.getSchedulerState();
});

stopObserving();
```

Listeners run in registration order from a snapshot copied before dispatch. A listener added or removed during a dispatch does not alter that dispatch's copied listener sequence. One listener throwing does not prevent later listeners from running. Listener failures do not roll back committed state and are not logged by core code.

### Capability ownership

#### Subscription lifecycle

Subscription lifecycle code owns notification after subscription counts are committed.

- A successful non-empty subscription notifies after direct and required counts are applied.
- An active non-empty unsubscribe notifies after its counts are removed.
- Empty subscription, repeated unsubscribe, and failed validation are silent.
- The scheduler request caused by a subscription is a separate operation from the subscription-count notification.

#### Context and invalidation

Context and invalidation code owns notification after the context value and descendant invalidation state are committed.

- An `Object.is` equal context update is silent.
- A changed value and all affected descendant invalidations are committed synchronously before notification.
- Affected attempts may be aborted during invalidation.
- The later scheduler request for affected subscribed descendants is separate from the context-state notification.
- Invalid context validation is silent because it commits no state.

#### Execution

Execution code owns notification after attempt start, committed success, and committed failure.

- Attempt start notifies after status becomes `loading` or `refreshing`, freshness becomes stale, and the previous error is cleared.
- Success notifies after data, status, freshness, error, and successful-value state are committed.
- Direct failure notifies after error state is committed.
- Obsolete, aborted, and superseded results do not commit business success or failure state and do not notify as success or failure.
- A blocked descendant has no node-state transition merely because it appears in `GraphExecutionError`.

#### Refresh preparation and descendant invalidation

Refresh preparation owns notification after target generations and stale state are committed. Execution then owns its normal attempt transitions.

A changed successful refresh result can commit transitive descendant invalidation after the refreshed node succeeds, producing a later notification. An `Object.is` equal result does not invalidate descendants and produces no descendant-invalidation notification. Empty refresh and validation failure before mutation are silent.

One refresh operation may produce multiple notifications because it commits multiple externally observable transitions. There is no one-notification-per-refresh guarantee.

#### Prefetch

Prefetch has no separate callback or notification channel. It reuses normal execution transitions. Empty prefetch, missing-target validation before execution, and a fresh successful target skipped by execution are silent. Actual prefetch work uses normal attempt-start, success, and failure notifications.

#### Scheduler

The scheduler owns notification after public `SchedulerState` transitions.

- Requesting an idle flush commits `isScheduled: true` and notifies.
- Starting a flush commits scheduled and running state, clears the prior scheduler error, and notifies.
- Completion commits `isRunning: false` and notifies. On failure, the scheduler error is committed before this completion notification.
- A request during an active flush records a private follow-up requirement. Only resulting public scheduler-state transitions are observable.
- Scheduler notifications do not themselves request scheduler work.
- Resolving `whenSettled()` does not itself require a notification.

#### Runtime observer

The runtime observer owns listener registration, idempotent removal, snapshot-at-dispatch iteration, dispatch, and listener-failure isolation. It does not decide when runtime state is ready to notify. The capability committing the state makes that decision.

### Intentionally silent paths

When no observable state is committed, these paths are silent:

- Equal context update
- Empty subscription
- Repeated unsubscribe
- Empty execution
- Empty prefetch
- Empty refresh
- Validation failure before mutation
- Fresh successful node skipped by execution
- Obsolete result discarded without commit
- Repeated invocation of an `onChange(...)` stop function
- `whenSettled()` resolution without a scheduler-state transition

### Non-contractual details

The public contract does not guarantee:

- An exact total listener-call count for a multi-stage operation
- Internal ordering between unrelated execution branches
- An exact number of microtasks
- Private scheduler follow-up flag transitions
- Private attempt tokens or origins
- Mutable state-map structure
- Which private helper physically calls `notify()` after future extraction

The stable contract is the committed observable state available through public snapshots.

## R2 observation-extraction requirements

R2 must:

- Extract listener storage and dispatch only.
- Preserve all current notification call sites initially.
- Preserve listener registration order and snapshot-at-dispatch iteration.
- Preserve listener-failure isolation and idempotent removal.
- Preserve silence for discarded and no-op operations.
- Avoid batching, debouncing, coalescing, or deferring notifications.
- Avoid notification payloads and node-specific observation.
- Leave scheduler triggering unchanged.
- Leave notification ownership with the capability committing state.
