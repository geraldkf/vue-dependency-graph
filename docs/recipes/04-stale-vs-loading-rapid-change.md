# Recipe 04 — Stale vs loading under rapid context change

**Status:** research-phase pattern  
**Related:** [ADR-007 Status / freshness separation](../decisions/ADR-007-status-freshness-separation.md), [ADR-011 Execution concurrency limit](../decisions/ADR-011-execution-concurrency-limit.md), [ADR-004 Subscription-driven loading](../decisions/ADR-004-subscription-driven-loading.md)

## Failure mode

Users thrash filters, dates, or tabs. The UI either:

- fires a request storm, or  
- blanks the screen on every keystroke/click, or  
- shows a spinner forever while generations race.

Typical symptoms:

- Network panel fills with cancelled or superseded availability requests.
- List flickers empty on every filter change even though yesterday’s data is still a useful placeholder.
- “Loading” indicator stays up after the user already moved to another selection.

## Rule

Separate **execution status** from **freshness**. Let the graph keep the last successful value while a newer generation loads. Decide product UX explicitly; do not fight the scheduler with ad-hoc `loadData()` calls.

## Signals the library gives you

For a node state:

| Field | Meaning |
|-------|---------|
| `status` | `idle` \| `loading` \| `success` \| `refreshing` \| `error` |
| `freshness` | `fresh` \| `stale` |
| `data` | Last value retained according to node rules |
| `error` | Current error, if any |

A node can be `status: "loading"` or `"refreshing"` while still exposing previous `data` with `freshness: "stale"`. That is intentional (ADR-007).

## Minimal UI pattern

```ts
const { data, status, freshness, error, hasSuccessfulValue } = useNode(Services);

// Product choice example: keep showing stale rows with a quiet indicator
const showStaleBanner = computed(
  () => hasSuccessfulValue.value && freshness.value === "stale",
);

const showBlockingSpinner = computed(
  () => status.value === "loading" && !hasSuccessfulValue.value,
);
```

Avoid:

```ts
// Wrong: blank whenever status is loading — throws away useful stale data
if (status.value === "loading") return null;
```

## Rapid context changes

The scheduler coalesces synchronous work and tracks generations so superseded loads do not overwrite newer results. Still:

1. Prefer **one transaction** when multiple contexts change together ([Recipe 01](./01-atomic-cascade.md)).
2. Rely on abort of older attempts; do not treat abort as a domain error ([Recipe 02](./02-optimistic-mutation-reconcile.md)).
3. Set `maxConcurrentLoads` on the runtime if the backend needs a hard cap:

```ts
const runtime = createGraphRuntime(graph, {
  maxConcurrentLoads: 6,
});
```

Derived nodes do not consume concurrency slots. Limits are per runtime.

## Optional debounce outside the graph

When context is driven by high-frequency UI (typeahead, scrubbing a slider), debounce the **context write**, not the loader:

```ts
// Application-level debounce before touching the graph
const scheduleOrgFilter = useDebouncedFn((orgId: string) => {
  void runtime.transaction(async (tx) => {
    tx.setContext(SelectedOrgId, orgId);
    tx.setContext(SelectedTeamId, null);
  });
}, 150);
```

Do not try to express debounce intervals as graph dependencies.

## Common wrong shapes

```ts
// Wrong: manual load after every setContext "to be safe"
runtime.setContext(SelectedDate, date);
await runtime.execute(Availability); // usually redundant with subscriptions

// Wrong: clearing data in the component when status flips to loading
watch(status, (s) => {
  if (s === "loading") localRows.value = [];
});
```

## Checklist

- [ ] UI distinguishes first load (`!hasSuccessfulValue`) from refresh/stale.
- [ ] Cascading context changes use one transaction.
- [ ] Runtime concurrency limit is set if the API requires it.
- [ ] High-frequency input is debounced *before* `setContext` / transactions.
- [ ] Aborted generations are not shown as user-facing failures.

## What this recipe does not own

- Exact visual treatment of stale banners vs spinners.
- Backend rate limits (client concurrency is only a client-side guard).
- Whether a particular screen should blank instead of showing stale data — that is product policy.
