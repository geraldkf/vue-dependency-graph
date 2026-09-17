# Milestone 7D: Query Groups Playground

## Status

Implementation prepared. Automated and manual playground validation pending.

## Objective

Demonstrate the Milestone 7 exit criterion in the executable playground: one representative page requirement declaration is reused for prefetch, component subscription, aliased results, aggregate state, refresh, and lifecycle cleanup.

## Scenario structure

The scenario uses one module-scope query definition:

```ts
export const queryGroupsPage = defineQuery({
  key: "query-groups-page",
  nodes: {
    jobSeeker: queryGroupsJobSeekerId,
    appointments: queryGroupsAppointments,
    capabilityStatus: queryGroupsCapabilityStatus,
    summary: queryGroupsSummary,
  },
});
```

The definition is consumed by:

- `runtime.prefetchQuery(queryGroupsPage)` before a consumer is mounted;
- `useQuery(queryGroupsPage, { runtime })` inside the page consumer;
- `page.refresh()` from the mounted consumer.

No node list is repeated across those workflows.

## Playground behaviour

### Prefetch without subscription

The scenario begins with no mounted consumer and no direct query subscriptions. **Prefetch page** loads the complete query through the existing caller-owned prefetch path. Request counts advance while direct subscription counts remain zero.

### Mount from fresh data

After prefetch completes, **Mount consumer** creates one combined query subscription. The aliased appointment, capability, and summary values are immediately available from fresh runtime data and no additional loader call is required.

### Aggregate state

The consumer displays `isLoading`, `isError`, and `isSuccess` from `useQuery(...)`, demonstrating that query aggregates reuse the existing `useNodes(...)` semantics.

### Refresh

**Refresh page** calls the query result's `refresh()` method. Data and derived query requirements use the existing refresh operation, while the context alias remains unchanged. Both deterministic request counts and aliased values advance together.

### Cleanup

**Unmount consumer** releases query subscription ownership. Switching playground tabs also unmounts the scenario and releases any mounted consumer subscriptions through the existing Vue effect-scope cleanup.

## Files added

- `src/playground/scenarios/query-groups-nodes.ts`
- `src/playground/scenarios/QueryGroupsScenario.vue`
- `src/playground/scenarios/QueryGroupsConsumer.vue`
- `tests/playground/scenarios/query-groups.spec.ts`

## Files updated

- `src/playground/App.vue`
- `src/playground/playground-graph.ts`
- `tests/playground/App.spec.ts`
- `docs/PLAYGROUND.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/implementation/71-milestone-7-query-groups-plan.md`

## Automated coverage

The focused component suite verifies:

- prefetch loads every requirement without subscription ownership;
- mounting after prefetch reuses fresh data without another request;
- aliased values and aggregate success are displayed;
- refresh reloads all refreshable query requirements;
- refreshed aliased results are displayed;
- unmount releases all direct query subscription ownership.

The playground shell suite verifies that navigating away releases mounted Query Groups subscriptions.

## Scope

M7D does not add new core or Vue public APIs. It consumes the M7A through M7C APIs through the existing Pinia-owned playground runtime.

## Validation contract

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

Then complete the Query Groups checklist in `docs/PLAYGROUND.md`.

Keep M7D as **Prepared** until automated and manual results are reported.

## Next task

After M7D validation evidence is available, proceed with M7E: maintained documentation reconciliation and final Milestone 7 validation handoff.
