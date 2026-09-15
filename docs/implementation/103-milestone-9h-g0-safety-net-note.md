# Milestone 9H-G0: Mutation Decomposition Safety Net

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G0 adds behaviour-focused regression coverage before mutation production code is decomposed. No mutation runtime implementation or public API changed in this slice.

## Added coverage

The new `tests/core/mutation-decomposition-safety.spec.ts` covers lifecycle boundaries most vulnerable to the planned extraction.

### No-op optimistic sessions

The tests verify that an unchanged optimistic draft:

- does not create an optimistic session;
- does not acquire ownership;
- does not change graph state or generations;
- does not notify or schedule;
- still permits remote execution and success reconciliation;
- preserves a later local success error rather than wrapping it as optimistic reconciliation failure;
- permits a subsequent effective optimistic mutation on the same node.

### Failure classifier stability

The tests verify that a throwing failure classifier:

- is invoked exactly once;
- enters the safe unknown-outcome path once;
- preserves the original remote failure as the public error cause;
- commits one optimistic transition and one stale reconciliation transition;
- releases ownership for a later optimistic mutation.

### Success-effect callback lifetime

The tests retain the success effects object after callback completion and verify that later calls to:

- `update(...)`;
- `invalidate(...)`;
- `publish(...)`;

are rejected with the existing closed-callback errors.

### Multiple-publication atomicity

The tests publish a valid event before a later event predicate reads an affected derived node. They verify that the later preparation failure prevents every earlier draft from committing:

- no direct update;
- no explicit invalidation;
- no earlier event invalidation;
- no later event invalidation;
- no observer notification.

### Optimistic reconciliation ownership release

The tests verify that remote success followed by an affected-derived predicate failure:

- rejects with `GraphMutationReconciliationError`;
- releases optimistic ownership;
- permits a later effective optimistic mutation on the same node.

## Existing matrix coverage retained

The existing focused mutation suites continue to cover:

- exact rollback ownership release;
- rollback-conflict ownership release;
- unknown-outcome ownership release;
- remote-success reconciliation-failure ownership release;
- monotonic generations and generation-before-abort ordering;
- ignored-abort completion protection;
- rollback scheduling for stale subscribed snapshots;
- success commit notification and scheduler coalescing;
- updater purity and atomic preparation;
- optimistic descendant loading and rollback conflicts;
- affected-derived event predicate restrictions.

G0 supplements these tests rather than duplicating every existing scenario in one parameterised implementation-oriented test.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Runtime and transaction event test sources compiled with the same strict settings.
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

M9H-G1 must not start until the complete dependency-backed suite passes against this G0 package.

## Next task

After full validation, implement M9H-G1 by extracting update draft collection and preparation into `mutation-update-planner.ts` without changing runtime behaviour.
