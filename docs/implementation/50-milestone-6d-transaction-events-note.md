# Milestone 6D: Transaction-Aware Event Publication

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice extends the validated Milestone 5 transaction group so event publications participate in the same commit or rollback outcome as staged context changes.

Delivered:

- event publications staged in call order;
- publication staging shared by nested and joined transaction calls;
- rollback discarding staged publications;
- predicates evaluated against final staged context values;
- atomic predicate failure before any context or event state commit;
- combined context and event invalidation deduplication;
- one notification and at most one scheduler request;
- transaction settlement chaining through event-triggered scheduler work.

## Transaction staging

The transaction coordinator now owns two transaction-local collections:

- a final-value map of context changes keyed by context node key;
- an ordered list of event publications.

Context writes retain only their final staged value. Event publications are not deduplicated because repeated publications may carry different payloads and match different nodes.

Outside a transaction, `setContext(...)` and `publish(...)` use the same combined commit path immediately.

## Commit preparation

Before any runtime state mutation:

1. The event controller receives the final staged context changes and ordered publications.
2. Predicate dependency reads use final staged context values where present.
3. Other dependencies use committed successful runtime values.
4. Every predicate is evaluated.
5. Matched target nodes are deduplicated by key.

If a predicate throws, context values and event effects remain uncommitted and the transaction rejects with the original error.

## Combined commit

The invalidation controller now accepts effective context changes plus direct event invalidation roots in one operation.

It:

- applies each effective context value once;
- advances each changed context generation once;
- collects descendants of changed contexts;
- includes event targets and their descendants;
- deduplicates the complete affected node set by key;
- advances each affected generation once;
- preserves successful stale data;
- aborts affected attempts after generation advancement;
- emits one notification;
- requests at most one scheduler pass.

A node reached through a context change, one or more events, and multiple descendant paths is invalidated once for the transaction commit.

## Rollback and overlap semantics

On root failure, both staged context changes and publications are discarded. Joined transactions share the root staging collections and retain the existing root-owned outcome semantics.

A joined publication commits when the root succeeds and is discarded when the root fails. Joined failure behaviour remains unchanged from Milestone 5.

## Settlement

A transaction-time `whenSettled()` call remains held by the notification buffer. After successful event commit, it waits through the scheduler work triggered by matched subscribed nodes. Rollback with no independent work settles without phantom scheduling.

## Files changed

- `src/core/events/events.ts`
- `src/core/invalidation/invalidation.ts`
- `src/core/runtime.ts`
- `src/core/transactions/transaction-coordinator.ts`
- `src/core/transactions/types.ts`
- `tests/core/event-publication.spec.ts`
- `tests/core/transaction-events.spec.ts`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/46-milestone-6-typed-events-plan.md`
- `docs/implementation/49-milestone-6c-immediate-publication-note.md`
- `docs/implementation/50-milestone-6d-transaction-events-note.md`
- `docs/testing/01-test-strategy.md`
- `docs/README.md`

## Coverage

Focused tests cover:

- event effects remaining hidden while a transaction is open;
- successful commit;
- rollback with no event-owned notification or scheduling;
- predicates seeing final staged context values;
- context and event invalidation deduplication;
- repeated publications preserving predicate order while deduplicating effects;
- predicate failure leaving context and event state unchanged;
- joined publication commit and root-failure rollback;
- transaction settlement waiting through event-triggered scheduler work.

Existing immediate publication tests continue to cover behaviour outside transactions.

## Static validation completed

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed using the contained-environment compiler.
- Focused transaction event test compilation passed.
- No new public transaction object or staged-state inspection API was added.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M6D remains validation pending until all commands succeed against the combined repository.

## Next task

After successful validation, proceed with **M6E: Cross-domain playground scenario**.
