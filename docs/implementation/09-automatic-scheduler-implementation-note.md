# Automatic Subscription Scheduler Implementation Note

## Status

Validation pending.

Step 3B source, tests, and documentation were prepared and statically inspected in the contained environment. Type checking, Vitest, build, and playground startup were not run.

## Files changed

### Core

- `src/core/scheduler.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`

### Tests

- `tests/core/node-subscription-registration.spec.ts`
- `tests/core/scheduler-subscription.spec.ts`
- `tests/core/scheduler-coalescing.spec.ts`
- `tests/core/scheduler-context.spec.ts`
- `tests/core/scheduler-cancellation.spec.ts`
- `tests/core/scheduler-failure.spec.ts`
- `tests/core/scheduler-settlement.spec.ts`
- `tests/core/scheduler-types.test.ts`

### Documentation

- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/09-automatic-scheduler-implementation-note.md`
- `docs/implementation/prompts/005-implement-automatic-node-subscription-scheduler.md`

## Scheduling and coalescing

- Non-empty subscriptions and relevant context invalidation queue a microtask.
- Synchronous requests coalesce.
- One flush runs at a time per runtime.
- Changes during a flush request one recalculated follow-up pass.
- Directly subscribed nodes needing work are terminal targets; required ancestors come from the existing executor.

## Cancellation ownership

Attempts track `explicit` and `scheduler` origins internally. Final unsubscribe aborts work only when it is scheduler-owned and the node has no remaining direct or required subscriptions. Explicit ownership prevents subscription cleanup from cancelling caller-owned work.

## Failure and settlement

- Scheduler promise rejections are handled internally.
- `SchedulerState.error` stores automatic execution failure.
- Failure does not immediately retry.
- New subscription or context change triggers a new pass.
- `whenSettled()` resolves after queued, active, and follow-up work, including failure or cancellation.

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

## Step 3C risks

- Prefetch needs temporary ownership without changing persistent subscriber counts.
- Manual refresh must deliberately trigger stale or fresh nodes without creating retry loops.
- Both features should reuse scheduler settlement and the existing executor.
