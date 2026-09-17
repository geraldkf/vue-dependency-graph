# Runtime Refactor R4 Execution Controller Implementation Note

## Status

Validation pending.

## Objective

Extract the existing dependency-aware execution engine into one closure-based internal controller while preserving public APIs, execution semantics, cancellation ownership, and notification timing.

## Files changed

- `src/core/runtime-execution.ts`
- `src/core/runtime.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/18-runtime-refactor-r4-execution-controller-implementation-note.md`
- `docs/implementation/prompts/010-runtime-refactor-r4-extract-execution-controller.md`

## Execution controller

The internal controller exposes one execution method for all four origins and one narrow scheduler query. It receives graph topology, narrow runtime-state access, registered-node resolution, execution notification dispatch, and one changed-refresh-result callback.

## Single engine and validation

Explicit execution, prefetch, scheduler execution, and refresh execution all call `execution.execute(...)` with their existing origin. Registered-target resolution remains inside the asynchronous execution method and completes before loader work starts.

## Orchestration and attempts

Recursive parent execution, independent branch concurrency, per-operation requested-node deduplication, blocked-descendant detection, aggregate failure settlement, same-generation origin sharing, generation and token commit protection, and token-safe cleanup remain unchanged.

## Refresh result boundary

After a changed successful refresh result and its success notification, the controller invokes an injected callback. Runtime-owned invalidation traversal, descendant aborts, descendant notification, and scheduler requests remain outside the controller.

## Notification ownership

Execution owns three semantic notification points: attempt start, committed success, and committed direct failure. The remaining eight established notification points remain in `runtime.ts`.

## Tests

No tests were changed. Existing execution, failure, deduplication, race, prefetch, refresh, scheduler, cancellation, observation, and type tests already cover the extracted behavior through public entry points.

## Preserved behavior

Public APIs, exports, validation timing, R2 observation, R3 storage, cancellation policy, scheduler behavior, refresh operation ownership, and runtime behavior were intentionally preserved.

## Static checks

Static inspection covers public API and export equality, controller privacy, single-engine delegation, asynchronous validation placement, dependency orchestration, origin sharing, commit protection, notification ownership, refresh callback ordering, later-task boundaries, source hygiene, roadmap status, and ZIP integrity.

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

## R5 considerations

R5 must extract subscription storage and lifecycle without moving final-unsubscribe cancellation policy into subscription storage.

## Next task

R5: Extract subscription storage and lifecycle.
