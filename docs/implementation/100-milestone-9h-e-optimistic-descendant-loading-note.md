# Milestone 9H-E: Immediate Optimistic Descendant Loading

## Status

Implemented. Offline validation pending.

## Scope

M9H-E confirms and hardens the selected behaviour that optimistic invalidation immediately participates in normal graph scheduling. Subscribed data descendants may reload before the remote mutation settles.

## Confirmed scheduling behaviour

When an optimistic data target changes:

- changed-result descendants become stale immediately;
- subscribed derived descendants may recompute immediately;
- subscribed data descendants may reload immediately;
- data descendant loading uses the normal `maxConcurrentLoads` limiter;
- mutation execution does not consume that limiter;
- mutation and descendant settlement remain independent.

No deferred mutation-specific descendant queue was introduced.

## Settled descendant rollback protection

Data-loader success does not create a new invalidation generation in the existing execution model. M9H-E therefore adds a focused rollback guard for non-target data descendants.

When a captured data descendant has settled as successful fresh data and its value differs from the pre-optimistic snapshot, known-rejection rollback treats it as newer graph state even if the invalidation generation still matches. The runtime:

- skips the complete snapshot rollback atomically;
- retains current target and descendant values;
- marks the affected graph stale;
- releases optimistic ownership;
- schedules subscribed authoritative reconciliation;
- reports the changed descendant through `GraphMutationRollbackConflictError`.

Derived descendants are not subject to this extra value guard. Their optimistic recomputation remains part of the reversible local projection and existing generation checks continue to protect independent derived work.

## Active descendant settlement

If a data descendant is still active when known rejection arrives, exact rollback remains eligible because no newer value has committed. Rollback advances generations before aborting active work. A loader that ignores abort therefore cannot commit after rollback.

## Concurrency independence

With `maxConcurrentLoads: 1`, an unrelated data load may occupy the only load slot while:

- the mutation request starts immediately;
- optimistic invalidation marks the descendant stale;
- the descendant waits in the normal FIFO load queue;
- the descendant starts only after the slot is released.

This preserves the existing meaning of `maxConcurrentLoads` as a data-loader limit rather than a global command limit.

## Behavioural coverage

Focused tests verify:

- subscribed data descendant loading before mutation success;
- descendant completion remaining intact after later command success;
- changed descendant completion before known rejection producing a rollback conflict;
- current values being retained as stale and authoritative reconciliation remaining scheduled;
- an active ignored-abort descendant result remaining obsolete after rollback;
- mutation execution starting while the single data-load slot is occupied;
- the queued descendant load starting only after the slot becomes available.

## Compatibility

The public API is unchanged. The only runtime change is an additional safe-rollback conflict check for changed, settled, non-target data descendants captured by an optimistic session.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Core boundary validation passed.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-E remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-F, prohibiting mutation event predicates from reading derived dependencies affected by the same success draft.
