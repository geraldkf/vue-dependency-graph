# Milestone 7C: Query Prefetch and Refresh

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice lets the same immutable query definition drive caller-owned prefetch and refresh operations.

Delivered:

- `runtime.prefetchQuery(query)`;
- `runtime.refreshQuery(query)`;
- `useQuery(...).prefetch()`;
- `useQuery(...).refresh()`;
- filtering of context aliases from query refresh targets;
- delegation to the existing prefetch and refresh operations;
- behavioural and compile-time coverage.

## Public API

```ts
await runtime.prefetchQuery(AppointmentsPage);
await runtime.refreshQuery(AppointmentsPage);

const page = useQuery(AppointmentsPage, { runtime });
await page.prefetch();
await page.refresh();
```

The methods return `Promise<void>` and preserve the existing caller-owned rejection model. Callers must await them or handle rejection.

## Operation semantics

### Prefetch

`prefetchQuery(...)` forwards every query node to the existing `runtime.prefetch(...)` path.

This preserves:

- dependency inclusion;
- fresh-value reuse;
- in-flight sharing;
- branch-scoped failures;
- runtime concurrency limiting;
- no persistent subscription ownership.

Context aliases are valid prefetch targets because the existing execution engine treats context nodes as already available graph inputs.

### Refresh

`refreshQuery(...)` selects the query's data and derived nodes and forwards them to the existing `runtime.refresh(...)` path. Context aliases are intentionally excluded because context values change only through `setContext(...)` or `transaction.setContext(...)`.

This preserves:

- target validation before mutation;
- target-key deduplication;
- generation advancement;
- stale successful data retention;
- active-attempt supersession;
- changed-result descendant invalidation;
- existing failure and recovery behaviour.

A query containing only context nodes therefore has a no-op refresh rather than failing because a context alias was present.

## Vue integration

`UseQueryResult<TQuery>` now exposes:

```ts
readonly prefetch: () => Promise<void>;
readonly refresh: () => Promise<void>;
```

The closures retain the query definition and resolved runtime used by the composable. They do not create another subscription, observer, scheduler, or execution path.

## Internal helpers

`src/core/queries/query.ts` now contains internal query-node extraction helpers:

- `getQueryNodes(...)`;
- `getQueryRefreshableNodes(...)`.

They return frozen arrays and remain internal implementation details rather than public barrel exports.

## Tests

Added:

- `tests/core/query-operations.spec.ts`;
- `tests/core/query-operation-types.test.ts`.

Extended:

- `tests/vue/use-query.spec.ts`;
- `tests/vue/use-query-types.test.ts`.

Coverage includes:

- complete query prefetch;
- transitive dependency execution;
- no subscription ownership from prefetch;
- query refresh of data and derived nodes;
- context generation remaining unchanged during query refresh;
- duplicate node aliases deduplicating through existing operations;
- empty query no-ops;
- validation before prefetch work starts;
- Vue convenience methods delegating to the captured query and runtime;
- operation return typing and invalid input rejection.

## Deliberately unchanged

M7C does not add:

- query-owned execution state;
- query-specific scheduler or error types;
- dynamic query membership;
- parameterised queries;
- automatic prefetch during query definition;
- playground behaviour.

The deterministic playground demonstration remains M7D.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Keep M7C as **Prepared** until all results are reported.

## Next task

After M7C validation evidence is available, proceed with M7D: deterministic Query Groups playground scenario and integration coverage.
