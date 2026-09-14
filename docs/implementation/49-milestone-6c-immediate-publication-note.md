# Milestone 6C: Immediate Runtime Event Publication

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds strongly typed immediate event publication outside transactions. A matching event invalidates its directly declared target nodes and their transitive descendants through the existing invalidation and scheduler capabilities.

At the M6C boundary, publication inside transactions was temporarily rejected. M6D has now replaced that guard with transaction-aware publication staging.

## Public API

`GraphRuntime` now exposes:

```ts
publish<TEvent extends AnyEventDefinition>(
  event: TEvent,
  payload: EventPayload<TEvent>
): void;
```

Payload typing follows the selected event handle. Publication commits invalidation synchronously but does not wait for automatic reloads. Callers may use `await runtime.whenSettled()` to wait for resulting scheduler work.

## Runtime event controller

Added `src/core/events/event-matcher.ts`.

The controller:

- resolves graph candidates through the M6B event index;
- returns silently when an event has no consumers;
- evaluates every candidate predicate before any mutation;
- supplies committed successful dependency values through `get(...)`;
- rejects undeclared dependency reads defensively;
- throws when a required predicate dependency has no successful value;
- collects matched target nodes;
- delegates one invalidation request to the existing invalidation controller.

Predicate failure is atomic for event-owned invalidation. If any predicate throws, no matched target is invalidated.

## Invalidation integration

The invalidation controller now exposes one internal `invalidateNodesAndDescendants(...)` operation. It:

- includes directly matched event targets;
- collects their transitive descendant union;
- deduplicates converging roots and diamond paths by key;
- advances each affected generation once;
- preserves successful data;
- marks affected nodes stale;
- clears obsolete errors;
- aborts affected attempts after all generations advance;
- emits one notification;
- requests at most one scheduler pass when affected work is subscribed.

Context commit and changed-refresh-result behaviour remain unchanged.

## Publication behaviour

### Match

A matching event invalidates the target node and descendants. Subscribed stale targets reload through the existing scheduler and execution engine.

### No match

An event with no candidates, or with predicates that all return `false`, is silent. It causes no state change, notification, abort, or scheduler request.

### Active work

Affected attempts become obsolete through generation advancement before their abort signal is triggered. A loader that ignores abort cannot commit its late result because existing generation and token checks remain authoritative.

### Transactions at the M6C boundary

M6C originally rejected publication inside `runtime.transaction(...)`:

```text
runtime.publish(...) cannot be called inside runtime.transaction(...).
```

M6D subsequently replaced this temporary guard with staging, combined commit, and rollback semantics.

## Files changed

- `src/core/events/event-matcher.ts`
- `src/core/invalidation/invalidation.ts`
- `src/core/runtime.ts`
- `tests/core/event-publication.spec.ts`
- `tests/core/operation-types.test.ts`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/46-milestone-6-typed-events-plan.md`
- `docs/implementation/49-milestone-6c-immediate-publication-note.md`
- `docs/testing/01-test-strategy.md`
- `docs/README.md`

## Coverage

Behavioural tests cover:

- direct target and descendant invalidation;
- successful stale-data retention;
- unrelated branch preservation;
- conditional matching using committed dependencies;
- non-matching and unused events remaining silent;
- predicate failure applying no partial invalidation;
- subscribed reload through the scheduler;
- shared-descendant deduplication;
- one committed notification;
- generation-before-abort ordering;
- ignored-abort late-result protection;
- temporary transaction publication rejection.

Compile-time coverage verifies that publication payloads match their event handle.

## Static validation completed

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed using the contained-environment compiler.
- Focused operation type-test compilation passed.
- No event-specific execution or scheduler path was added.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M6C remains validation pending until all commands succeed against the combined repository.

## Next task

After successful validation, proceed with **M6D: Transaction-aware event publication**.
