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

Graph registration is order independent and validates keys, duplicate dependencies, missing dependencies, and cycles.

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
const unsubscribe = runtime.subscribe(() => {
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

Automatic demand-driven execution is Milestone 3. Transactions are Milestone 4. Vue integration, query groups, events, polling, and mutations follow later milestones.
