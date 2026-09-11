# Runtime Refactor R3 State Storage Implementation Note

## Status

Validation pending.

## Objective

Extract runtime-local node-state and active-attempt storage while preserving all transition, execution, cancellation, and notification policy.

## Files changed

- `src/core/runtime-state.ts`
- `src/core/runtime.ts`
- `tests/core/runtime-state.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/17-runtime-refactor-r3-state-storage-implementation-note.md`
- `docs/implementation/prompts/009-runtime-refactor-r3-extract-runtime-state-storage.md`

## Runtime-state store

The internal closure-based store owns eager state initialization, required mutable-state lookup, frozen typed snapshots, active-attempt lookup and insertion, token-safe cleanup, and active-attempt iteration.

## Initial state

Context, data, and derived initial-state semantics remain unchanged. Every registered node receives state eagerly when its runtime is created.

## Snapshots

Each `getState(...)` call creates a fresh frozen snapshot. Data and error references are preserved without deep cloning, and derived data remains typed as `T | undefined` before first success.

## Active attempts

The store provides key-based lookup and insertion. It does not decide whether work shares an attempt, which origin owns it, whether it is obsolete, or whether it should be aborted.

## Token-safe cleanup

Cleanup deletes the stored attempt only when its token still matches the completing attempt. An obsolete completion therefore cannot remove a newer attempt.

## Iteration

The store exposes an internal iterator over active entries. Final-unsubscribe cancellation policy remains in `runtime.ts` and continues to evaluate current subscription state and scheduler-only ownership.

## Policy boundary

Generation advancement, status and freshness assignments, attempt construction, origin sharing, abort decisions, invalidation traversal, refresh supersession, and all notification decisions remain outside the store.

## Notification ownership

The state store has no observer dependency and performs no notification. All eleven established notification points remain in `runtime.ts`.

## Tests

Existing execution, deduplication, race, cancellation, refresh, and observer tests remain unchanged. `runtime-state.spec.ts` now explicitly confirms snapshots remain independent across committed updates.

## Preserved API and behavior

Public APIs, exports, R1B invariants, R1C validation timing, R2 observation, execution behavior, cancellation behavior, and runtime semantics were intentionally preserved.

## Static checks

Static checks cover public interface and export equality, internal module privacy, state and attempt shape preservation, eager initialization, frozen snapshots, token-safe deletion, policy placement, observer equality, notification-call preservation, source boundaries, explicit `any`, suppressions, console logging, roadmap status, and ZIP integrity.

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

## R4 risks and considerations

R4 may move execution policy and attempt construction into an execution controller. It must use the store through its narrow contract, preserve token-safe cleanup, and retain notification ownership after committed execution transitions.

## Next task

R4: Extract the execution controller.
