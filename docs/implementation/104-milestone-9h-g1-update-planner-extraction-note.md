# Milestone 9H-G1: Mutation Update Planner Extraction

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G1 mechanically extracts mutation update draft collection and preparation from `mutation-controller.ts` into the internal `mutation-update-planner.ts` module.

No public API, runtime wiring, graph behaviour, error contract, notification behaviour, scheduling behaviour, ownership rule, or settlement rule changed.

## Extracted responsibilities

The planner now owns:

- synchronous optimistic and success update callback collection;
- callback lifetime enforcement;
- registered-node resolution for update targets;
- data-node target validation;
- duplicate target rejection before updater evaluation;
- successful-value validation before any updater executes;
- development and test updater mutation protection;
- protected replacement unwrapping;
- Promise-like callback and updater rejection;
- prepared replacement values;
- effective `changed` calculation.

The planner returns prepared records but never mutates graph state.

## Internal contract

`createMutationUpdatePlanner(...)` receives only:

```ts
resolveRegisteredNode
getMutableState
```

It exposes:

```ts
collect(work, operation)
prepare(drafts)
```

The planner does not depend on:

- invalidation;
- event matching;
- optimistic sessions;
- active attempts;
- subscriptions;
- notifications;
- scheduling;
- remote execution;
- settlement or failure classification.

## Controller changes

`createRuntimeMutationController(...)` creates one planner instance and delegates both update paths:

```ts
updatePlanner.prepare(
  updatePlanner.collect(...),
)
```

The controller continues to own:

- optimistic ownership;
- snapshot capture;
- optimistic commit;
- success invalidation and event planning;
- rollback and conflict handling;
- unknown-outcome reconciliation;
- remote-success reconciliation failure;
- remote execution and settlement orchestration.

The controller no longer imports or invokes the mutation value guard directly.

## Preserved behaviour

The extraction preserves existing messages and ordering for:

- closed callback use;
- asynchronous callback rejection;
- equivalent registered handles;
- non-data target rejection;
- duplicate target rejection;
- never-successful target rejection;
- validation of every target before updater evaluation;
- updater mutation rejection;
- asynchronous updater rejection;
- immutable replacement of arrays, plain objects, and non-plain values;
- no-op update detection.

The M9H-G0 lifecycle safety suite and all existing mutation suites remain the external behavioural specification.

## Public surface

`mutation-update-planner.ts` is not exported from `src/core/index.ts`. Its interfaces are internal implementation contracts only.

`runtime.ts` continues to construct only `createRuntimeMutationController(...)` and does not wire the planner independently.

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

M9H-G2 must not start until the complete dependency-backed suite passes against this G1 package.

## Next task

After full validation, implement M9H-G2 by extracting optimistic ownership, snapshots, expected generations, conflict calculation, owner-safe release, and rollback scheduling policy into `optimistic-session.ts`.
