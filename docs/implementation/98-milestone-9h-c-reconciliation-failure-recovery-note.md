# Milestone 9H-C: Reconciliation Failure Recovery

## Status

Implemented. Offline validation pending.

## Scope

M9H-C handles the case where an optimistic mutation succeeds remotely but local success reconciliation fails. The runtime must not roll back a command that may already be committed on the server, and it must not leave an unreconciled optimistic projection marked fresh.

## Implemented behaviour

After confirmed remote success, a local `onSuccess` failure now follows a dedicated recovery path when optimistic state was applied:

1. retain the currently visible optimistic values;
2. invalidate every optimistic target and captured descendant;
3. advance affected generations;
4. abort obsolete active work;
5. release optimistic ownership;
6. emit one recovery notification;
7. request at most one scheduler pass for subscribed affected state;
8. reject with `GraphMutationReconciliationError`.

No rollback occurs. No prepared success update, explicit invalidation, or event publication partially commits.

## Error contract

`GraphMutationReconciliationError` exposes:

```ts
readonly mutationKey: string;
readonly nodeKeys: readonly string[];
readonly cause: unknown;
readonly remoteSucceeded: true;
```

`nodeKeys` are unique, sorted, and frozen. They include the optimistic targets and descendants captured by the optimistic session. `cause` preserves the original local callback, updater, validation, asynchronous-effect, or event-predicate failure.

Non-optimistic success-reconciliation failures preserve their previous behaviour and reject with the original local error.

## Covered failures

The recovery boundary covers failures from:

- an `onSuccess` callback;
- a direct updater;
- an invalid or never-successful success target;
- a Promise-like success callback;
- a Promise-like updater result;
- an event predicate;
- success-draft validation;
- the affected-derived predicate restriction added by M9H-F.

## Behavioural coverage

Focused tests verify:

- optimistic target and derived descendant retention as stale;
- generation advancement across the affected subgraph;
- immutable sorted error metadata and preserved cause;
- ownership release and a later optimistic mutation succeeding;
- subscribed authoritative reload restoring fresh state;
- one coherent recovery notification before scheduler work;
- no partial multi-node success update;
- asynchronous callback and updater recovery;
- unchanged non-optimistic local failure behaviour.

## Compatibility

The public `mutate(...)` call shape is unchanged. A new exported error type distinguishes remote success with failed local optimistic reconciliation from remote rejection, unknown remote outcome, and rollback conflict.

Applications should treat this error as confirmation-pending recovery, not as evidence that the remote command failed.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
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

M9H-C remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-D scheduler recovery after rollback, beginning with restored stale subscribed snapshot coverage and one-pass scheduling assertions.
