# Recipe 06 — Release when unused

**Status:** research-phase pattern  
**Related:** [ADR-016 Value release policies](../decisions/ADR-016-value-release-policies.md), [ADR-004 Subscription-driven loading](../decisions/ADR-004-subscription-driven-loading.md)

## Failure mode

Widgets or routes unmount but heavy node values stay in the runtime forever because something still holds a subscription, or because no release policy was configured. Memory grows as users open and close panels.

Typical symptoms:

- Heap climbs after repeated visit → leave cycles on a detail view.
- Devtools still show large node snapshots after the UI is gone.
- Accidental root-level `useNode` / manual subscribe keeps demand alive for the whole session.

## Rule

Demand is subscription-driven. When the last subscriber goes away, a **release policy** decides whether and when the value may be dropped. Do not keep a permanent subscription at the app root “just in case” unless the data is truly session-global.

## Minimal correct shape

```ts
const ServiceDetail = defineDataNode({
  key: "serviceDetail",
  dependencies: [SelectedServiceId],
  initialValue: null as Service | null,
  load: ({ get, signal }) => {
    const id = get(SelectedServiceId);
    if (id == null) return null;
    return api.services.get(id, { signal });
  },
  // Drop after the detail pane has been closed for a while (milliseconds)
  release: 60_000,
});

// Truly session-global data can opt out with Infinity
const CurrentUser = defineDataNode({
  key: "currentUser",
  dependencies: [],
  initialValue: null as User | null,
  load: ({ signal }) => api.me({ signal }),
  release: Infinity,
});
```

Vue composables release their subscriptions on scope dispose:

```ts
// Inside a component — subscription ends when the component unmounts
const { data, status } = useNode(ServiceDetail);
```

## Runtime default

You can also set a default idle duration when creating the runtime, applied to any node that doesn't declare its own `release` (a node's own value — including `Infinity` — always wins over this default):

```ts
const runtime = createGraphRuntime(graph, {
  releaseAfterMs: 120_000,
});
```

`GraphRuntimeOptions.releaseAfterMs` and a node's own `release` are the same kind of value — a plain number of milliseconds — so the two are directly comparable.

Prefer explicit per-node policies for heavy payloads; use the runtime default for bulk leaf data only when measured.

## Common wrong shapes

```ts
// Wrong: subscribe once at app bootstrap and never dispose
const subscription = runtime.subscribeNodes([ServiceDetail]);
// ... subscription.unsubscribe() never called → node stays demanded

// Wrong: useNode in a parent that stays mounted for the whole session
// when the data is only needed inside a rarely opened drawer

// Wrong: expecting release to run while a child component still uses useNode
// (subscriptions are ref-counted; any active subscriber retains demand)
```

## Interaction with refresh and polling

A node with an active refresh/polling policy needs a subscriber to justify background work. Losing the last subscriber stops the policy timers independently of the release duration. `release: Infinity` retains a value; it does not create demand or keep polling alive.

## Diagnostics

Use snapshots and metrics to verify values are released after idle; node definitions remain in the graph:

- Node present while the panel is open.
- After unmount + idle window, value released (or retained if policy says so).

Playground scenarios under unmount / retention exist for regression coverage. See [reference data and cache budgets](./10-reference-data-and-cache-budgets.md) for retained reference lists, large payloads, keyed maps, and choosing idle durations. Runtime owners use `shutdown()` when their lifetime ends.

## Checklist

- [ ] Heavy detail nodes declare a `release` duration instead of holding their value forever.
- [ ] Session-global nodes that must survive route changes use `release: Infinity` deliberately.
- [ ] No accidental long-lived `subscribe` without dispose.
- [ ] `useNode` / `useNodes` / `useQuery` are called inside the component that needs the data, not a permanent shell, unless intentional.
- [ ] Retention behaviour is covered by a test or playground scenario for the feature.

## What this recipe does not own

- Exact idle durations (tune per product and payload size).
- Browser `WeakRef` / GC guarantees — release is policy-driven runtime behaviour.
- Multi-runtime memory isolation (each runtime has its own node state).
