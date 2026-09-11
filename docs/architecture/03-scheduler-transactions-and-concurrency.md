# Scheduler, Transactions, and Concurrency

## Scheduler goals

- Automatically load demanded stale nodes.
- Coalesce multiple synchronous changes.
- Respect dependency ordering.
- Execute independent branches concurrently.
- Deduplicate in-flight loads.
- Prevent obsolete results from overwriting newer state.
- Avoid infinite rescheduling loops.

## Scheduling model

Graph changes request a scheduled flush. Only one flush is queued for the current microtask.

```text
context update
context update
new demand
        |
        v
one scheduled flush
```

A flush calculates the current execution plan from graph state. It must not use a stale plan captured before the transaction or queued changes completed.

## Execution generations

Each invalidation increments a node generation. A loader captures its generation when execution begins. Its result is committed only if the generation is still current.

This prevents an older request from overwriting data loaded for a newer context.

## Cancellation

Each execution receives a scoped `AbortSignal`. Abort controllers must be created per execution, not once for the graph lifetime.

When dependencies or context change:

- Obsolete in-flight work should be aborted where possible.
- An abort should not be treated as a business failure.
- The loader result must still be generation-checked because not all APIs honour abort signals.

## Transactions

Transactions group graph changes into a single commit.

```ts
await graph.transaction(() => {
  graph.set(JobSeekerId, 123);
  graph.set(PointPeriodId, 456);
});
```

During the transaction:

- Values may be staged.
- Invalidations are collected.
- Event publications are collected.
- Scheduler flushes are deferred.

At outermost commit:

1. Apply staged values.
2. Calculate the union of affected nodes.
3. Mark affected nodes stale once.
4. Publish one state notification batch.
5. Schedule one execution flush.

## Nested transactions

Nested transactions join the outer transaction. Only the outermost transaction commits.

If a synchronous transaction callback throws, staged local changes are discarded.

For asynchronous callbacks, documentation must be explicit: the graph transaction protects local graph state only. Any completed remote side effects cannot be rolled back by the graph.

## Automatic batching versus explicit transactions

Synchronous updates outside a transaction are naturally coalesced by the microtask scheduler, but their values may become visible individually.

Use explicit transactions when observers must see all related context changes atomically.

## Concurrent transactions

Initial implementation should serialise explicit async transactions on a graph instance. Allowing overlapping mutable transactions creates ambiguous commit and rollback semantics.

## Execution planning

The planner should:

1. Start with demanded nodes that need work.
2. Include their required ancestors.
3. Exclude fresh successful nodes.
4. Detect blocked nodes.
5. Group ready nodes into waves.
6. Execute each wave concurrently subject to a configurable concurrency limit.

## Infinite loop protection

The scheduler should detect repeated no-progress flushes and polling policies that immediately reschedule without delay. Diagnostics must report the nodes and reasons involved.
