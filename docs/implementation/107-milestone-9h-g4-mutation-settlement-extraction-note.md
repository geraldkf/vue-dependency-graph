# Milestone 9H-G4: Mutation Settlement Extraction

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G4 mechanically extracts confirmed-success preparation and all remote settlement branches from `mutation-controller.ts` into the internal `mutation-settlement.ts` module.

The controller retains the remote attempt Promise flow and delegates its fulfilled and rejected outcomes. All graph writes remain inside the M9H-G3 committer.

No public API, mutation option, error class, error message, failure classification contract, graph transition, notification rule, scheduling rule, or concurrency behaviour changed.

## Settlement contract

The internal coordinator exposes two runtime-facing methods:

```ts
settleSuccess(
  mutationKey,
  options,
  result,
  input,
  optimistic,
)

settleFailure(
  options,
  error,
  optimistic,
)
```

The coordinator uses explicit internal branches:

```text
settleReconciliationFailure
settleKnownRejection
settleRollbackConflict
settleUnknownOutcome
```

## Confirmed success

Confirmed-success settlement now owns:

- success callback draft collection;
- callback lifetime enforcement for update, invalidate, and publish effects;
- explicit invalidation target validation;
- typed event publication collection;
- update preparation through the extracted planner;
- direct-value event predicate overlays;
- preliminary affected-derived calculation;
- optimistic-target affected-derived restrictions;
- event matching before graph mutation;
- final combined invalidation preparation;
- delegation to `commitSuccess(...)`;
- optimistic ownership release after successful reconciliation;
- conversion of optimistic local reconciliation failure to `GraphMutationReconciliationError`.

A non-optimistic local success failure remains the original error. An optimistic local success failure retains optimistic values, commits stale reconciliation, releases ownership, and reports confirmed remote success through the existing reconciliation error.

## Known rejection

Known-rejection settlement:

1. asks the session manager for rollback conflict keys;
2. converts conflicts through the rollback-conflict branch;
3. otherwise asks session policy whether restored state needs scheduling;
4. delegates exact restoration to `commitRollback(...)`;
5. rethrows the original remote rejection.

The rollback-conflict branch delegates stale reconciliation and constructs the existing `GraphMutationRollbackConflictError` with the original rejection as its cause.

## Unknown outcome

Unknown-outcome settlement:

- retains optimistic values;
- delegates stale reconciliation;
- releases ownership through the committer;
- constructs the existing `GraphMutationOutcomeUnknownError`;
- preserves the original remote failure as its cause.

If failure classification throws, the coordinator continues to use the safe unknown-outcome path and invokes the classifier only once.

## Ownership guarantees

Ownership release remains covered on every optimistic terminal path:

- confirmed success through direct session release;
- local reconciliation failure through stale reconciliation commit;
- exact rollback through rollback commit;
- rollback conflict through stale reconciliation commit;
- unknown outcome through stale reconciliation commit;
- classifier exception through the unknown-outcome branch.

No graph transition or public error branch releases ownership a second time.

## Controller boundary

After M9H-G4, `mutation-controller.ts` owns:

- composition of planner, session manager, committer, and settlement coordinator;
- optimistic callback preparation and optimistic session start;
- remote attempt `AbortController` creation;
- remote `execute(...)` invocation;
- Promise-chain normalisation of synchronous throws;
- delegation of fulfilled and rejected outcomes.

It no longer contains success-effect preparation, event matching logic, rollback validation, failure classification, or public settlement error construction.

## Settlement boundary

`mutation-settlement.ts` does not:

- access mutable node state directly;
- assign graph state fields;
- inspect active attempts;
- abort work directly;
- commit invalidation plans directly;
- notify observers directly;
- schedule graph work directly;
- acquire or write optimistic ownership tokens;
- execute the remote mutation request.

It coordinates the planner, session manager, and committer and translates internal outcomes into the existing public errors.

## Public surface

`mutation-settlement.ts` is not exported from `src/core/index.ts`. `runtime.ts` continues to construct only the mutation controller.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Runtime and transaction event test sources compiled with the same strict settings.
- Core boundary validation passed.
- Static architecture checks confirm settlement has no mutable-state, active-attempt, abort, direct invalidation-commit, notification, or scheduler-action dependency.
- Static checks confirm the controller retains the remote Promise flow and delegates both outcomes.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-G5 must not start until the complete dependency-backed suite passes against this G4 package.

## Next task

After full validation, implement M9H-G5 by simplifying composition and formalising the small internal lifecycle seam set required by Milestone 10, without adding observability events yet.
