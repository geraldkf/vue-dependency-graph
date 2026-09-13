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

A changed value synchronously marks transitive descendants stale and aborts affected work. Affected subscribed descendants request automatic scheduler work; affected unsubscribed descendants remain stale without loading.

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

The following APIs remain proposed for later milestones:

```ts
defineQuery(...);
useQuery(...);
graph.transaction(...);
graph.publish(...);
```

Subscription-driven execution, prefetch, manual refresh, `useNode`, and `useNodes` are implemented. Transactions, query groups, events, polling, and mutations follow later milestones.

## Implemented node subscription lifecycle API

Register persistent node subscription ownership:

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

`subscribeNodes(...)` does not invoke loaders synchronously. A non-empty subscription requests a coalesced scheduler microtask; the scheduler then executes subscribed stale nodes and their required ancestors.

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

### Implemented prefetch and manual refresh

Prefetch one graph branch without creating subscriptions:

```ts
await runtime.prefetch([Targets]);
```

Prefetch includes required ancestors, skips successful fresh nodes, and rejects with `GraphExecutionError` on failure.

Force data or derived nodes to execute again:

```ts
await runtime.refresh([Targets, Summary]);
```

`refresh(...)` accepts data and derived handles but not context handles. It preserves successful values while refreshing and invalidates descendants only when the committed result changes by `Object.is` comparison.

Both APIs return `Promise<void>`. They are caller-owned one-shot operations and are awaited directly. `runtime.whenSettled()` continues to describe scheduler quiescence only.


## Implemented Vue runtime resolution

Vue composables support the existing injected-runtime setup:

```ts
const targets = useNode(Targets);
const query = useNodes([Targets, Permissions]);
```

Applications that already own a `GraphRuntime`, including applications that expose it through a Pinia store, can pass it explicitly without installing the graph runtime plugin:

```ts
const graphStore = useDependencyGraphStore();

const targets = useNode(Targets, {
  runtime: graphStore.runtime,
});

const query = useNodes([Targets, Permissions], {
  runtime: graphStore.runtime,
});
```

The explicit runtime takes precedence over an injected runtime. When no explicit runtime is supplied, the composables continue to resolve the runtime through `useGraphRuntime()` and preserve its existing missing-runtime error.
