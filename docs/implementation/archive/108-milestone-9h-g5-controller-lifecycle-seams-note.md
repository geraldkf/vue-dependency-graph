# Milestone 9H-G5: Controller Simplification and Lifecycle Seams

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G5 completes the internal mutation decomposition before final regression. It keeps `mutation-controller.ts` as the only runtime-facing mutation composition root and introduces four explicit private lifecycle seam names for future Milestone 10 instrumentation.

No observability events, hooks, telemetry, tracing, devtools messages, public APIs, or public types were added.

## Controller responsibilities

The controller now owns only:

- composition of the update planner, optimistic session manager, committer, and settlement coordinator;
- optimistic lifecycle entry;
- remote attempt `AbortController` creation;
- remote execution;
- fulfilled and rejected outcome delegation;
- the public `mutate(...)` method.

All update validation, ownership policy, graph writes, and settlement error translation remain in their extracted modules.

## Lifecycle seams

The controller now names these private transition boundaries:

```text
startOptimisticSession
executeRemoteMutation
settleRemoteSuccess
settleRemoteFailure
```

These functions have deliberately narrow meanings.

### `startOptimisticSession`

- collects and prepares optimistic updates;
- ignores a fully effective no-op;
- prepares affected descendants;
- asks session policy to acquire ownership and capture snapshots;
- constructs the existing optimistic conflict error;
- delegates the optimistic graph commit;
- captures expected generations after commit.

### `executeRemoteMutation`

- invokes the mutation definition once;
- passes the typed input and attempt-scoped abort signal;
- remains outside the data-load concurrency limiter.

### `settleRemoteSuccess`

- delegates confirmed remote success to the settlement coordinator;
- supplies the mutation key required for reconciliation errors;
- returns the original typed result.

### `settleRemoteFailure`

- delegates remote failure and optional classification;
- preserves the settlement coordinator's `never` return contract.

Milestone 10 can instrument these high-level boundaries without observing updater validation, ownership-map access, individual state assignments, event matching internals, or error-construction details.

## Why no lifecycle hook abstraction was added

G5 names stable lifecycle boundaries but does not introduce an observer interface or no-op callback dependency. Adding that abstraction before Milestone 10 defines its event model would create speculative API shape and unnecessary call plumbing.

The named private functions are sufficient seams. Milestone 10 can add one narrow internal observer at these points after its required event payloads and ordering rules are confirmed.

## Internal dependency graph

The audited mutation dependency direction is:

```text
runtime
  -> mutation-controller
       -> mutation-update-planner
            -> mutation-value-guard
       -> optimistic-session
       -> mutation-commit
            -> optimistic-session (types only)
            -> mutation-update-planner (types only)
       -> mutation-settlement
            -> mutation-update-planner
            -> optimistic-session
            -> mutation-commit
```

Supporting modules do not import `mutation-controller.ts`. The audit found no cycle among mutation production modules.

`runtime.ts` continues to create exactly one mutation controller and does not wire the extracted modules independently.

## Public surface audit

None of these internal modules are exported from `src/core/index.ts`:

```text
mutation-update-planner.ts
optimistic-session.ts
mutation-commit.ts
mutation-settlement.ts
```

The public mutation definition, options, effects, errors, and runtime `mutate(...)` signature remain unchanged.

## Behaviour preservation

G5 changes private function names and delegation structure only. It preserves:

- synchronous throw normalisation through `Promise.resolve().then(...)`;
- optimistic work before remote execution;
- conflict rejection before remote execution;
- one remote execution per mutation call;
- typed result propagation;
- fulfilled and rejected Promise branch behaviour;
- all M9H-A through M9H-F correctness rules;
- all G0 lifecycle safety rules.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Runtime and transaction event test sources compiled with the same strict settings.
- Core boundary validation passed.
- Static import-graph analysis found no cycle among mutation production modules.
- Static public-surface checks confirmed that extracted modules remain private.
- Static runtime wiring checks confirmed that `runtime.ts` creates only `createRuntimeMutationController(...)`.
- Static lifecycle checks confirmed that all four named seams are present and no observability emission was introduced.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-G6 must not be marked complete until the entire dependency-backed suite, type check, boundary check, and production build succeed against this G5 package.

## Next task

Implement M9H-G6 final regression and documentation reconciliation. Do not begin Milestone 10 until G6 confirms the composed mutation lifecycle passes the complete repository validation.
