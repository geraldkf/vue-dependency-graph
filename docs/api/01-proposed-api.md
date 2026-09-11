# Public API

## Implemented graph definitions and registry

```ts
const JobSeekerId = defineContextNode<number | undefined>({
  key: "jobSeekerId",
  initialValue: undefined,
});

const PointPeriods = defineDataNode({
  key: "pointPeriods",
  dependencies: [JobSeekerId] as const,
  initialValue: [] as PointPeriod[],
  load: ({ get, signal }) =>
    api.getPointPeriods(get(JobSeekerId), signal),
});

const CurrentPointPeriod = defineDerivedNode({
  key: "currentPointPeriod",
  dependencies: [PointPeriods] as const,
  derive: ({ get }) => get(PointPeriods).find(period => period.isCurrent),
});

const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});
```

Graph subscription is order independent and validates keys, duplicate dependencies, missing dependencies, and cycles.

## Implemented runtime API

### Create a runtime

```ts
const runtime = createGraphRuntime(graph);
```

Multiple runtimes created from one graph have independent state.

### Read typed runtime state

```ts
const state = runtime.getState(PointPeriods);
```

State includes:

```ts
interface NodeRuntimeState<TData> {
  readonly data: TData;
  readonly status: "idle" | "loading" | "success" | "refreshing" | "error";
  readonly freshness: "fresh" | "stale";
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}
```

Derived state data is `T | undefined` before its first success. Context and data nodes expose their declared value type because both have an initial value.

### Set context

```ts
runtime.setContext(JobSeekerId, 123);
```

A changed value synchronously marks transitive descendants stale and aborts affected work. It does not execute stale nodes automatically.

### Execute targets explicitly

```ts
await runtime.execute([CurrentPointPeriod]);
```

Execution includes required ancestors, skips fresh successful nodes, deduplicates active work, and permits independent branches to continue when another branch fails.

Failures reject with:

```ts
class GraphExecutionError extends Error {
  readonly failures: readonly NodeExecutionFailure[];
}
```

Each record identifies a directly failed or dependency-blocked node.

### Observe committed state changes

```ts
const unsubscribe = runtime.onChange(() => {
  const state = runtime.getState(CurrentPointPeriod);
});

unsubscribe();
```

Unsubscribe is idempotent. Listener errors are isolated.

## Proposed for later milestones

The following APIs are not implemented yet:

```ts
useNode(PointPeriods);
useNodes({ periods: PointPeriods });
defineQuery(...);
useQuery(...);
graph.transaction(...);
graph.publish(...);
graph.prefetch(...);
graph.refresh(...);
```

Automatic subscription-driven execution is Milestone 3. Transactions are Milestone 4. Vue integration, query groups, events, polling, and mutations follow later milestones.

## Implemented node subscription lifecycle API

Register subscription without executing:

```ts
const subscription = runtime.subscribeNodes([Targets, Credits] as const);
```

Inspect subscription:

```ts
runtime.getSubscriptionState(Targets);
runtime.hasSubscribers(Targets);
```

Subscription state is read-only:

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}
```

Release one consumer's ownership:

```ts
subscription.unsubscribe();
```

The subscription exposes a frozen, deduplicated `nodes` collection. Release is idempotent. Empty subscription is a no-op. Registration uses key-based graph identity and rejects unregistered targets before applying any subscription.

Node subscription alone does not call loaders, evaluate derived nodes, alter node runtime state, schedule work, or cancel execution.

## Implemented automatic subscription scheduling

A node subscription now schedules loading automatically:

```ts
const subscription = runtime.subscribeNodes([Targets]);
await runtime.whenSettled();

const targets = runtime.getState(Targets);
```

`subscribeNodes` remains synchronous and does not invoke loaders before returning. The scheduler runs in a queued microtask and uses the existing `execute` engine for ancestors, ordering, concurrency, deduplication, cancellation, and failures.

Inspect scheduler state:

```ts
interface SchedulerState {
  readonly isScheduled: boolean;
  readonly isRunning: boolean;
  readonly error: Error | null;
}

const scheduler = runtime.getSchedulerState();
```

`whenSettled(): Promise<void>` resolves after queued, active, and follow-up scheduler work completes. It also resolves after execution failure, with the failure available from `getSchedulerState()`.

Unsubscribing the final subscriber cancels scheduler-only work that is no longer required. It does not cancel an attempt also owned by an explicit `runtime.execute(...)` caller.
