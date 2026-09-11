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

- Demand registration
- Automatic microtask scheduling
- Coalescing of synchronous graph changes
- Demand release
- Prefetch
- Manual refresh

It will use the explicit execution engine rather than replacing it.

## Proposed for Milestone 4

Transactions will batch related context changes, defer invalidation notifications, and request one scheduler flush. Multiple `setContext` calls are not atomic in Milestone 2.
