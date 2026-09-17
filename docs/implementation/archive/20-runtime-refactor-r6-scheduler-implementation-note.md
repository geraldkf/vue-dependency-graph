# Runtime Refactor R6 Scheduler Implementation Note

## Status

Validation pending.

## Objective

Extract the automatic scheduler into one runtime-local closure controller while preserving coalescing, follow-up handling, failures, notifications, settlement, and cancellation boundaries.

## Files changed

- `src/core/runtime-scheduler.ts`
- `src/core/runtime.ts`
- `tests/core/scheduler-settlement.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/20-runtime-refactor-r6-scheduler-implementation-note.md`
- `docs/implementation/prompts/012-runtime-refactor-r6-extract-automatic-scheduler.md`

## Scheduler controller

The internal controller exposes scheduling, frozen scheduler snapshots, scheduler settlement, and a narrow idle-settlement re-check used after runtime-owned cancellation.

## Dependencies

The controller receives a current target query, a scheduler-origin execution function, and notification dispatch. It does not receive subscription storage, active attempts, invalidation traversal, or refresh-operation state.

## State and microtasks

Scheduled, running, follow-up-required, error, and settlement-waiter state are private to each scheduler. An idle request commits scheduled state, notifies, and queues one microtask. Duplicate queued requests are no-ops. Requests during a flush set one private follow-up requirement.

## Flush and follow-up

Flush start clears queued state and prior error, marks running, and notifies. Targets are calculated at flush time. Automatic work delegates to `execution.execute(targets, "scheduler")`. Rejections are caught and normalized. Completion marks not running and notifies. Follow-up work uses the same microtask path before waiters resolve.

## Notification and settlement

The scheduler owns its three existing semantic notifications: request queued, flush started, and flush completed or failed. `whenSettled()` waits for queued, active, and follow-up scheduler work and never rejects for scheduler execution failure.

## External boundaries

Target selection remains in `runtime.ts`. Subscription notification precedes scheduling. Context and refresh-result invalidation notifications precede scheduling. Final-unsubscribe active-attempt inspection, ownership checks, and abort decisions remain in `runtime.ts`.

## Tests

Existing scheduler tests remain unchanged. A focused test now confirms scheduler snapshots are independent and frozen across scheduling state changes.

## Preserved behavior

Public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, invalidation, refresh operations, cancellation policy, and runtime behavior were intentionally preserved.

## Static checks

Static inspection covers public interface and export equality, controller privacy, state ownership, microtask sequencing, execution delegation, failure capture, notifications, settlement, external boundaries, source hygiene, roadmap status, and ZIP integrity.

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

## R7 considerations

R7 must extract context updates and descendant invalidation while preserving synchronous commits, abort behavior, notification timing, and scheduler request boundaries.

## Next task

R7: Extract invalidation and context updates.
