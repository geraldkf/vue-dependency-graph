# Milestone 5E: Rollback and Failure-Path Coordination

## Status

Behaviour and regression coverage prepared. Offline validation pending.

## Scope

This slice completes and documents the rollback contract established by the M5C coordinator and the M5D commit boundary.

The source composition already provides the required separation:

- staged context changes live only in the transaction coordinator;
- context notification and scheduling are requested only by successful commit;
- the notification buffer releases dispatch requested by independent runtime activity when the outer transaction closes, even when transaction work fails.

M5E therefore adds focused behavioural coverage and maintained documentation rather than introducing another runtime abstraction or changing the already-correct coordinator and buffer responsibilities.

## Rollback contract

When outer transaction work throws synchronously or rejects asynchronously:

- all staged context values are discarded;
- context and descendant generations remain unchanged;
- descendants are not invalidated;
- active attempts are not aborted because of discarded context changes;
- no context-owned notification is emitted;
- no context-owned scheduler request is made;
- the original error remains caller-visible.

Nested transactions share one staging scope without savepoints:

- propagated inner failure rolls back the outer transaction;
- successful inner work is rolled back if outer work later fails;
- an inner failure caught by outer work does not poison the transaction;
- staged writes before a caught inner failure remain part of the outer scope and can be replaced before commit.

## Independent runtime activity

Execution attempts started before a transaction remain independent committed work.

If such an attempt completes while transaction work is open and the transaction later fails:

- the execution result remains committed;
- its buffered notification is released when the outer transaction closes;
- discarded context changes do not suppress the independent notification;
- rollback does not restore or discard the execution result.

This behaviour is achieved without tagging every notification by owner. Context staging emits no dispatch before successful commit, while independent capabilities continue to use the existing notification buffer. The buffer's outermost `finally` release therefore preserves legitimate independent dispatch on both success and failure.

## Tests

Extended `tests/core/transaction.spec.ts` to verify:

- synchronous throw rolls back staged context state;
- asynchronous rejection has equivalent rollback behaviour;
- context and descendant generations remain unchanged;
- rollback emits no context notification;
- propagated inner failure rolls back the outer scope;
- caught inner failure allows the outer scope to continue and commit;
- outer failure rolls back successful inner work;
- affected active work is not aborted after rollback;
- independent execution completion remains committed after rollback;
- independent execution notification is buffered while work is open and released after failure.

## No runtime source change required

No runtime source file is changed in M5E.

Adding a second rollback-aware notification mechanism would duplicate ownership and create unnecessary complexity. The existing lifecycle already has the correct ordering:

1. transaction coordinator runs user work;
2. failed outer work discards staged contexts;
3. notification buffer exits its outer scope in `finally`;
4. only dispatch requested by independent committed activity is released;
5. the original transaction error is rethrown.

The new tests make that cross-capability contract explicit and protect it from regression.

## Deliberately deferred

M5F remains responsible for:

- `whenSettled()` behaviour on successful commit and rollback;
- execution completion races before and after commit-time generation advancement;
- ignored-abort completion protection in transaction scenarios;
- final settlement and race-focused documentation.

## Static validation

Completed:

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed. The second command is a temporary strict TypeScript check over `src/core/**/*.ts` because repository dependencies are unavailable in this contained environment.

## Offline validation

Run in the normal repository environment:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M5E remains validation pending until those commands succeed against the combined repository.

## Next task

Proceed with M5F settlement and execution-race completion coverage.
