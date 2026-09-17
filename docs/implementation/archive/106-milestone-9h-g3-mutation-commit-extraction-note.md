# Milestone 9H-G3: Mutation Commit Extraction

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G3 mechanically extracts all mutation-owned graph writes into the internal `mutation-commit.ts` module. It introduces four explicit commit transitions and preserves the existing ordering of state changes, generation advancement, invalidation, active-attempt aborts, ownership release, notification, and scheduling.

No public API, error contract, event-matching rule, failure classification, remote execution, or settlement behaviour changed.

## Named transitions

The internal committer exposes:

```ts
commitOptimistic(...)
commitSuccess(...)
commitRollback(...)
commitStaleReconciliation(...)
```

No generic flag-driven commit method was introduced.

### Optimistic commit

`commitOptimistic(...)`:

- commits effective optimistic target values;
- marks targets successful and fresh;
- advances direct target generations;
- commits changed-result descendant invalidation;
- aborts direct target attempts after generation advancement;
- emits one graph notification;
- requests at most one scheduler pass.

Expected optimistic session generations remain captured after this transition returns.

### Confirmed success commit

`commitSuccess(...)`:

- identifies effective direct updates, including directly preserved invalidated roots;
- commits response values and their final freshness;
- advances effective update generations;
- commits combined direct, explicit, and event invalidation;
- aborts direct update attempts after generation advancement;
- remains silent when no update or invalidation is effective;
- otherwise emits one graph notification and at most one scheduler request.

Success-effect collection, event overlays, affected-derived restrictions, and combined-plan preparation remain in the controller until settlement extraction.

### Exact rollback commit

`commitRollback(...)`:

- restores every captured logical snapshot field;
- advances each restored generation exactly once rather than restoring the old generation;
- aborts active work only after every restored generation advances;
- releases optimistic ownership;
- emits one graph notification;
- requests scheduler work only when session policy identifies stale subscribed restored state.

Rollback validation and public conflict errors remain outside the committer.

### Stale reconciliation commit

`commitStaleReconciliation(...)` is shared by:

- unknown remote outcomes;
- rollback conflicts;
- confirmed remote success followed by local reconciliation failure.

It:

- retains current visible values;
- invalidates optimistic targets and affected descendants as stale;
- advances generations through the existing combined invalidation plan;
- aborts obsolete work through that plan;
- releases optimistic ownership;
- emits one notification;
- requests at most one scheduler pass.

## Dependency boundary

`createMutationCommitter(...)` receives:

```ts
getMutableState
getActiveAttempt
prepareCombinedInvalidation
releaseOptimisticSession
notify
schedule
```

The committer does not:

- collect or prepare update callbacks;
- acquire optimistic ownership;
- capture snapshots or expected generations;
- calculate rollback conflicts;
- decide failure classification;
- match events;
- construct public errors;
- execute remote mutation requests.

## Controller changes

The mutation controller no longer directly:

- assigns mutable node fields;
- commits invalidation plans;
- aborts active graph attempts;
- notifies graph observers for mutation commits;
- schedules graph work for mutation commits.

It prepares transition inputs and delegates to the named committer methods. Settlement branching remains in the controller until M9H-G4.

## Ordering invariants preserved

Every transition keeps generation advancement before abort:

- optimistic targets advance before direct target abort;
- success updates advance before direct update abort;
- rollback restores all logical fields and advances all generations before any abort;
- stale reconciliation uses the existing combined invalidation commit, which advances affected generations before abort.

Ownership release remains before notification for rollback and stale reconciliation, preserving the ability for observers and subsequent work to see the completed lifecycle state.

## Public surface

`mutation-commit.ts` is not exported from `src/core/index.ts`. `runtime.ts` continues to construct only the mutation controller.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Runtime and transaction event test sources compiled with the same strict settings.
- Core boundary validation passed.
- Static architecture checks confirm mutation-owned mutable writes, invalidation commits, direct aborts, notifications, and scheduler calls are absent from the controller.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-G4 must not start until the complete dependency-backed suite passes against this G3 package.

## Next task

After full validation, implement M9H-G4 by extracting confirmed success, known rejection, unknown outcome, rollback conflict, and reconciliation-failure coordination into `mutation-settlement.ts` while keeping all graph writes inside the committer.
