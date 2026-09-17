# Milestone 9E: Concurrency, Races, and Unknown Outcomes

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice completes the first mutation framework's concurrency and remote-outcome safety model. It prevents obsolete rollback snapshots from overwriting newer graph work and gives ambiguous remote failures a distinct reconciliation path.

M9E does not add retries, idempotency generation, external cancellation, offline queues, diagnostics, devtools, or layered optimistic writes to one node.

## Guarded rollback

Each optimistic session records a private ownership token for every effective optimistic target, complete pre-optimistic snapshots for targets and affected descendants, and the expected post-optimistic generation for every captured node.

A known-rejection rollback proceeds only when every target still has the session's ownership token and every captured node still has its expected generation. If any check fails, the runtime restores no snapshot. It marks the optimistic target subgraph stale, aborts obsolete work through existing invalidation behaviour, releases ownership, schedules subscribed reconciliation, and rejects with `GraphMutationRollbackConflictError`.

The error exposes immutable sorted `nodeKeys` and retains the original remote rejection as `cause`.

## Unknown remote outcomes

A transport failure, timeout, abort, missing classifier, classifier exception, or unsupported runtime classifier result cannot prove that a remote command was rejected.

For an optimistic mutation with an unknown outcome, the runtime retains currently visible optimistic values, invalidates optimistic targets and descendants, advances generations, marks successful values stale, aborts obsolete work, releases ownership, notifies once, requests at most one scheduler pass, and rejects with `GraphMutationOutcomeUnknownError`.

The error exposes immutable sorted keys for captured optimistic state and preserves the original remote error as `cause`. Non-optimistic mutation failures remain unchanged and reject with their original errors without invoking classification.

## Concurrency model

- A second effective optimistic update to an owned node is rejected before its request starts.
- Optimistic mutations targeting disjoint nodes may proceed concurrently.
- Non-optimistic mutations may proceed while optimistic work is pending.
- Independent direct reconciliation may update an optimistically owned node; its generation change then prevents stale rollback.
- Context changes, event publication, explicit refresh, refresh-policy polling, and transactions remain ordinary independent runtime operations.
- Mutation execution continues not to consume the data-load concurrency limit.

## Race coverage

Focused tests cover unknown-outcome error causes and stale reconciliation, classifier failure, independent mutation reconciliation, immutable sorted rollback-conflict keys, explicit refresh, context, event, and polling races, disjoint optimistic concurrency, transaction independence, and existing ignored-abort generation protection.

## Error contracts

`GraphMutationOutcomeUnknownError` and `GraphMutationRollbackConflictError` are exported from the core entry point. Both use standard `Error.cause`, immutable sorted node keys, and deterministic messages.

`GraphMutationConflictError` remains the pre-request same-node optimistic ownership error. It has no remote cause because the conflicting request does not start.

## Validation completed in the contained environment

Core boundary validation and focused strict TypeScript compilation of core source and mutation tests passed. A local Vitest declaration shim was used because repository dependencies are not installed. Static documentation and ZIP integrity checks are completed when the prepared package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9E remains validation pending until all four commands succeed against the combined checkout.

## Next task

After successful M9E validation, proceed with M9F deterministic Vue playground usage and behaviour tests. No core mutation composable is planned unless the scenario reveals repeated lifecycle behaviour that cannot remain application-local.
