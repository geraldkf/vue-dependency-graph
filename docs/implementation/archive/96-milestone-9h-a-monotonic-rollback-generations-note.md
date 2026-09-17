# Milestone 9H-A: Monotonic Rollback Generations

## Status

Implemented. Offline validation pending.

## Scope

M9H-A changes successful known-rejection rollback so it restores prior logical state without restoring old generation numbers. It does not implement M9H-D scheduler recovery for stale subscribed snapshots; that remains the next slice.

## Problem corrected

Before this slice, rollback copied the snapshot generation back into runtime state. A node could therefore move from generation `n`, to optimistic generation `n + 1`, and then back to `n`.

The execution engine uses generation identity as one of its obsolete-attempt guards. Reusing an old generation creates an ABA-shaped state transition and weakens the invariant that a generation identifies one committed version of node state.

## Implemented behaviour

A safe rollback still requires:

- the optimistic ownership token to match every effective target;
- the current generation to match the expected post-optimistic generation for every captured target and descendant.

After those checks pass, rollback restores:

- data;
- status;
- freshness;
- error;
- successful-value history.

For every restored target and descendant, rollback advances the current generation once rather than copying the snapshot generation. Active work is aborted only after all restored nodes have received their new generations. Ownership is then released and observers receive one notification.

A typical sequence is now:

```text
pre-optimistic generation: 0
optimistic generation:     1
rollback generation:       2
```

Rollback is therefore represented as a new committed graph transition.

## Behavioural coverage

Focused tests cover:

- target and affected-derived descendant generations increasing after rollback;
- preservation of every visible snapshot field while generation changes;
- multi-node optimistic rollback advancing each target and shared descendant once;
- a pre-optimistic refresh that ignores abort and completes after rollback;
- the obsolete refresh result being unable to overwrite restored data;
- preservation of the original known-rejection error.

## Compatibility

The public mutation API is unchanged. Rollback conflict detection is unchanged and still occurs before any snapshot field is restored. Callers that inspect generations must now treat rollback as a new version, which aligns with existing context, invalidation, refresh, and success-reconciliation semantics.

## Validation completed in the contained environment

- Strict TypeScript compilation of the core and focused mutation test source passed using a local Vitest declaration shim.
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

M9H-A remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-D scheduler recovery after rollback, beginning with stale subscribed snapshot coverage and one-pass scheduling assertions.
