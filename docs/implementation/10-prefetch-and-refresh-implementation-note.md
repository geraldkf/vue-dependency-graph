# Prefetch and Manual Refresh Implementation Note

## Status

Validation pending.

Step 3C source, tests, and documentation were prepared and statically inspected in the contained environment. Type checking, Vitest, build, and playground startup were not run.

## Files changed

### Core

- `src/core/operations.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`

### Tests

- `tests/core/prefetch.spec.ts`
- `tests/core/prefetch-interaction.spec.ts`
- `tests/core/refresh.spec.ts`
- `tests/core/refresh-descendants.spec.ts`
- `tests/core/refresh-interaction.spec.ts`
- `tests/core/refresh-failure.spec.ts`
- `tests/core/operation-types.test.ts`

### Documentation

- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/10-prefetch-and-refresh-implementation-note.md`
- `docs/implementation/prompts/006-implement-prefetch-and-manual-refresh.md`

## Prefetch semantics

Prefetch is caller-owned one-shot execution. It loads requested stale or never-successful branches, skips successful fresh nodes, changes no subscription counts, and shares matching active attempts.

## Refresh semantics

Manual refresh accepts data and derived nodes. It validates the complete target list, deduplicates keys, advances the requested generation, preserves successful data, aborts obsolete work, and delegates execution to the existing executor. Overlapping calls for the same target set share one refresh operation.

## Descendant invalidation

When a refreshed node had a successful value and commits a different result, transitive descendants are marked stale once, their data is preserved, obsolete attempts are aborted, and subscribed descendants request scheduler work. Equal results do not invalidate descendants.

## Ownership and settlement

Attempts can carry explicit, scheduler, prefetch, and refresh origins. Final unsubscribe cancels only scheduler-owned work. `whenSettled()` remains scheduler-only; callers await prefetch and refresh promises directly.

## Failure behavior

Caller operations reject with `GraphExecutionError`. Refresh failure retains successful data and stale state. Caller-operation failures do not alter scheduler error unless scheduler orchestration also owns the failure.

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

## Milestone 4 risks

Transactions must defer descendant invalidation and scheduling without changing one-shot operation ownership. Refreshes active during a transaction will require an explicit ordering rule.
