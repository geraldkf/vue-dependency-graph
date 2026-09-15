# Milestone 9H-G2: Optimistic Session Extraction

## Status

Implemented. Offline full-suite validation pending.

## Scope

M9H-G2 mechanically extracts optimistic ownership, snapshots, expected generations, rollback conflict policy, owner-safe release, and restored-state scheduling policy from `mutation-controller.ts` into the internal `optimistic-session.ts` module.

Graph commits, generation advancement, active-attempt aborts, notifications, scheduling requests, error construction, remote execution, and settlement remain outside the session manager.

## Extracted responsibilities

The optimistic session manager now owns:

- the private node-key to owner-token map;
- atomic conflict detection and ownership acquisition;
- target and affected-descendant snapshot capture;
- immutable target and snapshot collections;
- expected post-optimistic generation capture;
- owner-safe idempotent ownership release;
- rollback ownership conflict detection;
- rollback generation conflict detection;
- settled changed non-target data descendant detection;
- unique sorted rollback conflict keys;
- restored stale subscribed scheduling decisions.

Only the session manager can read or write optimistic ownership tokens.

## Internal contract

`createOptimisticSessionManager(...)` receives only:

```ts
getMutableState
hasSubscribers
```

It exposes:

```ts
begin(targets, affectedNodes)
captureExpectedGenerations(session)
getRollbackConflicts(session)
shouldScheduleRestoredState(session)
release(session)
```

`begin(...)` returns a discriminated result. The controller retains construction of `GraphMutationConflictError`, keeping public error translation outside the session policy layer.

Expected generations are captured only after the controller completes the optimistic graph commit. This preserves the existing rollback baseline while keeping graph mutation out of the session manager.

## Controller changes

The controller now:

1. prepares effective optimistic updates;
2. prepares the affected invalidation set;
3. asks the session manager to capture snapshots and acquire ownership;
4. constructs the existing conflict error if acquisition fails;
5. performs the existing optimistic graph commit;
6. asks the session manager to capture expected generations.

Rollback asks the manager for conflict keys and restored-state scheduling policy. The controller still performs rollback state restoration, generation advancement, abort, notification, and scheduling in the existing order.

## Preserved invariants

The extraction preserves:

- no ownership for no-op optimistic drafts;
- conflict rejection before the second remote request starts;
- complete target and affected-descendant snapshots;
- ownership acquisition before optimistic state mutation;
- expected generations captured after optimistic invalidation commits;
- owner-safe release on every settlement path;
- exact rollback only when ownership and generation checks pass;
- changed settled non-target data descendants preventing rollback;
- immutable unique sorted rollback conflict keys;
- stale subscribed rollback scheduling;
- no scheduling for fresh or unsubscribed restored snapshots;
- graph generations advancing before active work is aborted;
- one notification and at most one scheduler request per graph transition.

## Deliberate boundary

The manager does not:

- mutate node state;
- commit invalidation plans;
- inspect active attempts;
- abort work;
- notify observers;
- request scheduler work;
- execute callbacks or remote mutations;
- classify failures;
- construct public errors.

These restrictions keep session policy separate from the named commit transitions planned for M9H-G3.

## Public surface

`optimistic-session.ts` is not exported from `src/core/index.ts`. Its interfaces and discriminated start result are internal implementation contracts.

`runtime.ts` continues to construct only the mutation controller.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation tests passed using a local Vitest declaration shim.
- Runtime and transaction event test sources compiled with the same strict settings.
- Core boundary validation passed.
- Static architecture checks confirmed that the session manager has no active-attempt, invalidation, notification, scheduler, event, or settlement dependency.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-G3 must not start until the complete dependency-backed suite passes against this G2 package.

## Next task

After full validation, implement M9H-G3 by extracting the named optimistic, success, rollback, and stale-reconciliation graph transitions into `mutation-commit.ts` without introducing a generic flag-driven commit operation.
