# Runtime Refactor R1B Invariants Implementation Note

## Status

Validation pending.

## Objective

Replace three important inline runtime rules with clearly named private helpers before later capability extraction.

## Files changed

- `src/core/runtime.ts`
- `tests/core/refresh-interaction.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/13-runtime-refactor-r1b-invariants-implementation-note.md`
- `docs/implementation/prompts/007b-runtime-refactor-r1b-name-invariants.md`

## Named invariants

### Fresh successful values

`hasFreshSuccessfulValue(...)` identifies a reusable value only when the node has a successful value, success status, and fresh freshness. Execution reuse and scheduler target selection use this exact invariant. Weaker successful-value checks remain unchanged where they select loading versus refreshing or preserve prior data.

### Scheduler-only ownership

`isSchedulerOnlyAttempt(...)` requires exactly one origin and that origin must be `scheduler`. Final unsubscribe therefore continues to abort scheduler-only work while protecting attempts also owned by explicit execution, prefetch, refresh, or any future caller origin.

### Refresh-operation identity

`createRefreshOperationKey(...)` uses JSON encoding of sorted unique target keys. This preserves order-independent refresh deduplication without relying on a sentinel character that could appear in a node key.

## Tests

`refresh-interaction.spec.ts` now explicitly covers:

- Overlapping refreshes with reversed target order
- Duplicate targets in an overlapping refresh
- Independent refresh operations for distinct target sets

Existing tests continue to cover later refresh after settlement and scheduler, explicit, prefetch, and refresh ownership behavior.

## Preserved behavior and API

The public API, exports, registered-node validation, notification behavior, execution origins, active-attempt shape, and single execution engine were intentionally preserved. No responsibility moved to another file.

## Static checks

Static checks cover JSON parsing where available, core boundaries, forbidden imports, explicit `any`, TypeScript suppressions, console logging, public interface and export equality, helper privacy and usage, validation and notification source equality, roadmap status, and ZIP integrity.

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

## Next task

R1C: Standardise registered-node validation.
