# Milestone 3: Subscription, Scheduler, Prefetch, and Refresh

## Status

Complete and validated offline.

Milestone 3 established subscription-driven execution on top of the Milestone 2 runtime. The same execution engine now serves explicit execution, automatic scheduling, prefetch, and refresh. These capabilities are used by the Vue adapter, Pinia integration, and every playground scenario.

## Delivered capabilities

- Direct node subscriptions
- Reference-counted subscription ownership
- Transitive required-subscription accounting
- Per-subscription target and ancestor deduplication
- Idempotent unsubscribe
- Subscription inspection
- Automatic microtask scheduling
- Synchronous schedule-request coalescing
- Active-flush follow-up handling
- Subscription-driven cancellation ownership
- Scheduler error inspection
- Scheduler settlement through `whenSettled()`
- One-shot prefetch without persistent subscription ownership
- Manual refresh for data and derived nodes
- Caller-operation ownership and active-attempt sharing
- Changed-result descendant invalidation
- Behavioural and compile-time tests

## Final terminology

The public lifecycle API uses node-subscription terminology:

```ts
const subscription = runtime.subscribeNodes([Targets]);
const state = runtime.getSubscriptionState(Targets);
const active = runtime.hasSubscribers(Targets);
subscription.unsubscribe();
```

Runtime change observation remains separate:

```ts
const stopObserving = runtime.onChange(listener);
```

Earlier internal and draft documentation used the term `demand`. That terminology was removed before automatic scheduling was implemented. No compatibility aliases were retained because the repository had no established external consumers.

## Subscription ownership

A subscription contributes:

- `direct` ownership to explicitly requested targets
- `required` ownership to transitive ancestors
- `total` as the sum of direct and required ownership

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}
```

One subscription contributes at most once to each node:

- duplicate targets are removed
- shared and diamond ancestors receive one contribution
- a directly requested parent does not also receive a required contribution from a requested child in the same subscription
- separate subscriptions contribute independently

All requested handles are validated before counts change. Equivalent handles resolve by registered key. Failed validation applies no partial ownership.

`unsubscribe()` removes exactly that subscription's contributions and is idempotent. An empty subscription is a valid no-op.

## Subscription observation

A successful non-empty subscription and an active non-empty unsubscribe each notify runtime observers after counts commit.

The following are silent:

- empty subscriptions
- repeated unsubscribe
- validation failure before mutation

Subscription changes do not directly mutate node values, status, freshness, errors, or generations.

## Automatic scheduling

Creating a non-empty subscription requests one scheduler microtask. Loaders are not invoked synchronously inside `subscribeNodes()`.

```ts
const subscription = runtime.subscribeNodes([Targets]);
await runtime.whenSettled();
```

At flush time, the scheduler recalculates current directly subscribed targets that do not have a fresh successful value. Required ancestors are included by the existing dependency-aware execution engine.

Properties:

- multiple synchronous schedule requests coalesce
- one scheduler flush runs at a time per runtime
- requests during an active flush set one follow-up requirement
- follow-up planning reads current subscriptions, state, and generations
- scheduler execution uses the same node attempts as explicit, prefetch, and refresh work
- failed subscribed nodes do not enter an immediate retry loop

A new subscription or relevant context change is an external retry trigger.

## Scheduler state and settlement

```ts
interface SchedulerState {
  readonly isScheduled: boolean;
  readonly isRunning: boolean;
  readonly error: Error | null;
}
```

```ts
const schedulerState = runtime.getSchedulerState();
await runtime.whenSettled();
```

`whenSettled()` resolves when there is no queued flush, active flush, or required follow-up. It resolves after success, failure, and scheduler-owned cancellation. It does not reject for scheduler execution failure.

A settled runtime may still contain stale or failed subscribed nodes. Consumers inspect node and scheduler state for outcomes.

`whenSettled()` describes automatic scheduler work only. Callers await prefetch and refresh directly.

## Cancellation ownership

Active attempts track their execution origins. Unsubscribing the final consumer aborts work only when:

- the attempt is scheduler-owned
- the node is no longer directly or transitively required by a current subscription

Work remains active when another subscription still requires it or when an explicit, prefetch, or refresh caller also owns the attempt.

Cancellation caused by disappearing subscription ownership is not stored as a node or scheduler business error.

If a subscription is created and released before the queued microtask runs, the loader does not start because target selection reads current ownership at flush time.

## Prefetch

```ts
await runtime.prefetch([Targets]);
```

Prefetch is caller-owned one-shot execution:

- it creates no persistent subscription ownership
- it includes required ancestors
- it skips fresh successful values
- it shares matching active attempts
- it rejects with `GraphExecutionError` after independent executable branches settle

A later context change does not automatically reload a prefetched node unless a subscription or another refresh policy requires it.

## Manual refresh

```ts
await runtime.refresh([Targets, Summary]);
```

Refresh accepts registered data and derived nodes, not context nodes. Complete target validation occurs before generation mutation.

A refresh operation:

- deduplicates target keys
- uses order-independent operation identity
- shares overlapping calls for the same target set
- advances prepared target generations once
- preserves successful data
- aborts superseded work
- executes through the single dependency-aware execution engine

If a refreshed node had a successful value and commits a different result by `Object.is`, transitive descendants become stale and subscribed descendants request scheduler work. An equal result does not invalidate descendants.

A refresh failure retains previous successful data, records the error, and leaves the node stale. A later successful refresh clears the error.

## Operation and scheduler interaction

Explicit execution, scheduler execution, prefetch, and refresh can share one active node attempt. Attempt ownership prevents final unsubscribe from cancelling caller-owned work.

Caller-operation failures reject the caller. They do not become scheduler errors unless scheduler orchestration independently owns the same failing work.

Refresh preparation, attempt start, success or failure, descendant invalidation, and scheduler transitions are separate observable commits. The public contract does not promise one notification per operation.

## Test coverage

### Subscription lifecycle

- zero initial counts
- direct and required ownership
- multiple independent subscriptions
- shared and diamond ancestor deduplication
- duplicate targets
- parent-plus-child target semantics
- equivalent registered handles
- atomic validation
- idempotent unsubscribe
- frozen read-only snapshots
- no node-state mutation from subscription metadata

### Scheduler

- asynchronous automatic loading
- microtask coalescing
- current-state planning at flush time
- active-flush follow-up work
- context invalidation reloads
- shared attempt ownership
- final-unsubscribe cancellation
- branch-scoped scheduler failure
- external retry triggers
- deterministic settlement

### Prefetch and refresh

- one-shot prefetch
- no subscription side effects
- fresh-value reuse
- refresh of data and derived targets
- operation sharing and target-order independence
- descendant invalidation only for changed results
- refresh failure with retained data
- scheduler and cancellation interaction
- compile-time rejection of invalid refresh targets

## Validation

Milestone 3 Steps 3A, 3B, and 3C were reported as validated offline. The current combined repository should continue to run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

## Historical record

The original implementation prompts are removed from active documentation because they describe pre-implementation restrictions, superseded `demand` terminology, and work sequencing that is now complete.

The three original implementation-note paths remain as compatibility pointers for later historical documents. Git history remains the source for detailed point-in-time implementation instructions.
