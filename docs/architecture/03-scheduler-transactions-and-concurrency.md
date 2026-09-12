# Execution, Scheduling, Transactions, and Concurrency

## Implemented in Milestone 2

Milestone 2 provides explicit dependency-aware execution:

```ts
const runtime = createGraphRuntime(graph);
await runtime.execute([Targets, Credits]);
```

Execution starts from the requested targets, includes their transitive ancestors, skips fresh successful nodes, and runs independent ready branches concurrently.

Automatic scheduling remains unimplemented. Consumers must explicitly call `execute` until Milestone 3.

## Runtime separation

Immutable node definitions and graph topology can be shared by multiple runtime instances. Each runtime owns its values, statuses, errors, generations, listeners, active promises, and abort controllers.

## Runtime state

Execution status and freshness are independent:

```ts
type NodeStatus =
  | "idle"
  | "loading"
  | "success"
  | "refreshing"
  | "error";

type NodeFreshness = "fresh" | "stale";
```

Context nodes begin successful and fresh. Data nodes begin with their initial value but without a successful execution. Derived nodes use `undefined` before their first successful derivation.

## Dependency execution

The runtime recursively ensures all required parents before a child. Independent parent promises are awaited together, providing parallel execution without a separate wave abstraction.

Context nodes require no loader. Data nodes receive typed `get` and an attempt-scoped `AbortSignal`. Derived nodes execute synchronously after all parents are fresh and successful.

## Generations and cancellation

Each node has a generation. Changing a context increments that context generation and increments each transitive descendant generation once. Affected active attempts are aborted.

Every attempt captures its starting generation and unique token. A result commits only when both still match. This prevents an API that ignores abort from overwriting newer state.

Abort and superseded results are not stored as business errors.

## In-flight deduplication

A runtime shares one active promise for the same node generation. Overlapping explicit executions therefore do not duplicate a loader. Different runtime instances never share attempts.

## Branch failures

Failure is branch scoped:

- A directly failed node records an error.
- Descendants are blocked and do not execute.
- Independent branches continue.
- The execution promise settles after executable branches finish.
- It then rejects with `GraphExecutionError` containing failed and blocked node records.

## Observation

A small framework-agnostic graph-level subscription API notifies after committed state changes. Listener failures are isolated. Obsolete results do not notify.

## Proposed for Milestone 3

Milestone 3 will add:

- Node subscription
- Automatic microtask scheduling
- Coalescing of synchronous graph changes
- Unsubscribe
- Prefetch
- Manual refresh

It will use the explicit execution engine rather than replacing it.

## Proposed for Milestone 5

Transactions will batch related context changes, defer invalidation notifications, and request one scheduler flush. Multiple `setContext` calls are not atomic in Milestone 2.

## Implemented in Step 3A: Node subscription lifecycle

A runtime can now register lifecycle subscription without triggering execution:

```ts
const subscription = runtime.subscribeNodes([Targets]);
```

Subscription has three counters:

- Direct subscription from explicit targets
- Required subscription from directly subscribed descendants
- Total subscription count as their sum

One subscription contributes once to each transitive ancestor, including diamond graphs. Multiple targets in one subscription use set semantics: duplicate targets are removed, shared ancestors receive one contribution, and a directly requested parent does not also receive required subscription from a requested child.

Separate subscriptions contribute independently. Releasing a subscription removes exactly its own direct and required contributions and is idempotent.

Subscription changes notify existing runtime subscribers once after add and once after active release. Empty and failed subscriptions do not notify.

Step 3A deliberately does not execute, schedule, refresh, or cancel nodes when subscription changes. Step 3B will connect total subscription count to automatic microtask scheduling through the existing execution engine.

## Implemented in Step 3B: Automatic subscription scheduler

Creating a non-empty node subscription queues one microtask scheduler flush. Multiple synchronous subscriptions and context changes coalesce into that flush. The scheduler recalculates the current directly subscribed targets at flush time and delegates execution to the existing dependency-aware execution engine.

```ts
const subscription = runtime.subscribeNodes([Targets]);
await runtime.whenSettled();
```

Loaders never run synchronously inside `subscribeNodes` or `setContext`.

Only one scheduler flush runs per runtime. Changes occurring while a flush is active request one follow-up pass, which recalculates current subscription and generation state rather than reusing an old target list.

`whenSettled()` resolves when there is no queued flush, active flush, or required follow-up. It resolves after success, failure, or scheduler-owned cancellation. It does not imply that every subscribed node succeeded.

Scheduler failures are captured in a read-only state:

```ts
runtime.getSchedulerState();
```

A failed subscribed node remains settled without an automatic retry loop. A later context change or new node subscription is an explicit retry trigger and clears the prior scheduler error when the new pass starts.

### Cancellation ownership

Active attempts track whether they are owned by explicit execution, scheduler execution, or both. Unsubscribing the final subscriber aborts scheduler-only work that no longer has any direct or required subscription count. Shared work remains active while another subscriber requires it. Work also remains active when an explicit `execute` caller owns the same attempt.

### Implemented in Step 3C: One-shot operations

`prefetch(...)` and `refresh(...)` are caller-owned one-shot operations that reuse the existing dependency-aware executor.

```ts
await runtime.prefetch([Targets]);
await runtime.refresh([Targets]);
```

Prefetch skips successful fresh nodes, creates no persistent subscription counts, and does not cause later context changes to reload prefetched nodes automatically. Manual refresh forces data or derived targets into a new generation while preserving successful data.

Execution attempts can be owned by explicit execution, the scheduler, prefetch, refresh, or a combination. Final unsubscribe cancels scheduler-only work but preserves attempts still owned by a caller operation.

`whenSettled()` remains intentionally limited to automatic scheduler work. Callers await the promise returned by `prefetch(...)` or `refresh(...)` for those operations.
