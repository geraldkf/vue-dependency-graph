# Migration Strategy

## Principle

Do not replace the existing service until the new framework demonstrates equivalent behaviour in the playground and one bounded application workflow.

## Migration stages

### Stage 1: Inventory

For the selected store, document:

- Context nodes
- Data nodes
- Dependencies
- Subscribers
- Manual load calls
- Clear and mutation behaviour
- Error presentation
- Cross-store interactions

### Stage 2: Definition mapping

Map old concepts:

```text
createContextNode -> defineContextNode
auto API node     -> defineDataNode
local calculation -> defineDerivedNode
subscribe + load  -> useNode/useNodes/useQuery
clearNodeData     -> invalidate/refresh
mutateNode        -> update or mutate
```

For a page that repeats the same node list across mounting, route prefetch, and manual refresh, define one query group and reuse it:

```ts
const PageQuery = defineQuery({
  key: "page-query",
  nodes: {
    primary: PrimaryNode,
    permissions: PermissionsNode,
  },
});

await runtime.prefetchQuery(PageQuery);
const page = useQuery(PageQuery, { runtime });
await page.refresh();
```

Query aliases are consumer-facing names and do not change graph node identity or topology. Keep context changes explicit through `setContext(...)`; query refresh intentionally skips context aliases.

### Stage 3: Shadow validation

Where practical, compare execution plans or results in non-production development builds. Avoid duplicate real mutations.

### Stage 4: Bounded page trial

Choose a page with:

- Multiple dependencies
- Existing test coverage
- Low operational risk
- Clear request-count expectations

### Stage 5: Evaluate

Measure:

- API request count
- Time to usable data
- Error behaviour
- Stale data behaviour
- Complexity of component usage
- Diagnostic quality

## Backwards compatibility

A temporary adapter may expose old method names over the new graph for incremental migration. It must be explicitly deprecated and must not constrain the new public API.

## Rollback

Keep the old implementation available behind a development or release switch during the first trial where practical. Rollback should not require data migration because the graph cache is client-side and disposable.

## Transaction migration rules

Classify every nested transaction call by ownership intent.

Use `transaction.transaction(...)` when inner work must commit or roll back with the caller:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(ContextA, valueA);
  await transaction.transaction(nested => {
    nested.setContext(ContextB, valueB);
  });
});
```

Keep a top-level `runtime.transaction(...)` call when the work is an independent operation that may overlap in time. Independent sessions do not share staged values or outcomes.

After a successful transaction, call `runtime.whenSettled()` only when commit-triggered scheduler work must complete:

```ts
await runtime.transaction(transaction => {
  transaction.setContext(ContextA, valueA);
});
await runtime.whenSettled();
```

Do not assume `whenSettled()` waits for unrelated open transactions. Handle `GraphTransactionConflictError` where overlapping sessions or immediate runtime writes may update the same context.
