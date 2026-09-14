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

Optionally cap concurrent data-node loads for one runtime:

```ts
const runtime = createGraphRuntime(graph, {
  maxConcurrentLoads: 6,
});
```

`maxConcurrentLoads` must be at least `1`. It limits only asynchronous `DataNodeDefinition.load()` calls. Derived nodes are synchronous and do not consume slots. The limit is shared across explicit execution, scheduler work, prefetch, and refresh within the runtime. Separate runtimes have separate limits. Omitting the option preserves unlimited concurrency.

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
await runtime.transaction(async transaction => {
  transaction.setContext(JobSeekerId, 123);
  await someLocalWork();
});
```

Atomic local context transactions use the explicit `GraphTransaction` handle. Calls to `transaction.setContext(...)` are held until the successful outer transaction completes, and public reads remain committed reads while work is open. Final values commit together, shared descendants invalidate once, and affected attempts abort after generation advancement. Synchronous or asynchronous failure discards staged context changes. `runtime.whenSettled()` observes the ordinary scheduler directly. Call it after awaiting a transaction when settlement must include work triggered by that transaction commit. Plain `runtime.execute(...)`, `runtime.prefetch(...)`, and `runtime.refresh(...)` calls remain available while another transaction is open. They read committed graph state and publish their results independently. These operations are intentionally absent from `GraphTransaction`. Overlapping transaction calls on one runtime join a single group: the first call is the root, all joined calls settle before the group closes, and the root outcome controls commit or rollback. Plain `runtime.setContext(...)` calls are always committed immediately, even while another transaction is open, and are not discarded by that transaction's rollback. If a transaction staged the same context before an independent write changed its committed generation, transaction commit rejects atomically with `GraphTransactionConflictError`. The independent value is preserved, and no staged context or event effect commits. Observer notification and automatic scheduling for these plain runtime operations are also immediate and are not held behind the unrelated transaction. Transactions do not provide backend rollback.

The transaction handle exposes only `setContext(...)` and `publish(...)`. It becomes invalid when the shared transaction group closes. Later use throws `Graph transaction is no longer active.`

Conflicting immediate writes are observable:

```ts
try {
  await runtime.transaction(async transaction => {
    transaction.setContext(JobSeekerId, 123);
    await localWork();
  });
} catch (error) {
  if (error instanceof GraphTransactionConflictError) {
    console.log(error.contextKeys);
  }
}
```

`GraphTransactionConflictError.contextKeys` is immutable and sorted deterministically. Conflict checking occurs before staged event predicates and graph mutation, so no staged context or event effect is partially applied.

## Typed event definitions

M6A implements typed event handles and node declarations. M6B adds graph validation and indexing. M6C implements immediate publication, and M6D implements transaction-aware publication.

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");

runtime.publish(AppointmentBooked, {
  jobSeekerId: 123,
  appointmentId: 456,
});
```

Data and derived nodes may declare unconditional or conditional `invalidatedBy` entries. Conditional predicates receive the typed `payload` and a `get(...)` function restricted to the node's declared dependencies. Events published through `transaction.publish(...)` are staged in call order. Successful commit evaluates predicates against final staged context values and applies one combined context/event invalidation commit. Rollback discards staged publications.

`defineEvent(...)`, `invalidatedBy`, graph validation, indexing, predicate matching, and immediate `runtime.publish(...)` invalidation are implemented. Transaction-aware publication is implemented with final combined validation pending. See `docs/implementation/52-milestone-6-implementation-summary.md`.

Publication invalidates matched nodes synchronously and schedules subscribed stale work through the existing scheduler. It is silent when no declaration matches. Predicate evaluation completes before mutation, so a predicate failure applies no partial event invalidation. Plain `runtime.publish(...)` is always immediate, even while another transaction is open. Only `transaction.publish(...)` is staged and follows the root transaction outcome. Observer notification and automatic scheduling for these plain runtime operations are also immediate and are not held behind the unrelated transaction.

## Query groups

Milestone 7 implements immutable query definitions as typed groups of existing nodes:

```ts
const AppointmentsPage = defineQuery({
  key: "appointments-page",
  nodes: {
    appointments: Appointments,
    capabilityStatus: CapabilityStatus,
  },
});

type AppointmentsPageNodes = QueryNodes<typeof AppointmentsPage>;
```

Aliases and exact node-handle types are retained. Query definitions own no runtime state and are not graph topology.

Vue consumers may subscribe to the complete query through its aliases:

```ts
const page = useQuery(AppointmentsPage, { runtime });

page.nodes.appointments.data.value;
page.nodes.capabilityStatus.status.value;
page.isLoading.value;
page.isError.value;
page.errors.value;
page.isSuccess.value;
```

Each aliased entry exposes the same computed refs as `useNode(...)`. Aggregate semantics, runtime resolution, effect-scope enforcement, and cleanup are consistent with `useNodes(...)`.

The same definition drives caller-owned prefetch and refresh:

```ts
await runtime.prefetchQuery(AppointmentsPage);
await runtime.refreshQuery(AppointmentsPage);

await page.prefetch();
await page.refresh();
```

Query prefetch delegates to the existing prefetch operation for every query node. Query refresh delegates to the existing refresh operation for data and derived query nodes; context aliases are excluded because context values change through `setContext(...)`. Both methods preserve existing execution, failure, concurrency, and transaction-ownership behaviour.

## Refresh policy definitions

Milestone 8A defines immutable refresh-policy metadata for data nodes. Runtime interpretation begins in Milestone 8B, so these declarations do not yet create timers or automatic refresh behaviour.

```ts
const Progress = defineDataNode({
  key: "progress",
  initialValue: undefined as ReportProgress | undefined,
  load: ({ signal }) => api.getProgress(signal),
  refresh: pollUntil<ReportProgress | undefined>({
    intervalMs: 2_000,
    timeoutMs: 600_000,
    stopWhen: value => value?.state === "completed",
    failWhen: value => value?.state === "failed",
  }),
});
```

Use `staleAfter(...)` for age-based policy metadata and `refreshInterval(...)` for repeating policy metadata. Interval and polling policies may declare fixed or exponential retry metadata. Policies are copied and frozen. Context and derived nodes do not accept refresh policies.

### Stale-after runtime behaviour

Milestone 8B activates `staleAfter(...)` for subscribed data nodes. A runtime schedules one refresh after the latest successful value reaches the declared age. Final unsubscribe clears the timer and aborts policy-only work. Resubscription reuses the remaining freshness duration.

```ts
const runtime = createGraphRuntime(graph, {
  refreshPolicyEnvironment,
});
```

`refreshPolicyEnvironment` is optional and primarily supports deterministic clocks in tests. The default uses platform timers. `whenSettled()` remains scheduler-specific and does not wait for future policy timers.

### Fixed interval while subscribed

Milestone 8C activates `refreshInterval(...)` for subscribed data nodes:

```ts
const Notifications = defineDataNode({
  key: "notifications",
  initialValue: [] as Notification[],
  load: ({ signal }) => api.getNotifications(signal),
  refresh: refreshInterval({ intervalMs: 60_000 }),
});
```

The runtime starts one timeout after successful work settles. Timer expiry delegates to the existing refresh and execution path. The next timeout begins only after successful policy work settles, so slow requests do not overlap. Final unsubscribe clears the timer, and resubscription starts a clean full interval.

Retry metadata remains inert until M8E. A failed interval refresh retains existing stale data and suspends automatic interval work until a later external execution succeeds.

### Poll until completion

Milestone 8D activates `pollUntil<TValue>(...)` for subscribed data nodes:

```ts
const ReportProgress = defineDataNode({
  key: "reportProgress",
  initialValue: undefined as Progress | undefined,
  load: ({ signal }) => api.getProgress(signal),
  refresh: pollUntil<Progress | undefined>({
    intervalMs: 2_000,
    timeoutMs: 600_000,
    failWhen: value => value?.state === "failed",
    stopWhen: value => value?.state === "completed",
  }),
});
```

Every successful value is evaluated in failure, completion, timeout order. Completion leaves the successful value fresh. Business failure, predicate exception, and timeout preserve the latest successful value but expose a terminal error and stale freshness.

Exported terminal error types are `GraphPollingConditionError` and `GraphPollingTimeoutError`. Retry metadata remains inert until M8E.

## Other planned APIs

```ts
pollUntil(...);
runtime.mutate(...);
```

Polling policies, optimistic mutations, diagnostics, snapshots, and devtools are not yet stable public APIs. Query-group implementation is complete with final combined validation pending.
