# Milestone 7: Query Groups Implementation Summary

## Status

Implementation and maintained documentation are complete. Final combined automated and manual validation is pending.

## Outcome

Milestone 7 allows one representative page requirement declaration to be reused for Vue subscription, aliased result access, aggregate state, prefetch, and refresh.

```ts
const AppointmentsPage = defineQuery({
  key: "appointments-page",
  nodes: {
    jobSeeker: JobSeekerId,
    appointments: Appointments,
    capabilityStatus: CapabilityStatus,
  },
});

await runtime.prefetchQuery(AppointmentsPage);

const page = useQuery(AppointmentsPage, { runtime });
page.nodes.appointments.data.value;
await page.refresh();
```

The query definition owns immutable metadata only. Node values, statuses, errors, freshness, generations, subscriptions, attempts, and scheduler work remain owned by `GraphRuntime`.

## Delivered capabilities

### Immutable query definitions

`defineQuery(...)` creates a frozen descriptor containing:

- a non-blank stable query key;
- a copied and frozen alias-to-node map;
- exact alias and node-handle typing.

`QueryNodes<TQuery>` extracts the original alias-to-node mapping for type-level reuse. Query definitions are not registered into graph topology and add no dependency edges.

### Vue `useQuery(...)`

`useQuery(...)` exposes each query member through its declared alias. Every aliased result has the same computed-ref contract as `useNode(...)`:

- `data`;
- `status`;
- `freshness`;
- `error`;
- `hasSuccessfulValue`.

The composable also exposes the aggregate contract already established by `useNodes(...)`:

- `isLoading`;
- `isError`;
- `errors`;
- `isSuccess`.

It reuses one combined subscription and one runtime observer, supports explicit and injected runtime resolution, requires an active Vue effect scope, and releases ownership on scope disposal.

### Query prefetch and refresh

`runtime.prefetchQuery(query)` delegates every query member to the existing prefetch operation. It preserves dependency inclusion, fresh-value reuse, in-flight sharing, branch-scoped failure, concurrency limiting, and the absence of persistent subscription ownership.

`runtime.refreshQuery(query)` delegates data and derived query members to the existing refresh operation. Context aliases are excluded because context values change through `setContext(...)` or `transaction.setContext(...)`. Existing refresh validation, deduplication, generation, stale-data, supersession, and failure behaviour remain authoritative.

`UseQueryResult` provides `prefetch()` and `refresh()` convenience methods bound to the same query definition and resolved runtime.

### Playground

The **Query Groups** scenario uses one `queryGroupsPage` definition for:

- prefetch before a consumer mounts;
- aliased component subscription through `useQuery(...)`;
- aggregate state display;
- refresh;
- unmount and tab-switch cleanup.

Deterministic request counters demonstrate that mounting after prefetch reuses fresh values without duplicate loads.

## Tests prepared

### Core behavioural tests

- Immutable query descriptors and caller-map isolation.
- Blank query key and alias validation.
- Complete query prefetch and dependency execution.
- No subscription ownership from prefetch.
- Data and derived query refresh.
- Context exclusion from refresh.
- Duplicate alias deduplication.
- Empty query operations.
- Validation before execution begins.

### Vue behavioural tests

- Aliased node loading and data access.
- Aggregate success and partial failure.
- Combined query subscription ownership.
- Unmount cleanup.
- Active-effect-scope enforcement.
- Query-bound prefetch and refresh.

### Compile-time tests

- Exact alias retention.
- Exact node-handle and data types.
- Unknown alias rejection.
- Query operation argument typing.
- `Promise<void>` operation results.

### Playground tests

- Prefetch without subscription ownership.
- Mounting from fresh prefetched data.
- Refreshing all refreshable requirements.
- Aliased result updates.
- Consumer and tab-switch cleanup.

## Validation evidence and pending work

The latest reported full Vitest run executed 268 tests. It reported 267 passing and one failing assertion in the new `useQuery(...)` scope-guard test. That assertion expected wording different from the established shared scope guard and has been corrected to use the existing test convention.

The latest reported repository typecheck also identified two implicit `any` parameters in the query runtime wrappers. Both callback parameters now explicitly use `AnyQueryDefinition`. A standalone strict core TypeScript check and core boundary check passed after that correction.

The complete repository commands and manual Query Groups checklist must now be rerun against the combined corrected checkout. Do not mark Milestone 7 validated until those results are reported.

## Deliberately deferred

Milestone 7 does not add:

- parameterised or dynamic queries;
- query-owned cache or scheduler state;
- query registration in graph topology;
- query-specific failure types;
- polling, stale time, retries, or mutations;
- diagnostics or devtools query inspection.
