# Public API

## Package entry points

The package has no root export. Import from the explicit entry point that owns the capability:

```ts
import { createGraph, createGraphRuntime } from "vue-dependency-graph/core";
import { createGraphRuntimePlugin, useNode } from "vue-dependency-graph/vue";
import { GraphDevtoolsPanel } from "vue-dependency-graph/devtools";
```

- `vue-dependency-graph/core` contains framework-independent graph, runtime, policy, mutation, transaction, query, and diagnostic contracts.
- `vue-dependency-graph/vue` contains Vue composables, plugin integration, and the browser timer environment.
- `vue-dependency-graph/devtools` contains the single supported `GraphDevtoolsPanel`, devtools composables, and framework-independent protocol transforms.

Importing directly from `vue-dependency-graph` is not supported.

## Define nodes

Node definitions are immutable typed handles. Mutable values and execution state belong to a `GraphRuntime`.

```ts
const CurrentProductId = defineContextNode<string | undefined>({
  key: "currentProductId",
  initialValue: undefined,
});

const ProductReviews = defineDataNode({
  key: "productReviews",
  dependencies: [CurrentProductId] as const,
  initialValue: [] as Review[],
  load: ({ get, signal }) => api.getReviews(get(CurrentProductId), signal),
});

const FeaturedReview = defineDerivedNode({
  key: "featuredReview",
  dependencies: [ProductReviews] as const,
  derive: ({ get }) => get(ProductReviews).find((review) => review.isFeatured),
});
```

Context nodes hold mutable graph inputs. Data nodes perform asynchronous work. Derived nodes calculate synchronously from successful dependencies.

## Create a graph and runtime

```ts
const graph = createGraph({
  nodes: [FeaturedReview, ProductReviews, CurrentProductId],
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
const state = runtime.getState(ProductReviews);
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
runtime.setContext(CurrentProductId, "prod-42");
```

A changed context value synchronously marks transitive descendants stale, preserves their existing data, and aborts affected work. Subscribed stale descendants are scheduled automatically. An `Object.is` equal value is a no-op.

## Subscribe and observe

```ts
const subscription = runtime.subscribeNodes([ProductReviews]);
const stopObserving = runtime.onChange(() => {
  const state = runtime.getState(ProductReviews);
});

await runtime.whenSettled();

subscription.unsubscribe();
stopObserving();
```

A node subscription contributes direct ownership for its targets and required ownership for their ancestors. Registration schedules work in a microtask rather than invoking loaders synchronously. Cleanup functions are idempotent.

A listener that throws never breaks the runtime: the failure is isolated from the other listeners and from the code that triggered the change. When diagnostics are enabled it is reported as a `runtime.listener-failed` event (see below); with diagnostics disabled it is not reported anywhere.

Inspect lifecycle and scheduler state:

```ts
runtime.getSubscriptionState(ProductReviews);
runtime.hasSubscribers(ProductReviews);
runtime.getSchedulerState();
```

`whenSettled()` resolves after automatic scheduler work becomes idle. It resolves after scheduler failure; inspect `getSchedulerState().error` for the result.

## Execute, prefetch, and refresh

Explicit execution:

```ts
await runtime.execute([FeaturedReview]);
```

One-shot prefetch without persistent subscription ownership:

```ts
await runtime.prefetch([ProductReviews]);
```

Forced data or derived-node refresh:

```ts
await runtime.refresh([ProductReviews, FeaturedReview]);
```

These operations include required ancestors, deduplicate matching active work, and reject with `GraphExecutionError` after independent executable branches settle. `prefetch()` and `refresh()` are caller-owned operations and must be awaited or have their rejection handled directly. They are not covered by `whenSettled()`.

A refresh retains previous successful data while loading. If refresh fails, the successful data remains available while the node exposes the new error and remains stale.

## Vue composables

### Injected runtime

Applications may install the graph runtime plugin:

```ts
app.use(createGraphRuntimePlugin(runtime));
```

The plugin disposes the runtime (`runtime.dispose()`) when the app unmounts. Pass `createGraphRuntimePlugin(runtime, { disposeOnUnmount: false })` if the runtime is shared between apps or owned elsewhere.

`useGraphRuntime()` returns the runtime installed by the nearest plugin provider:

```ts
import { useGraphRuntime } from "vue-dependency-graph/vue";

const runtime = useGraphRuntime();
```

Call it inside `setup()` or another active Vue injection context. It throws `GraphRuntime was not provided` when no runtime has been installed. Use it when a component or composable needs direct access to runtime operations; prefer `useNode(...)`, `useNodes(...)`, or `useQuery(...)` for reactive graph state.

Components can then use:

```ts
const reviews = useNode(ProductReviews);
const query = useNodes([ProductReviews, FeaturedReview]);
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
const reviews = useNode(ProductReviews, { runtime });
const query = useNodes([ProductReviews, FeaturedReview], { runtime });
```

The explicit runtime takes precedence over an injected runtime. Omitting it preserves plugin-based resolution and the existing missing-runtime error.

Both composables must run inside `setup()` or another active Vue effect scope. They create graph subscriptions on mount, update only when meaningful node state changes, and release observation and subscription ownership on scope disposal.

## Pinia-owned runtime

An application with Pinia already installed can expose the runtime through a setup store without changing `App.vue` or installing the graph runtime plugin:

```ts
export const useDependencyGraphStore = defineStore("dependencyGraph", () => {
  const runtime = markRaw(createGraphRuntime(graph));
  onScopeDispose(() => runtime.dispose());
  return { runtime };
});
```

```ts
const graphStore = useDependencyGraphStore();
const reviews = useNode(ProductReviews, {
  runtime: graphStore.runtime,
});
```

Create the runtime inside the store factory so each Pinia instance owns an independent runtime, and dispose it with `onScopeDispose` so it is released on `store.$dispose()` or `disposePinia(pinia)`. Keep graph definitions at module scope. Do not mirror graph node state into Pinia.

## Transactions

Use the callback handle for all work that belongs to one atomic local graph transaction:

```ts
const result = await runtime.transaction(async (transaction) => {
  transaction.setContext(CurrentProductId, "prod-42");
  transaction.publish(StockChanged, payload);
  return "committed";
});
```

Context changes and event publications remain staged until the callback completes successfully. Commit validates the generation captured when each context was first staged. A conflict rejects with `GraphTransactionConflictError` and applies none of the session's context or event effects.

Every top-level `runtime.transaction(...)` call creates an independent session. Overlapping calls do not join automatically, do not share staged work, and do not share commit or rollback outcomes.

Use `transaction.transaction(...)` only when work must join the same atomic boundary:

```ts
await runtime.transaction(async (transaction) => {
  transaction.setContext(ContextA, valueA);

  await transaction.transaction(async (nested) => {
    nested.setContext(ContextB, valueB);
    nested.publish(DomainChanged, payload);
  });
});
```

The nested callback uses the same session. If its failure escapes the outer callback, the session rolls back. If the outer callback catches the failure, the outer callback may continue and commit.

Plain runtime operations remain independent while a transaction is open:

```ts
const pending = runtime.transaction(async (transaction) => {
  transaction.setContext(ContextA, stagedValue);
  await gate;
});

runtime.setContext(ContextB, immediateValue);
runtime.publish(UnrelatedEvent, payload);
await runtime.refresh([SomeNode]);
```

Those operations use committed state and dispatch notifications and scheduler work immediately.

`runtime.dispose()` stops the runtime's refresh-policy and release-policy timers and detaches the refresh policy from the timer environment's pause signal. It is idempotent and does not abort in-flight loads or reject later calls. Call it when the runtime's owner is torn down.

`runtime.whenSettled()` is scheduler-specific. For transaction-triggered scheduler work, await in this order:

```ts
await runtime.transaction((transaction) => {
  transaction.setContext(ContextA, valueA);
});
await runtime.whenSettled();
```

An open transaction that has not committed has not requested scheduler work and does not keep `whenSettled()` pending.

## Typed event definitions

Typed event handles provide compile-time payload safety for local graph invalidation.

```ts
const StockChanged = defineEvent<{
  productId: string;
  inStock: boolean;
}>("stock.changed");

runtime.publish(StockChanged, {
  productId: "prod-1",
  inStock: false,
});
```

Data and derived nodes may declare unconditional or conditional `invalidatedBy` entries. Conditional predicates receive the typed `payload` and a `get(...)` function restricted to the node's declared dependencies. Events published through `transaction.publish(...)` are staged in call order. Successful commit evaluates predicates against final staged context values and applies one combined context/event invalidation commit. Rollback discards staged publications.

Publication invalidates matched nodes synchronously and schedules subscribed stale work through the existing scheduler. It is silent when no declaration matches. Predicate evaluation completes before mutation, so a predicate failure applies no partial event invalidation. Plain `runtime.publish(...)` is always immediate, even while another transaction is open. Only `transaction.publish(...)` is staged and follows its owning transaction session outcome. Observer notification and automatic scheduling for these plain runtime operations are also immediate and are not held behind the unrelated transaction.

After confirmed mutation success, `effects.publish(...)` may publish a typed event as part of the mutation's prepared local success commit. Mutation events are not published during optimistic application, remote rejection, unknown outcome, or failed success preparation. Event delivery is local to one `GraphRuntime`; cross-tab, server, durable replay, and exactly-once delivery remain application concerns.

## Query groups

Immutable query definitions group existing nodes without adding topology or query-owned runtime state:

```ts
const ProductPage = defineQuery({
  key: "product-page",
  nodes: {
    reviews: ProductReviews,
    featuredReview: FeaturedReview,
  },
});

type ProductPageNodes = QueryNodes<typeof ProductPage>;
```

Aliases and exact node-handle types are retained. Query definitions own no runtime state and are not graph topology.

Vue consumers may subscribe to the complete query through its aliases:

```ts
const page = useQuery(ProductPage, { runtime });

page.nodes.reviews.data.value;
page.nodes.featuredReview.status.value;
page.isLoading.value;
page.isError.value;
page.errors.value;
page.isSuccess.value;
```

Each aliased entry exposes the same computed refs as `useNode(...)`. Aggregate semantics, runtime resolution, effect-scope enforcement, and cleanup are consistent with `useNodes(...)`.

The same definition drives caller-owned prefetch and refresh:

```ts
await runtime.prefetchQuery(ProductPage);
await runtime.refreshQuery(ProductPage);

await page.prefetch();
await page.refresh();
```

Query prefetch delegates to the existing prefetch operation for every query node. Query refresh delegates to the existing refresh operation for data and derived query nodes; context aliases are excluded because context values change through `setContext(...)`. Both methods preserve existing execution, failure, concurrency, and transaction-ownership behaviour.

## Refresh policy definitions

Data nodes may declare immutable refresh-policy metadata. Each runtime interprets that metadata and owns its timers and policy sessions.

```ts
const OrderStatus = defineDataNode({
  key: "orderStatus",
  initialValue: undefined as Order | undefined,
  load: ({ signal }) => api.getOrderStatus(signal),
  refresh: pollUntil<Order | undefined>({
    intervalMs: 2_000,
    timeoutMs: 600_000,
    stopWhen: (value) => value?.status === "shipped",
    failWhen: (value) => value?.status === "cancelled",
  }),
});
```

Use `staleAfter(...)` for age-based policy metadata and `refreshInterval(...)` for repeating policy metadata. Interval and polling policies may declare fixed or exponential retry metadata. Policies are copied and frozen. Context and derived nodes do not accept refresh policies.

### Stale-after runtime behaviour

`staleAfter(...)` refreshes subscribed data nodes when their latest successful value reaches the configured age. A runtime schedules one refresh after the latest successful value reaches the declared age. Final unsubscribe clears the timer and aborts policy-only work. Resubscription reuses the remaining freshness duration.

```ts
const runtime = createGraphRuntime(graph, {
  timerEnvironment,
});
```

`timerEnvironment` is optional and primarily supports deterministic clocks in tests - the same environment also backs release policies (see "Release policies" below), so tests only need to fake one clock for both. The default uses platform timers. `whenSettled()` remains scheduler-specific and does not wait for future policy timers.

### Fixed interval while subscribed

`refreshInterval(...)` repeatedly refreshes subscribed data nodes after each successful policy cycle settles:

```ts
const Inventory = defineDataNode({
  key: "inventory",
  initialValue: undefined as StockLevel | undefined,
  load: ({ signal }) => api.getInventory(signal),
  refresh: refreshInterval({ intervalMs: 60_000 }),
});
```

The runtime starts one timeout after successful work settles. Timer expiry delegates to the existing refresh and execution path. The next timeout begins only after successful policy work settles, so slow requests do not overlap. Final unsubscribe clears the timer, and resubscription starts a clean full interval.

A failed interval refresh retains existing stale data and applies the configured bounded retry policy. Retry exhaustion suspends automatic interval work until a later external successful execution starts a new cycle.

### Poll until completion

`pollUntil<TValue>(...)` repeatedly refreshes subscribed data nodes until completion, business failure, or timeout:

```ts
const OrderStatus = defineDataNode({
  key: "orderStatus",
  initialValue: undefined as Order | undefined,
  load: ({ signal }) => api.getOrderStatus(signal),
  refresh: pollUntil<Order | undefined>({
    intervalMs: 2_000,
    timeoutMs: 600_000,
    failWhen: (value) => value?.status === "cancelled",
    stopWhen: (value) => value?.status === "shipped",
  }),
});
```

Every successful value is evaluated in failure, completion, timeout order. Completion leaves the successful value fresh. Business failure, predicate exception, and timeout preserve the latest successful value but expose a terminal error and stale freshness.

Exported terminal error types are `GraphPollingConditionError` and `GraphPollingTimeoutError`. Configured retry applies to retryable policy refresh failures before terminal exhaustion.

### Retry and lifecycle environment

Interval and poll-until policies apply their declared fixed or exponential retry metadata to policy-owned failures. Exhaustion exposes `GraphRefreshRetryExhaustedError` while retaining prior successful data.

Core runtimes use `TimerEnvironment` for clocks, timeouts, randomness, and pause state:

```ts
import { createDefaultTimerEnvironment, type TimerEnvironment } from "vue-dependency-graph/core";

const environment: TimerEnvironment = createDefaultTimerEnvironment();
const runtime = createGraphRuntime(graph, { timerEnvironment: environment });
```

`createDefaultTimerEnvironment()` uses the platform clock, `setTimeout`, `clearTimeout`, and `Math.random`, and is never paused. Applications normally omit it because `createGraphRuntime(...)` creates the default automatically. Tests may inject a deterministic implementation, and browser applications may use the Vue adapter below.

The Vue entry point provides an optional browser adapter:

```ts
const runtime = createGraphRuntime(graph, {
  timerEnvironment: createBrowserTimerEnvironment(),
});
```

It pauses policy timers while the document is hidden or the browser is offline. Resume restores one remaining delay without replaying missed ticks. Poll timeout excludes paused duration.

## Release policies

`release` metadata for data nodes is interpreted by a runtime-local release-policy controller built on the same `timerEnvironment` used by refresh policies:

```ts
import { releaseAfter, retain } from "vue-dependency-graph/core";

const ProductDetails = defineDataNode({
  key: "productDetails",
  initialValue: undefined as Product | undefined,
  load: ({ signal }) => api.getProduct(signal),
  release: releaseAfter({ durationMs: 60_000 }),
});
```

```ts
const runtime = createGraphRuntime(graph, { releaseAfterMs: 5 * 60_000 });
```

Resolution order per node: its own `release` if declared, else the runtime's `releaseAfterMs`, else no automatic release. `retain()` opts a node out even when the runtime has a default. Context and derived nodes cannot declare a release policy - `createGraph` rejects that (`GraphValidationError` with code `INVALID_RELEASE_POLICY`), the same way it already rejects a stray `refresh` on a non-data node.

The controller starts a node's timer the moment it has no subscribers at all - direct or required (`hasSubscribers`, not the scheduler's own `hasDirectSubscribers`) - and only once it currently holds a successful value. Resubscribing before the timer fires cancels it with no other effect. When the timer fires, the node resets to its never-executed shape (`data` back to `initialValue`, no successful value, `status: "idle"`, `freshness: "stale"`) and its `generation` is bumped, so a later resubscribe goes through the same fresh-execution path as a node that has simply never run.

A release emits a `node.value-released` diagnostic event (`{ operationId, nodeKey, idleMs }`), visible in the devtools Timeline under its own "release" category. See [ADR-016](../decisions/ADR-016-value-release-policies.md) for the full design, including the alternatives considered and why this is timer-based rather than, for example, a count-bounded LRU buffer.

## Mutation definitions and execution

Immutable typed mutation definitions represent caller-owned remote execution:

```ts
interface AddToCartInput {
  readonly productId: string;
  readonly quantity: number;
}

interface Cart {
  readonly cartId: string;
  readonly items: readonly { productId: string; quantity: number }[];
}

const AddToCart = defineMutation({
  key: "cart.add",
  execute: async ({ input, signal }: MutationExecuteContext<AddToCartInput>) =>
    api.addToCart(input, signal),
});

const result = await runtime.mutate(AddToCart, {
  productId: "prod-1",
  quantity: 1,
});
```

`defineMutation(...)` validates the key and execute function, returns a frozen definition, and retains input and asynchronous result types. `MutationInput<TMutation>` and `MutationResult<TMutation>` extract those types.

`runtime.mutate(...)` creates one caller-owned mutation attempt, passes the exact input and an attempt-scoped `AbortSignal`, and returns the remote result. Each call is independent. A basic call does not deduplicate, retry, reconcile graph data, invalidate nodes, publish events, apply optimistic state, or consume the data-load concurrency limit.

A plain mutation call remains independent while a graph transaction is open. It cannot read staged transaction state and its result is not committed or rolled back by that transaction.

### Direct success reconciliation

Optional synchronous success effects reconcile graph state after confirmed remote success:

```ts
const result = await runtime.mutate(AddToCart, input, {
  onSuccess: (effects, saved, originalInput) => {
    effects.update(Cart, () => saved);
    effects.update(CartSummary, (current) => ({
      ...current,
      itemCount: saved.items.length,
    }));
  },
});
```

`effects.update(...)` accepts registered data nodes only and preserves each node's value type in its updater. Every target must already have a successful value. Placeholder `initialValue` data is not treated as successful server state.

Mutation update functions are pure replacement functions. They must treat `current` and nested values reachable from it as read-only and return the intended replacement value. Development and test builds protect plain arrays and plain objects with recursive read-only views. A detected direct or nested write rejects with `GraphMutationStateError` before any mutation effect commits. Production builds omit this guard overhead, so purity remains an application contract. Non-plain values such as `Date`, `Map`, `Set`, class instances, and platform objects are not recursively protected.

The callback and all updaters are synchronous. The runtime records and validates the complete draft before mutation. Duplicate writes to one node, malformed targets, a missing successful value, callback failure, or updater failure apply no mutation-owned graph change.

Effective updates commit together. Each changed target:

- receives the replacement value;
- becomes successful and fresh;
- clears its error;
- advances generation once;
- aborts obsolete active work after generation advancement.

Descendants of changed results are invalidated once across all updated roots. A descendant that is also directly updated remains fresh rather than being invalidated by another updated root. Subscribed stale descendants reload through the existing scheduler. Observers receive one coherent mutation commit notification before scheduler work begins.

An `Object.is` equal update to an already successful, fresh, error-free node is silent. The remote mutation result is still returned.

If remote execution succeeded but local reconciliation fails, `runtime.mutate(...)` rejects with the reconciliation error. This does not imply that the remote command was rolled back.

### Success invalidation and typed publication

The same success-effect callback may also invalidate nodes and publish typed events:

```ts
const CartUpdated = defineEvent<{ cartId: string; itemCount: number }>("cart.updated");

await runtime.mutate(AddToCart, input, {
  onSuccess: (effects, saved) => {
    effects.update(Cart, () => saved);
    effects.invalidate([Inventory]);
    effects.publish(CartUpdated, {
      cartId: saved.cartId,
      itemCount: saved.items.length,
    });
  },
});
```

`effects.invalidate(...)` accepts registered data and derived nodes. Context nodes remain writable only through the context APIs. Duplicate invalidation roots are harmless and their graph effects are deduplicated.

`effects.publish(...)` preserves the typed event payload. Publications are evaluated only after confirmed remote success. Predicate matching occurs before graph mutation and can read final direct-update values from the same success draft. A predicate failure applies no mutation-owned update, invalidation, event effect, notification, or scheduling.

A mutation event predicate may not read a derived dependency affected by the mutation's optimistic targets, a direct success update, or explicit invalidation. Such a read would observe the previous committed derived value, so preparation rejects before any success effect commits. Directly updated data dependencies remain readable through the overlay, and unaffected derived dependencies remain readable from committed state. Normal runtime and transaction event publication retain their existing predicate semantics.

Direct updates, explicit invalidation, event targets, and all descendants form one local commit. Every affected node advances generation at most once. Active work is aborted only after affected generations advance. Observers receive one coherent notification and subscribed stale work requests at most one scheduler pass.

When one node is both directly updated and invalidated, the response value is retained as successful stale data. This supports immediate display while an authoritative reload proceeds. A direct update that is reached as the descendant of another changed or invalidated root follows the same stale-result rule.

Remote rejection skips `onSuccess` entirely, so no success invalidation or event publication occurs.

### Optimistic updates and known rejection

An optional optimistic update callback and failure classifier provide guarded optimistic behaviour:

```ts
await runtime.mutate(AddToCart, input, {
  optimistic: (effects, originalInput) => {
    effects.update(Cart, (current) => ({
      ...current,
      items: [...current.items, { productId: originalInput.productId, quantity: originalInput.quantity }],
    }));
  },
  onSuccess: (effects, saved) => {
    effects.update(Cart, () => saved);
  },
  classifyFailure: (error) =>
    error instanceof Error && error.message === "OUT_OF_STOCK" ? "rejected" : "unknown",
});
```

The optimistic callback exposes direct data-node updates only. It runs before remote execution, must be synchronous, and uses the same successful-value, target-kind, duplicate-target, and updater validation as success reconciliation. Invalid optimistic work rejects before the remote request starts.

Effective optimistic values commit atomically as successful fresh data. Changed-result descendants are invalidated through the existing graph path. The runtime captures complete target and affected-descendant snapshots before commit.

Optimistic invalidation immediately participates in normal subscription scheduling. Subscribed derived descendants may recompute and subscribed data descendants may reload before the remote mutation settles. Data descendants continue to use `maxConcurrentLoads`; mutation execution remains outside that limiter. A changed data descendant that settles before known rejection is treated as newer graph state, so snapshot rollback is skipped and `GraphMutationRollbackConflictError` preserves that descendant. An active descendant that has not settled remains eligible for safe rollback and is made obsolete by generation advancement before abort.

Only one unresolved optimistic mutation may own a data node. A same-node conflict rejects with `GraphMutationConflictError` before the conflicting request starts. Disjoint optimistic work remains independent.

A failure classified as `rejected` restores the complete captured snapshots atomically and preserves the original remote error. Successful completion does not perform a transient rollback. It retains the optimistic value when no success update replaces it, or applies the prepared confirmed-success effects directly over optimistic state.

A missing classifier defaults to `unknown`. Classifier exceptions and unsupported runtime classifier results also take the safe unknown path.

For an unknown outcome, optimistic values are retained, affected targets and descendants become stale, obsolete work is aborted, and subscribed stale nodes reconcile through the existing scheduler. The mutation rejects with `GraphMutationOutcomeUnknownError`; its immutable sorted `nodeKeys` identify affected optimistic state and its `cause` is the original remote error.

Known-rejection rollback requires both optimistic ownership and the expected post-optimistic generation for every captured target and descendant. If newer graph work changed any captured node, no snapshot is restored. Current values are retained as stale for authoritative reconciliation and the mutation rejects with `GraphMutationRollbackConflictError`. Its immutable sorted `nodeKeys` identify conflicts and its `cause` is the original rejection.

When rollback is safe, the runtime restores the prior logical state fields but does not restore old generation numbers. Every restored target and descendant advances to a new generation before active work is aborted. Generations therefore remain monotonic, and work made obsolete by optimistic application cannot become current again after rollback.

After safe rollback, the runtime requests one scheduler pass when any restored snapshot is stale and currently subscribed. Fresh restored snapshots and stale unsubscribed snapshots do not schedule work. `whenSettled()` includes rollback-triggered scheduler work.

If remote execution succeeds but optimistic success reconciliation fails, the runtime does not roll back a command that may already be committed. It retains the optimistic values, marks every captured target and descendant stale, advances generations, aborts obsolete work, releases optimistic ownership, and schedules subscribed authoritative reconciliation. The mutation rejects with `GraphMutationReconciliationError`, whose immutable sorted `nodeKeys` identify affected state, `mutationKey` identifies the command definition, `remoteSucceeded` is `true`, and `cause` preserves the local reconciliation failure. Non-optimistic success-reconciliation failures continue to reject with their original local error.

Context changes, event invalidation, refresh, polling, independent mutations, and transactions remain independent while mutation work is pending. Their newer graph state is never overwritten by an obsolete rollback snapshot.

Mutation retry, offline queues, layered same-node optimistic updates, and built-in idempotency-key management remain outside the current mutation API.

## Diagnostics and observability

### Runtime diagnostics foundation

Configure optional structured diagnostics when constructing the runtime:

```ts
const events: GraphDiagnosticEvent[] = [];
const runtime = createGraphRuntime(graph, {
  diagnostics: {
    sink: {
      emit: (event) => events.push(event),
    },
  },
});
```

Diagnostics are disabled when no sink is supplied. A configured sink receives immutable events synchronously in runtime-local sequence order. Sink failures are isolated and do not change runtime state, operation results, observer notification, scheduling, or settlement.

The foundation event set includes:

- `runtime.created` after runtime-local diagnostic identity is created;
- `operation.execute.requested`;
- `operation.prefetch.requested`;
- `operation.refresh.requested`;
- `operation.query-prefetch.requested`;
- `operation.query-refresh.requested`.

`runtime.listener-failed` is emitted when a change listener throws while the runtime is notifying - an application's `onChange` subscriber, or one of the runtime's own background policies, which listen the same way (a refresh policy that cannot arm its timer, for example). It carries `error: { name, message }` and, when the notification happened while an operation was being committed, that operation's `operationId`. The failure itself stays isolated: other listeners still run and runtime state is unaffected. The devtools Timeline shows it as a failed runtime entry.

Operation-request events contain immutable requested node keys and a deterministic runtime-local operation ID. Query operation events also contain the query key. These events record caller intent; execution, scheduling, subscription, invalidation, reuse, skip, queue, and outcome events complete the causal trace.

Tests may provide a deterministic diagnostics environment:

```ts
const runtime = createGraphRuntime(graph, {
  diagnostics: {
    sink,
    environment: {
      now: () => clock.now,
      createRuntimeId: () => "test-runtime",
    },
  },
});
```

Default runtime IDs are runtime-local diagnostic labels. They are not distributed tracing identifiers or guaranteed to be globally unique across processes, tabs, or application sessions.

#### Core execution causality

The diagnostic stream covers ordinary graph execution:

- subscription add and remove;
- scheduler request, start, completion, and failure;
- context changes and changed-result invalidation;
- fresh-value skips and active-attempt reuse;
- concurrency queue admission;
- data-node load start, success, failure, abort, and discarded result;
- derived-node start, success, and failure;
- dependency-blocked nodes.

Every node execution event contains the node key, node kind, generation, execution origin, reason, and runtime-local operation ID. Scheduler-owned execution also carries a `causeId` linking it to the subscription or invalidation operation that requested scheduling.

Execution origin and reason are intentionally separate. Origin identifies ownership such as `scheduler`, `prefetch`, or `refresh`. Reason explains why work was required, such as `subscription`, `context-invalidation`, `changed-result`, or `dependency`.

```ts
const event = events.find((event) => event.type === "node.load.started");

if (event?.type === "node.load.started") {
  console.log(event.nodeKey, event.origin, event.reason);
}
```

Errors are represented by immutable `{ name, message }` records. Diagnostic events do not expose loaded values, context values, event payloads, mutation inputs, or mutation results.

#### Advanced lifecycle diagnostics

Structured records also cover typed events, transactions, refresh policies, polling, release, and mutations.

Typed event records contain the event key, whether publication was transaction-owned, and matched node keys. Event payloads are never included.

Transaction records include start and one terminal outcome:

- `transaction.committed`;
- `transaction.rolled-back`;
- `transaction.conflicted`.

Transaction diagnostics do not expose staged context values or event payloads. Conflict records include immutable conflict keys and safe error details.

Refresh-policy records cover scheduling, start, retry scheduling, pause, resume, completion, failure, and stop. They contain policy metadata such as node key, policy kind, and delay where applicable, but not loaded values.

Mutation records cover request start, effective optimistic commit, remote start and settlement, successful local commit, rollback, rollback conflict, unknown outcome, reconciliation failure, and terminal completion. Mutation inputs and results are never included.

#### In-memory diagnostics and metrics

An optional bounded collector implements `GraphDiagnosticSink`:

```ts
const diagnostics = createInMemoryGraphDiagnostics({ capacity: 500 });
const runtime = createGraphRuntime(graph, {
  diagnostics: { sink: diagnostics },
});

const recentEvents = diagnostics.getEvents();
const metrics = diagnostics.getMetrics();
```

`capacity` must be a positive integer. The collector retains the newest events in insertion order and reports how many older records were dropped. Metrics are updated cumulatively as events arrive, so eviction does not reduce historical counts or durations.

The metrics snapshot includes operation counts, per-node attempt outcomes and durations, current and maximum active data loads, queue counts and wait duration, fresh-value skips, active-attempt reuse, invalidation sources, scheduler outcomes, refresh-policy outcomes, transaction outcomes and durations, mutation outcomes and durations, current subscription totals, and dropped-event count.

`getEvents()` and `getMetrics()` return immutable snapshots. `reset()` clears only retained collector state and cumulative metrics. It does not alter a runtime, graph state, subscriptions, scheduler work, policies, or mutation work.

A collector may be owned by one runtime or deliberately shared by multiple runtimes. Events preserve their runtime IDs while metrics aggregate the received stream.

#### Diagnostic snapshots and value safety

`runtime.createDiagnosticSnapshot()` returns an immutable, versioned `GraphDiagnosticSnapshotV1`. The snapshot contains graph topology, node runtime state, scheduler state, subscription counts, refresh-policy state, optional collector metrics, and retained/dropped diagnostic counts.

Node values are omitted by default. A node can explicitly include its value or provide a strongly typed synchronous redactor:

```ts
const customerProfile = defineContextNode({
  key: "customerProfile",
  initialValue: { name: "Jordan Smith", accountId: "sensitive" },
  diagnostics: {
    value: (value) => ({ name: value.name }),
  },
});
```

Supported value policies are `"omit"`, `"include"`, or a redactor function. Included and redacted values must be safely serialisable primitives, arrays, or plain objects. Cyclic, non-finite, function, symbol, bigint, and non-plain object values are omitted safely. Redactor exceptions produce a `redaction-failed` marker and safe error details instead of failing snapshot creation.

Runtime and scheduler errors use bounded `{ name, message, cause }` serialisation. Cyclic or over-depth causes are marked `truncated`. Stack traces are not included.

Snapshot construction is observational. It does not notify observers, schedule work, emit diagnostic events, or mutate graph-owned values and errors.

#### Stable diagnostic normalisation

Public pure normalisers support deterministic tests and offline comparisons:

```ts
const normalizedSnapshot = normalizeDiagnosticSnapshot(snapshot);
const normalizedEvents = normalizeDiagnosticEvents(events);
const normalizedExport = normalizeDiagnosticExport({ snapshot, events });
```

Normalisation replaces volatile timestamps, runtime IDs, operation IDs, cause IDs, timer due times, and duration totals with deterministic values. Operation and cause IDs are aliased consistently in first-seen order, so causal relationships remain visible.

Sequence order, event types, node and event keys, generations, reasons, origins, outcomes, errors, redaction markers, values explicitly approved for diagnostics, counts, and graph state remain unchanged. The functions return new immutable values and never mutate their input. Normalising an already normalised value is stable.

#### Runtime Observability playground

The playground includes a dedicated Runtime Observability scenario. It owns an isolated runtime and bounded collector, then demonstrates subscription-driven initial loading, context invalidation, explicit refresh, request failure and recovery, transaction rollback, mutation completion, recent events, cumulative metrics, redacted snapshot preview, and JSON export.

Reset disposes the existing subscription and creates a clean runtime, collector, identifier sequence, and metrics baseline. Leaving the scenario also disposes its dedicated subscription. The scenario is an executable behaviour demonstration; the reusable inspector contract belongs to the devtools protocol described below.

## Devtools

The `vue-dependency-graph/devtools` entry point provides an embeddable devtools panel built on the diagnostics foundation above. See [ADR-015](../decisions/ADR-015-devtools-inspector-protocol.md) for the protocol and embedding decision, and [Observability, devtools, and snapshots](../architecture/06-observability-devtools-and-snapshots.md) for the current architecture.

### Panel

`GraphDevtoolsPanel` is the only supported public panel component. Its internal Graph, Node, Timeline, and Metrics views are implementation details rather than separately supported component exports.

```vue
<script setup lang="ts">
import { GraphDevtoolsPanel } from "vue-dependency-graph/devtools";
import { runtime, diagnostics } from "./graph/runtime"; // the same collector passed as diagnostics.sink
</script>

<template>
  <GraphDevtoolsPanel :runtime="runtime" :diagnostics="diagnostics" />
</template>
```

`diagnostics` must be the same `InMemoryGraphDiagnostics` instance passed as `createGraphRuntime`'s `diagnostics.sink` option - the panel has nothing to show without one, and doesn't create one implicitly. The panel has four tabs (Graph, Node, Timeline, Metrics), an **Export snapshot** button that downloads the current state as JSON, and a **Load snapshot** button that loads a previously exported file into the same views with no live runtime attached ("viewing offline snapshot" mode, with a **Return to live** button to switch back).

### Composables

For a custom UI instead of the pre-built panel:

```ts
import { useGraphDevtools } from "vue-dependency-graph/devtools";

const {
  graphView, // ComputedRef<InspectorGraphView>
  timeline, // ComputedRef<readonly InspectorTimelineEntry[]>
  metricsView, // ComputedRef<InspectorMetricsView>
  selectedNodeKey, // Ref<string | undefined>
  selectedNodeDetail, // ComputedRef<InspectorNodeDetail | undefined>
  select, // (key: string | undefined) => void
  exportSnapshot, // () => string (pretty-printed JSON)
} = useGraphDevtools({ runtime, diagnostics });
```

Must be called inside `setup()` or an active effect scope, same requirement as `useNode`. Updates are coalesced into one microtask per burst of runtime activity, the same idiom the runtime's own scheduler uses internally.

`useOfflineDevtoolsSnapshot()` is the same shape without a runtime - `loadFromJson(json)` loads a previously exported file (throwing `InvalidDevtoolsExportError` for anything that isn't one), `clear()` resets it.

### Protocol

The data transformation from a diagnostic snapshot/event stream into the view models above is exported as pure, framework-agnostic functions with no Vue dependency - the panel is one consumer of this, not the layer itself:

```ts
import {
  computeGraphView,
  computeNodeDetail,
  computeTimeline,
  computeMetricsView,
} from "vue-dependency-graph/devtools";

const view = computeGraphView(runtime.createDiagnosticSnapshot());
```

`computeGraphView` lays nodes out deterministically by dependency depth (column) and alphabetical order within a column (row) - the same snapshot always produces the same layout, with no force-simulation jitter to account for in a UI or a test. Events get their own lane at column `-1`, with edges into every node that declares them in `invalidatedBy`.

## Exported symbol appendix

This appendix lists every supported symbol from the package entry points. Prefer inferred types in ordinary application code, but import the named types below when defining reusable wrappers, adapters, renderers, or strongly typed test helpers.

### Core exports

Entry point: `vue-dependency-graph/core`.

#### Values

- `GraphExecutionError`
- `GraphMutationConflictError`
- `GraphMutationOutcomeUnknownError`
- `GraphMutationReconciliationError`
- `GraphMutationRollbackConflictError`
- `GraphMutationStateError`
- `GraphPollingConditionError`
- `GraphPollingTimeoutError`
- `GraphRefreshRetryExhaustedError`
- `GraphTransactionConflictError`
- `GraphValidationError`
- `createDefaultTimerEnvironment`
- `createGraph`
- `createGraphRuntime`
- `createInMemoryGraphDiagnostics`
- `defineContextNode`
- `defineDataNode`
- `defineDerivedNode`
- `defineEvent`
- `defineMutation`
- `defineQuery`
- `normalizeDiagnosticEvents`
- `normalizeDiagnosticExport`
- `normalizeDiagnosticSnapshot`
- `pollUntil`
- `refreshInterval`
- `releaseAfter`
- `retain`
- `staleAfter`

#### Types

- `AnyEventDefinition`
- `AnyNodeDefinition`
- `AnyQueryDefinition`
- `ConditionalEventInvalidation`
- `ContextNodeDefinition`
- `ContextNodeOptions`
- `CreateGraphOptions`
- `DataNodeDefinition`
- `DataNodeOptions`
- `DefineMutationOptions`
- `DefineQueryOptions`
- `DependencyList`
- `DeriveContext`
- `DerivedNodeDefinition`
- `DerivedNodeOptions`
- `EventDefinition`
- `EventInvalidationContext`
- `EventInvalidationDeclaration`
- `EventInvalidationList`
- `EventPayload`
- `ExponentialRetryOptions`
- `ExponentialRetryPolicy`
- `FixedRetryOptions`
- `FixedRetryPolicy`
- `GetDependencyValue`
- `Graph`
- `GraphContextChangedDiagnosticEvent`
- `GraphDiagnosticError`
- `GraphDiagnosticEvent`
- `GraphDiagnosticEventBase`
- `GraphDiagnosticEventType`
- `GraphDiagnosticExport`
- `GraphDiagnosticNodeDefinitionSnapshot`
- `GraphDiagnosticNodeStateSnapshot`
- `GraphDiagnosticOperationKind`
- `GraphDiagnosticRefreshPolicySnapshot`
- `GraphDiagnosticSink`
- `GraphDiagnosticSnapshotV1`
- `GraphDiagnosticSubscriptionSnapshot`
- `GraphDiagnosticValue`
- `GraphDiagnosticsEnvironment`
- `GraphDiagnosticsOptions`
- `GraphDurationMetrics`
- `GraphEventDiagnosticEvent`
- `GraphExecutionReason`
- `GraphMetricsSnapshot`
- `GraphMutationDiagnosticEvent`
- `GraphNodeAttemptMetrics`
- `GraphNodeExecutionDiagnosticEvent`
- `GraphNodeInvalidatedDiagnosticEvent`
- `GraphNodeValueReleasedDiagnosticEvent`
- `GraphOperationRequestedDiagnosticEvent`
- `GraphRefreshPolicyDiagnosticEvent`
- `GraphRuntime`
- `GraphRuntimeCreatedDiagnosticEvent`
- `GraphRuntimeListenerFailedDiagnosticEvent`
- `GraphRuntimeOptions`
- `GraphSchedulerDiagnosticEvent`
- `GraphSerializedError`
- `GraphSubscriptionDiagnosticEvent`
- `GraphTransaction`
- `GraphTransactionDiagnosticEvent`
- `GraphValidationErrorCode`
- `InMemoryGraphDiagnostics`
- `InMemoryGraphDiagnosticsOptions`
- `LoadContext`
- `MutationDefinition`
- `MutationExecuteContext`
- `MutationFailureKind`
- `MutationInput`
- `MutationOptions`
- `MutationResult`
- `MutationSuccessEffects`
- `MutationUpdateEffects`
- `NodeDefinition`
- `NodeDiagnosticValueOptions`
- `NodeDiagnosticsOptions`
- `NodeExecutionFailure`
- `NodeExecutionFailureKind`
- `NodeFreshness`
- `NodeKind`
- `NodeOrKey`
- `NodeRuntimeState`
- `NodeStatus`
- `NodeSubscription`
- `NodeSubscriptionState`
- `NodeValue`
- `PollUntilOptions`
- `PollUntilPolicy`
- `QueryDefinition`
- `QueryNodeMap`
- `QueryNodes`
- `RefreshIntervalOptions`
- `RefreshIntervalPolicy`
- `RefreshPolicy`
- `RefreshableNodeDefinition`
- `ReleaseAfterOptions`
- `ReleaseAfterPolicy`
- `ReleasePolicy`
- `RetainPolicy`
- `RetryOptions`
- `RetryPolicy`
- `RetryStrategy`
- `RuntimeListener`
- `RuntimeNodeData`
- `SchedulerState`
- `StaleAfterOptions`
- `StaleAfterPolicy`
- `TimerEnvironment`

### Vue exports

Entry point: `vue-dependency-graph/vue`.

#### Values

- `createBrowserTimerEnvironment`
- `createGraphRuntimePlugin`
- `useGraphRuntime`
- `useNode`
- `useNodes`
- `useQuery`

#### Types

- `BrowserTimerEnvironmentOptions`
- `GraphComposableOptions`
- `GraphRuntimePluginOptions`
- `UseNodeResult`
- `UseNodesAggregate`
- `UseNodesResult`
- `UseNodesResults`
- `UseQueryNodes`
- `UseQueryResult`

### Devtools exports

Entry point: `vue-dependency-graph/devtools`.

#### Values

- `GraphDevtoolsPanel`
- `InvalidDevtoolsExportError`
- `computeGraphView`
- `computeMetricsView`
- `computeNodeDetail`
- `computeTimeline`
- `useGraphDevtools`
- `useOfflineDevtoolsSnapshot`

#### Types

- `DevtoolsExport`
- `InspectorEventNode`
- `InspectorGraphEdge`
- `InspectorGraphEdgeKind`
- `InspectorGraphNode`
- `InspectorGraphView`
- `InspectorMetricGroup`
- `InspectorMetricRow`
- `InspectorMetricsView`
- `InspectorNodeDependency`
- `InspectorNodeDetail`
- `InspectorNodeFreshness`
- `InspectorNodeStatus`
- `InspectorRefreshPolicyDetail`
- `InspectorTimelineCategory`
- `InspectorTimelineEntry`
- `UseGraphDevtoolsOptions`
- `UseGraphDevtoolsResult`
- `UseOfflineDevtoolsSnapshotResult`
