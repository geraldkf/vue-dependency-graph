# Runtime Refactor R7 Invalidation Implementation Note

## Status

Validation pending.

## Objective

Extract context updates and reusable descendant invalidation into one runtime-local closure controller while preserving synchronous commits, abort behavior, notifications, and scheduling.

## Files changed

- `src/core/runtime-invalidation.ts`
- `src/core/runtime.ts`
- `tests/core/runtime-context.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/21-runtime-refactor-r7-invalidation-implementation-note.md`
- `docs/implementation/prompts/013-runtime-refactor-r7-extract-invalidation-context.md`

## Controller contract

The controller exposes strongly typed `setContext(...)` and `invalidateChangedResultDescendants(...)`. Raw descendant traversal remains private.

## Dependencies

The controller receives graph topology, mutable state and active-attempt lookup, total-subscriber inspection, registered-node resolution, notification dispatch, and a scheduler request function.

## Context validation and equality

Equivalent handles resolve by registered key. Missing and non-context handles remain synchronous errors. `Object.is` equal values remain silent.

## Context commit

A changed context commits its value and successful fresh state, increments generation once, invalidates all descendants synchronously, notifies after the complete commit, and schedules only when an affected descendant has subscribers.

## Descendant traversal

Breadth-first traversal starts from graph children and deduplicates by key. Each descendant generation increments once, freshness becomes stale, status becomes success or idle according to previous success, and error clears. Data and successful-value state remain unchanged.

## Abort and subscriptions

Active descendant attempts are aborted after their generations become obsolete. Subscriber detection uses the R5 total-subscriber query.

## Refresh-result reuse

The R4 execution controller still detects changed refresh results. After its success notification, it delegates descendant invalidation to R7. R7 then notifies for an actual descendant set and schedules affected subscribed descendants.

## Tests

Existing context, race, scheduler-context, and refresh-descendant tests remain. A focused test confirms diamond descendants invalidate exactly once.

## Preserved behavior

Public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, R6 scheduling, refresh-operation ownership, cancellation policy, and runtime behavior were intentionally preserved.

## Static checks

Static inspection covers public interface and export equality, controller privacy, traversal and transition semantics, aborts, subscriber queries, notification ordering, refresh callback ordering, R8 boundaries, source hygiene, roadmap status, and ZIP integrity.

## Project commands

Not run in contained environment.

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

## R8 considerations

R8 may extract prefetch and refresh operations. It must preserve synchronous missing-target refresh validation, rejected-promise context refresh behavior, operation-map ownership, refresh preparation notification, and changed-result callback ordering.

## Next task

R8: Extract prefetch and refresh operations.
