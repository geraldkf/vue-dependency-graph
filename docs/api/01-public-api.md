# Public API

## Define nodes

Node definitions are immutable typed handles. Mutable values and execution state belong to a `GraphRuntime`.

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
```

Context nodes hold mutable graph inputs. Data nodes perform asynchronous work. Derived nodes calculate synchronously from successful dependencies.

## Create a graph and runtime

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});

const runtime = createGraphRuntime(graph);
```

Registration order does not matter. Graph creation validates node keys, duplicate dependencies, missing dependencies, and cycles. Multiple runtimes created from one graph have independent state.

## Read state

```ts
const state = runtime.getState(PointPeriods);
```

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

Context and data nodes expose their declared value type. Derived data is `T | undefined` before its first successful evaluation.

## Set context

```ts
runtime.setContext(JobSeekerId, 123);
```

A changed context value synchronously marks transitive descendants stale, preserves their existing data, and aborts affected work. Subscribed stale descendants are scheduled automatically. An `Object.is` equal value is a no-op.

## Subscribe and observe

```ts
const subscription = runtime.subscribeNodes([PointPeriods]);
const stopObserving = runtime.onChange(() => {
  const state = runtime.getState(PointPeriods);
});

await runtime.whenSettled();

subscription.unsubscribe();
stopObserving();
```

A node subscription contributes direct ownership for its targets and required ownership for their ancestors. Registration schedules work in a microtask rather than invoking loaders synchronously. Cleanup functions are idempotent.

Inspect lifecycle and scheduler state:

```ts
runtime.getSubscriptionState(PointPeriods);
runtime.hasSubscribers(PointPeriods);
runtime.getSchedulerState();
```

`whenSettled()` resolves after automatic scheduler work becomes idle. It resolves after scheduler failure; inspect `getSchedulerState().error` for the result.

## Execute, prefetch, and refresh

Explicit execution:

```ts
await runtime.execute([CurrentPointPeriod]);
```

One-shot prefetch without persistent subscription ownership:

```ts
await runtime.prefetch([PointPeriods]);
```

Forced data or derived-node refresh:

```ts
await runtime.refresh([PointPeriods, CurrentPointPeriod]);
```

These operations include required ancestors, deduplicate matching active work, and reject with `GraphExecutionError` after independent executable branches settle. `prefetch()` and `refresh()` are caller-owned operations and must be awaited or have their rejection handled directly. They are not covered by `whenSettled()`.

A refresh retains previous successful data while loading. If refresh fails, the successful data remains available while the node exposes the new error and remains stale.

## Vue composables

### Injected runtime

Applications may install the graph runtime plugin:

```ts
app.use(createGraphRuntimePlugin(runtime));
```

Components can then use:

```ts
const periods = useNode(PointPeriods);
const query = useNodes([PointPeriods, CurrentPointPeriod]);
```

`useNode` exposes computed refs for `data`, `status`, `freshness`, `error`, and `hasSuccessfulValue`.

`useNodes` returns a tuple-preserving `results` collection plus aggregate refs:

```ts
interface UseNodesAggregate {
  readonly isLoading: ComputedRef<boolean>;
  readonly isError: ComputedRef<boolean>;
  readonly errors: ComputedRef<readonly Error[]>;
  readonly isSuccess: ComputedRef<boolean>;
}
```

`isSuccess` means every node has a successful value. It can be `true` at the same time as `isError` when a refresh fails after prior success.

### Explicit runtime

Applications that already own a runtime can pass it directly:

```ts
const periods = useNode(PointPeriods, { runtime });
const query = useNodes([PointPeriods, CurrentPointPeriod], { runtime });
```

The explicit runtime takes precedence over an injected runtime. Omitting it preserves plugin-based resolution and the existing missing-runtime error.

Both composables must run inside `setup()` or another active Vue effect scope. They create graph subscriptions on mount, update only when meaningful node state changes, and release observation and subscription ownership on scope disposal.

## Pinia-owned runtime

An application with Pinia already installed can expose the runtime through a setup store without changing `App.vue` or installing the graph runtime plugin:

```ts
export const useDependencyGraphStore = defineStore(
  "dependencyGraph",
  () => {
    const runtime = markRaw(createGraphRuntime(graph));
    return { runtime };
  }
);
```

```ts
const graphStore = useDependencyGraphStore();
const periods = useNode(PointPeriods, {
  runtime: graphStore.runtime,
});
```

Create the runtime inside the store factory so each Pinia instance owns an independent runtime. Keep graph definitions at module scope. Do not mirror graph node state into Pinia.

## Transaction seam

```ts
await runtime.transaction(async () => {
  runtime.setContext(JobSeekerId, 123);
  await someLocalWork();
});
```

The current transaction seam defers notification and automatic scheduling only. It does not yet stage graph state, provide rollback, or defer invalidation state changes. Atomic state transactions remain Milestone 5 work.

## Planned APIs

The following remain planned for later milestones:

```ts
defineEvent(...);
runtime.publish(...);
defineQuery(...);
useQuery(...);
pollUntil(...);
runtime.mutate(...);
```

Events, query groups, polling policies, optimistic mutations, diagnostics, snapshots, and devtools are not yet stable public APIs.
