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
import { releaseAfter, retain } from "vue-dependency-graph/core";

const ServiceDetail = defineDataNode({
  key: "serviceDetail",
  dependencies: [SelectedServiceId],
  initialValue: null as Service | null,
  load: ({ get, signal }) => {
    const id = get(SelectedServiceId);
    if (id == null) return null;
    return api.services.get(id, { signal });
  },
  // Drop after the detail pane has been closed for a while
  release: releaseAfter({ idleMs: 60_000 }),
});

// Truly session-global data can opt into retain
const CurrentUser = defineDataNode({
  key: "currentUser",
  dependencies: [],
  initialValue: null as User | null,
  load: ({ signal }) => api.me({ signal }),
  release: retain(),
});
```

Vue composables release their subscriptions on scope dispose:

```ts
// Inside a component — subscription ends when the component unmounts
const { data, status } = useNode(ServiceDetail);
```

## Runtime default

You can also pass a default release policy when creating the runtime so individual nodes inherit unless they override:

```ts
const runtime = createGraphRuntime(graph, {
  // example — consult current GraphRuntimeOptions for exact field names
  // defaultRelease: releaseAfter({ idleMs: 120_000 }),
});
```

Prefer explicit per-node policies for heavy payloads; use defaults for bulk leaf data only when measured.

## Common wrong shapes

```ts
// Wrong: subscribe once at app bootstrap and never dispose
const stop = runtime.subscribe(ServiceDetail, () => {});
// ... never called → node stays demanded

// Wrong: useNode in a parent that stays mounted for the whole session
// when the data is only needed inside a rarely opened drawer

// Wrong: expecting release to run while a child component still uses useNode
// (subscriptions are ref-counted; any active subscriber retains demand)
```

## Interaction with refresh and polling

A node with an active refresh/polling policy still needs a subscriber (or an explicit runtime keep-alive mechanism if you add one) to justify work. Release after idle typically stops paying for polls once demand is gone — confirm against the current refresh-policy controller behaviour when tuning.

## Diagnostics

Use snapshots and metrics to verify nodes disappear after idle:

- Node present while the panel is open.
- After unmount + idle window, value released (or retained if policy says so).

Playground scenarios under unmount / retention exist for regression coverage.

## Checklist

- [ ] Heavy detail nodes declare `releaseAfter` (or equivalent) instead of unbounded retain.
- [ ] Session-global nodes that must survive route changes use `retain()` deliberately.
- [ ] No accidental long-lived `subscribe` without dispose.
- [ ] `useNode` / `useNodes` / `useQuery` are called inside the component that needs the data, not a permanent shell, unless intentional.
- [ ] Retention behaviour is covered by a test or playground scenario for the feature.

## What this recipe does not own

- Exact idle durations (tune per product and payload size).
- Browser `WeakRef` / GC guarantees — release is policy-driven runtime behaviour.
- Multi-runtime memory isolation (each runtime has its own node state).
