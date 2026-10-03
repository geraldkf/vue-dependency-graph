# Events, Refresh Policies, and Polling

Typed events, manual refresh, refresh policies, and polling all reuse the runtime's existing invalidation, execution, cancellation, concurrency, and stale-data behaviour. They do not create parallel loading or state-management paths. The governing decisions are [ADR-006](../decisions/ADR-006-domain-events.md) and [ADR-012](../decisions/ADR-012-refresh-policies-and-polling.md).

## Domain events

Cross-domain invalidation uses typed events rather than direct store imports. Events identify graph data that may be stale; they are not graph values and do not invoke loaders directly.

```ts
const StockChanged = defineEvent<{
  productId: string;
  inStock: boolean;
}>("stock.changed");
```

Data and derived nodes may declare unconditional or conditional invalidation:

```ts
const Inventory = defineDataNode({
  key: "inventory",
  dependencies: [CurrentProductId],
  initialValue: null,
  invalidatedBy: [
    whenEvent(
      StockChanged,
      [CurrentProductId],
      ({ payload, get }) => payload.productId === get(CurrentProductId),
    ),
  ],
  load: ({ get, signal }) => api.getInventory(get(CurrentProductId), signal),
});
```

### Event index and matching

Graph creation validates event declaration shape, event keys, duplicate declarations, and node-kind restrictions. It builds an immutable graph-local candidate index keyed by event key. Candidate order follows graph registration order.

A conditional predicate, built with `whenEvent(event, dependencies, when)`, receives the typed payload and a `get(...)` function restricted to `dependencies` - the (possibly partial) subset of the node's own dependencies the predicate actually reads. Passing `dependencies` explicitly, rather than writing the predicate inline, is what gives `payload` and `get` full type inference with no annotation required. Predicates are synchronous and side-effect free.

All predicates are evaluated before graph mutation. If one throws or attempts an invalid dependency read, publication applies no partial event invalidation.

### Event publication ownership

Plain runtime publication is immediate:

```ts
runtime.publish(StockChanged, { productId: "prod-1", inStock: true });
```

It evaluates against committed graph state. Matching roots and transitive descendants are invalidated through the normal generation, cancellation, notification, and scheduler paths. A no-match or unused event is silent.

Transaction-owned publication is explicit:

```ts
await runtime.transaction((transaction) => {
  transaction.publish(StockChanged, { productId: "prod-1", inStock: true });
});
```

Staged publications retain call order. Successful commit evaluates predicates against the final staged context overlay and combines context and event effects into one graph commit. Rollback or conflict discards staged publications.

A confirmed mutation success may publish through `effects.publish(...)`. Event predicates are prepared with the mutation's other success effects, and their matches participate in the same local commit. Optimistic application, remote rejection, unknown outcome, and failed success preparation do not publish mutation events.

Repeated publications remain distinct because different payloads may match different nodes. The resulting affected-node set is deduplicated within a commit so each affected node advances generation at most once.

### Delivery boundary

Events are local to one `GraphRuntime`. They do not provide cross-tab delivery, durable replay, server delivery, distributed transactions, or exactly-once handling. External transports remain application-owned and map validated messages into `runtime.publish(...)`.

## Manual refresh

```ts
await runtime.refresh([ProductDetails, DisplayPrice]);
```

Manual refresh is a caller-owned operation for registered data and derived nodes. It forces re-execution through the normal refresh preparation and execution path. Context nodes are changed through `setContext(...)` rather than refreshed.

Refresh advances prepared target generations, preserves successful data, aborts superseded work, and shares matching work with other refresh callers and automatic policies. A changed successful result invalidates transitive descendants; an `Object.is` equal result does not.

Caller-owned refresh failures reject with `GraphExecutionError`. They do not become scheduler errors unless scheduler work independently owns the same failing orchestration.

## Refresh-policy definitions

A data node may declare one immutable policy:

- `staleAfter(...)`
- `refreshInterval(...)`
- `pollUntil(...)`

Context and derived nodes cannot declare refresh policies. Graph creation validates policy metadata, while each runtime owns its timers, retry state, pause state, and polling sessions.

All automatic policy work requires subscription ownership and delegates to the normal refresh and execution controllers with a distinct `refresh-policy` origin. It therefore reuses active attempts, cancellation, generation checks, stale-data retention, diagnostics, and `maxConcurrentLoads`.

Manual refresh remains caller-owned and does not inherit automatic policy retry behaviour.

## Stale-after behaviour

A successful subscribed stale-after node arms one timeout based on the latest successful value time. When the value reaches its declared age, the policy requests a normal refresh.

Final unsubscribe clears the timer and may abort work owned only by automatic scheduler or policy origins. Resubscription before expiry reuses the remaining freshness duration; resubscription after the value is stale requests normal scheduler work.

## Fixed-interval behaviour

Fixed interval policies use recursive timeouts rather than `setInterval(...)`.

The runtime arms the next timeout only after successful policy work settles. Slow requests therefore do not overlap, and each successful settlement begins a new full interval. Final unsubscribe clears the timer; later resubscription starts a clean full interval.

A policy-owned failure applies its configured retry behaviour. Once retries are exhausted, automatic interval work stops with `GraphRefreshRetryExhaustedError` while retaining previous successful data as stale. A later external successful execution starts a new policy cycle.

Context or event invalidation closes the previous timing session. Successful execution for the new generation starts a new interval.

## Poll-until behaviour

```ts
const OrderStatus = defineDataNode({
  key: "orderStatus",
  dependencies: [CurrentOrderId],
  initialValue: null,
  load: ({ get, signal }) => api.getOrderStatus(get(CurrentOrderId), signal),
  refresh: pollUntil({
    intervalMs: 3_000,
    timeoutMs: 60_000,
    failWhen: (order) => order?.status === "cancelled",
    stopWhen: (order) => order?.status === "shipped",
  }),
});
```

Each successful value is evaluated in failure, completion, and timeout order:

- A completion condition leaves the successful value fresh and stops polling.
- A business-failure condition stops polling with `GraphPollingConditionError`.
- Active elapsed time reaching the timeout stops polling with `GraphPollingTimeoutError`.
- A predicate exception is a terminal polling failure.

Terminal polling failures preserve the latest successful value, expose the terminal error, and leave the node stale.

Policy-owned refresh generation changes continue the active polling cycle. External invalidation closes that cycle; a later successful generation starts a new one.

Consumers read progress through normal node data. Polling does not introduce a separate callback channel.

## Retry and backoff

Interval and poll-until policies may configure bounded fixed or exponential retry with optional jitter.

Retry state belongs to the policy controller. Every attempt still delegates to normal refresh and execution, and retries never overlap active policy work. Successful policy work resets retry state. Exhaustion produces `GraphRefreshRetryExhaustedError` while retaining prior successful data.

Randomness comes from the injected timer environment so delay calculation remains deterministic in tests.

## Pause and resume

The timer environment supplies clock, timeout, randomness, and pause signals. Core code does not import browser APIs.

The optional Vue browser adapter combines document visibility and network availability. When paused, the policy controller clears its timeout and retains one remaining delay and timer purpose. Resume restores at most one timeout and does not replay missed ticks.

Active requests continue during pause. Poll timeout uses active elapsed time and excludes paused duration.

## Timer ownership and settlement

Refresh and release policies share one `TimerEnvironment`, but remain separate controllers with separate policy semantics. Policy composition and disposal are runtime-local.

Each refresh session owns a timer object with mutually exclusive idle, armed, and pending states. It owns the timeout handle, due time, remaining delay, purpose, and callback cancellation token. Pausing retains the remaining delay; clearing cancels both armed and pending work. A canceled callback cannot disturb a newer timer. Retry counts, polling completion, and active elapsed time remain owned by the policy controller.

Future policy timers are outside scheduler settlement, so `runtime.whenSettled()` remains finite for recurring policies. A timer firing may request refresh work, but caller-owned manual refresh must still be awaited directly.

`runtime.dispose()` detaches policy change hooks, clears refresh and release timers, and removes the timer environment pause listener. A policy request that settles after disposal schedules no follow-up work.

## Diagnostics

The diagnostic stream records policy scheduling, start, retry scheduling, pause, resume, completion, failure, and stop. Records identify the node, policy kind, operation, cause, and relevant delay without exposing loaded values.

Metrics derive poll attempts, retry counts, policy outcomes, and polling duration from the same event stream. See [Observability, devtools, and snapshots](./06-observability-devtools-and-snapshots.md).
