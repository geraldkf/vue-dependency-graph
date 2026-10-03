# Recipe 10 — Reference data and cache budgets

**Status:** research-phase pattern
**Related:** [Release when unused](./06-release-when-unused.md), [Runtime ownership](./07-pinia-runtime-ownership.md)

## Stable reference data

Retain a small, frequently reused list across route changes when reloading it adds little value. Declare every identity that affects the response, even for retained data:

```ts
const TenantId = defineContextNode({ key: "tenantId", initialValue: "tenant-a" });

const Countries = defineDataNode({
  key: "countries",
  dependencies: [TenantId],
  initialValue: [] as readonly Country[],
  release: Infinity,
  load: ({ get, signal }) => api.countries.list(get(TenantId), { signal }),
});
```

`Infinity` disables idle release, including a runtime's default release duration. It does not make data permanently fresh, prevent context invalidation, or keep polling alive without demand. Use a typed event or explicit refresh when the reference list changes. After a tenant change, the previous value may remain visible as stale until loading succeeds; hide stale identity-sensitive values when the application requires that.

Retaining a value does not require a permanent subscription. Let the component that needs it own `useNode(Countries)`. End the application or store runtime with `shutdown()` and drop its reference when its cached values are no longer needed.

## Large values with a runtime default

Keep a modest default for ordinary data and shorten the idle window for expensive payloads:

```ts
const ReportId = defineContextNode({ key: "reportId", initialValue: "report-1" });
const Report = defineDataNode({
  key: "report",
  dependencies: [TenantId, ReportId],
  initialValue: null as ReportPayload | null,
  release: 30_000,
  load: ({ get, signal }) => api.reports.get(get(TenantId), get(ReportId), { signal }),
});

const runtime = createGraphRuntime(
  createGraph({ nodes: [TenantId, Countries, ReportId, Report] }),
  {
    releaseAfterMs: 120_000,
  },
);
```

The report's 30-second duration overrides the two-minute default; countries remain retained. These numbers illustrate policy choices, not recommended defaults for every application. A value with active direct or descendant demand cannot be released. Successful undemanded loads, including prefetches, can also start an idle window.

Release resets a data node to its `initialValue` and clears its successful-value flag. It invalidates descendants; it does not remove the node from graph topology. Returning demand reloads released data. Drop component-held copies too: the runtime cannot collect an object that the application still references.

## Choosing durations

| Workload                                       | Starting policy to evaluate                                              | Evidence to collect                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Small reference list used throughout a session | Explicit `Infinity`, with identity dependencies and refresh/invalidation | Value size, update frequency and tenant/auth behavior              |
| Detail panel revisited frequently              | Finite duration covering typical short navigation gaps                   | Revisit intervals, cache reuse and reload latency                  |
| Large, rarely revisited report                 | Short finite duration                                                    | Retained bytes, memory after navigation and acceptable reload cost |
| Ordinary leaf data                             | Runtime default unless a node needs different treatment                  | Aggregate memory and request counts across a session               |

Measure typical and high-percentile navigation gaps rather than guessing. Compare retained memory and extra requests over repeated open/close cycles. Long durations favor reuse; short durations favor memory release. Release controls retention, while refresh controls freshness: choose them independently.

## Keyed reference data in one node

Graph topology is fixed when `createGraph` runs. For a bounded collection whose keys are discovered at runtime, an application-managed map can fit inside one data node:

```ts
const LabelsByCode = defineDataNode({
  key: "labelsByCode",
  dependencies: [TenantId],
  initialValue: new Map<string, Label>() as ReadonlyMap<string, Label>,
  release: Infinity,
  load: async ({ get, signal }) => {
    const labels = await api.labels.list(get(TenantId), { signal });
    return new Map(labels.map((label) => [label.code, label] as const));
  },
});
const SelectedCode = defineContextNode({ key: "selectedCode", initialValue: "priority" });
const SelectedLabel = defineDerivedNode({
  key: "selectedLabel",
  dependencies: [LabelsByCode, SelectedCode],
  derive: ({ get }) => get(LabelsByCode).get(get(SelectedCode)) ?? null,
});
```

Declare these nodes in the graph and subscribe to `SelectedLabel` in its consumer. Changing the selected code reuses the loaded map. Changing tenant invalidates the map and its dependents.

This shape suits a collection loaded, refreshed and released as one unit. Individual entries do not get independent demand counts, request cancellation, freshness, errors or release timers. If the application incrementally fills the map, it owns deduplication, identity scoping, entry expiry and a size bound; a node's release policy only releases the whole map. Prefer separate statically declared nodes when entries need independent graph behavior.

Return a new map when updating it. Never call `set` or `delete` on the current graph value: runtime mutation guards do not protect `Map` instances, and TypeScript readonly types alone cannot enforce runtime immutability.

## Verify ownership and retention

Open and close the real consumer, inspect direct and required demand, advance the idle window, and confirm the value returns to its placeholder. Reopen it and check request counts. Repeat with retained reference data and confirm reuse without a permanent subscription. Finally end the owner lifetime, handle pending shutdown rejections and confirm timers and demand are gone.
