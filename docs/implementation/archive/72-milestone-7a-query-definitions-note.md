# Milestone 7A: Query Definitions and Type Foundations

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice introduces immutable, strongly typed query definitions only. It does not add Vue subscriptions, runtime query operations, query execution, playground behaviour, or query-owned state.

## Public API

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

`QueryNodes<TQuery>` retains the exact alias-to-node mapping. Later steps can use that mapping to produce aliased Vue results without weakening node value types.

## Implementation

Added:

- `src/core/queries/types.ts`
- `src/core/queries/query.ts`

`defineQuery(...)`:

- requires a non-blank key;
- rejects blank aliases entering through JavaScript or computed properties;
- copies the caller-owned node map;
- freezes the copied node map and query descriptor;
- retains literal aliases and exact node-handle types through a const generic.

The query definition is not registered with `createGraph(...)`. It describes a reusable group of existing nodes and owns no mutable runtime state.

## Tests

Added:

- `tests/core/query-definitions.spec.ts`
- `tests/core/query-types.test.ts`

Behavioural coverage checks immutable descriptors, caller-map isolation, blank query keys, and blank aliases.

Compile-time coverage checks exact alias retention, exact node-handle retention, unknown alias rejection, and rejection of non-node entries.

## Deliberately deferred

M7A does not add:

- `useQuery(...)`;
- runtime query prefetch or refresh;
- aggregate loading or error state;
- graph registration or query validation against one graph;
- query parameters or dynamic node membership;
- query-specific cache, scheduling, or execution.

## Static inspection completed

- Query code is framework-agnostic and remains under `src/core`.
- Public exports are added through the existing core barrel.
- No existing runtime, graph, Vue, or playground implementation was changed.
- Tests follow the existing Vitest and compile-time test conventions.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Keep M7A as **Prepared** until all results are reported.

## Next task

After M7A validation evidence is available, proceed with M7B: Vue `useQuery` and its alias-preserving result shape.
