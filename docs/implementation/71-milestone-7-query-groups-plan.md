# Milestone 7: Query Groups Plan

## Status

M7A through M7D are prepared. Automated and manual validation is pending.

## Objective

Allow a representative page to declare an aliased group of graph requirements once and reuse that declaration for Vue subscription, result access, refresh, and prefetch.

The milestone exit criterion remains: representative page requirements are declared once and reused.

## Public direction

```ts
const AppointmentsPage = defineQuery({
  key: "appointments-page",
  nodes: {
    appointments: Appointments,
    capabilityStatus: CapabilityStatus,
    canModify: CanModifyAppointment,
  },
});

const result = useQuery(AppointmentsPage, { runtime });
result.nodes.appointments.data.value;
result.nodes.capabilityStatus.status.value;

await result.refresh();
await runtime.prefetchQuery(AppointmentsPage);
```

The exact Vue result wrapper will be finalised in M7B before runtime operations are added. The stable decision established by M7A is that aliases belong to the query definition and retain each node handle's exact type.

## Scope boundaries

Query groups are reusable declarations over existing graph nodes. They do not introduce:

- New graph topology or dependencies.
- A second scheduler or execution path.
- Query-owned cache state.
- Query-specific errors or loading state in core.
- Dynamic query membership.
- Parameterised query factories.
- Polling, retries, stale time, mutations, diagnostics, or persistence.

GraphRuntime remains the source of truth for node state and execution. Query operations must delegate to existing subscription, prefetch, refresh, and settlement behaviour.

## Concrete implementation steps

### M7A: Query definitions and type foundations

Status: Prepared; offline validation pending.

- Add immutable `defineQuery(...)` definitions.
- Preserve aliases and exact node-handle types.
- Add `QueryNodes<TQuery>` extraction.
- Reject blank query keys and blank aliases.
- Copy and freeze caller-owned node maps.
- Add behavioural and compile-time tests.
- Document the planned milestone shape without adding runtime or Vue behaviour.

Exit condition: page requirements can be represented once as a strongly typed immutable definition.

### M7B: Vue `useQuery` result shape

Status: Prepared; offline validation pending. See `docs/implementation/73-milestone-7b-vue-use-query-note.md`.

- Add `useQuery(query, options?)` using the existing runtime resolution rules.
- Return an alias-preserving `nodes` object whose entries expose the same node result contract as `useNode`.
- Reuse one graph subscription and one runtime observer for the query.
- Add aggregate `isLoading`, `isError`, `errors`, and `isSuccess` computed refs consistent with `useNodes`.
- Preserve scope enforcement, meaningful-state comparison, and cleanup.
- Add Vue behavioural and compile-time tests.

Exit condition: a component consumes aliased query results without repeating the node list or managing subscription cleanup.

### M7C: Query prefetch and refresh

Status: Prepared; offline validation pending. See `docs/implementation/74-milestone-7c-query-operations-note.md`.

- Add query-aware prefetch and refresh entry points using existing runtime operations.
- Delegate to `runtime.prefetch(...)` and `runtime.refresh(...)`; do not duplicate execution logic.
- Preserve current rejection, transaction ownership, concurrency limit, and settlement semantics.
- Add type and behavioural coverage for complete query target forwarding, deduplication, failure, and transaction independence.

Exit condition: the same query declaration drives component subscription, prefetch, and refresh.

### M7D: Playground scenario and integration coverage

Status: Prepared; automated and manual validation pending. See `docs/implementation/75-milestone-7d-query-groups-playground-note.md`.

- Add one representative page-query scenario to the existing Pinia-owned playground runtime.
- Demonstrate aliased data, aggregate state, shared loading, refresh, prefetch, and unmount cleanup.
- Keep loaders deterministic and reuse public APIs only.
- Add Vue Testing Library coverage and shell lifecycle coverage.

Exit condition: the playground visibly demonstrates one reusable page requirement declaration across loading and refresh workflows.

### M7E: Documentation and final validation

- Reconcile the public API, Vue architecture, roadmap, test strategy, playground guide, and README status.
- Run the full offline validation suite.
- Complete the manual playground checklist.
- Record actual results without inventing command output or test totals.

Exit condition: Milestone 7 is documented, tested, built, and manually validated against its exit criterion.

## Key design decisions

### Definitions use aliased object maps

An object map makes consumer result names explicit and preserves them through TypeScript mapped types. Array position and node keys are not used as presentation aliases.

### Queries contain node handles, not values

A query is immutable metadata. Values, status, freshness, errors, generations, subscriptions, and attempts remain runtime-owned.

### Query keys are stable identities

A non-blank key supports diagnostics and future devtools without changing query membership semantics. Queries are not registered into graph topology in M7.

### Operations delegate to existing runtime APIs

Query prefetch and refresh must unwrap the query's node handles and call the existing operations. This preserves branch-scoped failure, concurrency limiting, cancellation, in-flight sharing, and transaction ownership isolation.

### Vue behaviour should align with `useNodes`

`useQuery` should share aggregate semantics with `useNodes`, but expose individual results by alias rather than tuple position. The implementation should reuse internal helpers where that reduces duplication without changing existing public behaviour.

## Validation contract

Validation is performed offline by the developer:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M7A remains **Prepared** until those results are reported. Do not mark later steps complete solely because files were generated.
