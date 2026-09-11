# Runtime Refactor R8 Operations Implementation Note

## Status

Validation pending.

## Objective

Extract caller-owned prefetch and refresh orchestration into one runtime-local closure controller while preserving validation timing, operation sharing, generation preparation, execution delegation, and capability boundaries.

## Files changed

- `src/core/runtime-operations.ts`
- `src/core/runtime.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/22-runtime-refactor-r8-operations-implementation-note.md`
- `docs/implementation/prompts/014-runtime-refactor-r8-extract-operations.md`

## Controller contract

The operations controller exposes `prefetch(...)` and `refresh(...)` with their existing public-compatible signatures.

## Dependencies

The controller receives mutable-state and active-attempt lookup, registered-node resolution, execution delegation for prefetch and refresh origins, and notification dispatch.

## Prefetch

Prefetch delegates directly to the R4 execution controller with the prefetch origin. Validation remains inside R4's asynchronous boundary, no subscription state is created, and scheduler settlement remains unchanged.

## Refresh validation

Empty refresh resolves immediately. Missing targets still throw synchronously. Defensive context refresh still returns a rejected promise. The complete target list validates and deduplicates before mutation, preserving registered-key identity and first-occurrence order.

## Operation identity and map

The controller owns one runtime-local refresh-operation map. Identity uses JSON encoding of sorted unique target keys. Equivalent overlapping target sets share one promise, while distinct target sets remain independent.

## Preparation and supersession

A new operation increments each prepared target generation once, marks it stale, resets status according to previous success, and aborts the superseded attempt. Active refresh-origin targets skip repeated preparation. Data, successful-value state, and existing error-clearing behavior remain unchanged.

## Notification and execution

Refresh preparation sends one notification before R4 attempt-start notifications. Prepared targets delegate to R4 with the refresh origin. Cleanup is promise-identity safe after success or failure.

## Capability boundaries

R4 remains the single executor and detects changed refresh results. R7 remains responsible for descendant invalidation, notification, and scheduler requests. Final-unsubscribe cancellation remains outside operations. `whenSettled()` remains scheduler-only.

## Tests

No tests were changed because existing prefetch, refresh, interaction, failure, recovery, descendant, cancellation, observation, and type tests already cover the extracted behavior through public APIs.

## Preserved behavior

Public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, R6 scheduling, R7 invalidation, cancellation policy, and runtime behavior were intentionally preserved.

## Static checks

Static inspection covers public interface and export equality, controller privacy, validation timing, map ownership, operation identity, preparation ordering, execution delegation, cleanup safety, capability boundaries, source hygiene, roadmap status, and ZIP integrity.

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

## R9 considerations

R9 may simplify the composition root and document final internal boundaries. It must not alter public APIs, capability contracts, validation timing, notifications, or runtime behavior.

## Next task

R9: Simplify runtime assembly and document internal boundaries.
