# Runtime Refactor R1A Cleanup Implementation Note

## Status

Validation pending.

## Objective

Establish an accurate documentation and repository baseline before runtime implementation refactoring begins.

## Files changed

- `tests/core/node-subscription-lifecycle.spec.ts`
- `tests/core/node-subscription-propagation.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/10-prefetch-and-refresh-implementation-note.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/12-runtime-refactor-r1a-cleanup-implementation-note.md`
- `docs/implementation/prompts/007a-runtime-refactor-r1a-documentation-cleanup.md`
- `refactor-deletions.txt`

## File deleted

Delete after applying the ZIP:

```text
docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md
```

The canonical Step 3B prompt remains:

```text
docs/implementation/prompts/005-implement-automatic-node-subscription-scheduler.md
```

## Documentation corrections

- Step 3C is recorded as validated offline.
- Milestone 3 is recorded as complete.
- Current context invalidation and subscription scheduling behavior is documented accurately.
- Prefetch and refresh are no longer listed as unimplemented.
- `whenSettled()` remains scheduler-specific.
- The staged runtime composition refactor is recorded before Milestone 4.

## Behavior and public API

No runtime source or public API changed. Test changes are description-only and do not change executable behavior.

## Static checks

Static checks cover source-file hashes, description-only test diffs, JSON parsing where configuration is available, core boundaries where the script is available, obsolete active wording, roadmap status, prompt presence, deletion manifest contents, and ZIP integrity.

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

R1B: Name existing runtime invariants.
