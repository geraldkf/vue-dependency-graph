# Milestone 7B: Vue useQuery

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds the Vue-facing `useQuery(...)` composable over the immutable query definitions introduced in M7A.

It provides:

- alias-preserving node results;
- the same per-node computed refs exposed by `useNode(...)`;
- aggregate loading, error, and success state consistent with `useNodes(...)`;
- explicit or injected runtime resolution;
- active-effect-scope enforcement;
- one combined graph subscription and one runtime observer;
- automatic cleanup on scope disposal.

## Public API

```ts
const result = useQuery(AppointmentsPage, { runtime });

result.nodes.appointments.data.value;
result.nodes.appointments.status.value;
result.nodes.capabilityStatus.error.value;

result.isLoading.value;
result.isError.value;
result.errors.value;
result.isSuccess.value;
```

`result.nodes` retains the aliases and exact node value types declared by the query.

## Implementation

Added `src/vue/use-query.ts` and exported:

- `useQuery(...)`;
- `UseQueryNodes<TQuery>`;
- `UseQueryResult<TQuery>`.

`useQuery(...)` delegates subscription and observation to the existing `useNodes(...)` implementation. It converts that tuple-backed state into a frozen aliased result object whose properties expose the existing `UseNodeResult<TNode>` contract.

This preserves one combined runtime subscription and one `onChange` listener for the complete query rather than creating one `useNode(...)` subscription per alias.

Aggregate semantics are reused directly from `useNodes(...)`:

- `isLoading` is true when any node is loading or refreshing;
- `isError` is true when any node exposes an error;
- `errors` contains current node errors;
- `isSuccess` is true when every node has a successful value.

## Runtime resolution and cleanup

The composable supports the same resolution order as existing graph composables:

1. Explicit `options.runtime`.
2. Runtime installed through the Vue plugin.
3. Existing missing-runtime error.

`useQuery(...)` must run inside an active Vue effect scope. Scope disposal releases the combined listener and graph subscription through `useNodes(...)`.

## Tests

Added:

- `tests/vue/use-query.spec.ts`;
- `tests/vue/use-query-types.test.ts`.

Behavioural coverage checks:

- aliased loading and data results;
- aggregate success and error behaviour;
- one direct subscription contribution per query target;
- complete cleanup on unmount;
- active-effect-scope enforcement.

Compile-time coverage checks:

- exact alias retention;
- exact aliased node data types;
- unknown alias rejection;
- aggregate computed-ref typing.

## Deliberately deferred

At the M7B boundary this slice did not add query operations. M7C subsequently added `runtime.prefetchQuery(...)`, `runtime.refreshQuery(...)`, and the corresponding `UseQueryResult` methods. M7B itself still owns only subscription and aliased reactive results.

M7B does not add:

- query-specific execution logic;
- query-owned cache or scheduler state;
- a playground scenario;
- dynamic or parameterised queries.

Those remain M7C and M7D work.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Keep M7B as **Prepared** until all results are reported.

## Next task

After M7B validation evidence is available, proceed with M7C: query prefetch and refresh.
