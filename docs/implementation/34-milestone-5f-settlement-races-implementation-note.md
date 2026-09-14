# Milestone 5F: Settlement and Execution-Race Completion

## Status

Behaviour and regression coverage prepared. Offline validation pending.

## Scope

This slice confirms the settlement and execution-race behaviour required by the Milestone 5 transaction model.

It covers:

- `whenSettled()` called while a successful transaction is open;
- `whenSettled()` called while a transaction later rolls back;
- execution completion before commit-time generation advancement;
- execution completion after commit-time generation advancement;
- loaders that ignore their abort signal.

No runtime source change is required. The existing notification-buffer settlement chaining and execution generation checks already provide the required behaviour. M5F adds focused integration tests and maintained documentation for that cross-capability contract.

## Successful commit settlement

A `whenSettled()` call made inside an open transaction cannot delegate directly to the scheduler because staged context changes have not requested scheduling yet.

The notification buffer therefore holds a transaction-time waiter. At outer commit:

1. staged context values commit;
2. affected subscribed work requests one scheduler pass;
3. the notification buffer dispatches that scheduler request;
4. the transaction-time waiter chains to the real scheduler settlement promise;
5. the waiter resolves only after commit-triggered execution completes.

The waiter does not resolve merely because the transaction body returned.

## Rollback settlement

When transaction work fails, discarded context values produce no scheduler request.

A transaction-time `whenSettled()` waiter is still released through the notification buffer's outer lifecycle. It chains to the real scheduler, which resolves immediately when there is no independent scheduled or running work.

Rollback therefore does not create phantom scheduler work or leave transaction-time settlement callers pending.

## Completion before commit-time generation advancement

An attempt started before the transaction may complete while transaction work is awaiting.

If its result commits before the outer context commit:

- the successful data remains committed;
- commit-time descendant invalidation advances the node generation once;
- the completed data is preserved as stale successful data;
- the result can be used as stale display data but is no longer considered fresh for the new context generation.

## Completion after commit-time generation advancement

If the outer context commit advances an affected node generation while its attempt remains active:

- the attempt is aborted after generation advancement;
- a loader that ignores the abort signal may still resolve;
- the existing generation and attempt-token checks classify that completion as obsolete;
- the obsolete value cannot overwrite current runtime state.

This remains true without staging execution writes in the transaction coordinator.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- transaction-time settlement remains pending after the transaction body completes while commit-triggered loading is active;
- settlement resolves after that loader completes;
- rollback settlement resolves without running a loader;
- rollback leaves scheduler state idle and error-free;
- completion before commit is preserved as stale successful data;
- completion after generation advancement cannot overwrite the current state;
- ignored-abort completion protection remains effective in a transaction context.

Tests use deferred promises and observable conditions rather than real-time delays or fixed microtask counts.

## No runtime source change required

The necessary runtime behaviour is already split correctly:

- `notification-buffer.ts` owns transaction-time settlement deferral and chaining;
- `scheduler.ts` owns actual scheduler settlement;
- `invalidation.ts` advances committed generations before aborting attempts;
- `execution.ts` rejects obsolete completion through generation and token checks.

Adding another settlement coordinator or transaction-specific execution path would duplicate these responsibilities.

## Static validation

Completed:

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. The TypeScript command is a temporary strict check over `src/core/**/*.ts` because repository dependencies are unavailable in this contained environment.

## Offline validation

Run in the normal repository environment:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M5F remains validation pending until those commands succeed against the combined repository.

## Next task

Proceed with M5G playground coverage, maintained documentation completion, and final Milestone 5 validation.
