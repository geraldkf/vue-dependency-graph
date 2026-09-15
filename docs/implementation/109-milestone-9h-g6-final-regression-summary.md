# Milestone 9H-G6: Final Regression and Decomposition Summary

## Status

Complete and validated. Static validation was completed in the contained environment. The project owner reported successful dependency-backed repository validation on 15 September 2026, so the Milestone 10 gate is open.

## Final implementation structure

The mutation runtime is decomposed into focused internal layers:

```text
src/core/mutations/
  errors.ts
  mutation.ts
  types.ts
  mutation-value-guard.ts
  mutation-update-planner.ts
  optimistic-session.ts
  mutation-commit.ts
  mutation-settlement.ts
  mutation-controller.ts
```

Only `mutation-controller.ts` is constructed by `runtime.ts`. The extracted modules remain private and are not exported from `src/core/index.ts`.

## Responsibility summary

### Update planner

`mutation-update-planner.ts` owns:

- synchronous optimistic and success update collection;
- callback lifetime enforcement;
- target resolution and validation;
- validation-before-updater ordering;
- duplicate detection;
- successful-value requirements;
- updater purity protection;
- Promise-like rejection;
- protected-value unwrapping;
- effective change calculation.

It does not mutate graph state.

### Optimistic session manager

`optimistic-session.ts` owns:

- optimistic ownership tokens;
- atomic conflict detection and ownership acquisition;
- target and affected-descendant snapshots;
- expected-generation baselines;
- rollback conflict policy;
- settled changed descendant detection;
- owner-safe release;
- restored stale subscribed scheduling decisions.

It does not commit, abort, notify, schedule, or construct public errors.

### Mutation committer

`mutation-commit.ts` owns four named graph transitions:

```text
commitOptimistic
commitSuccess
commitRollback
commitStaleReconciliation
```

It owns mutation graph writes, generation advancement, abort ordering, notification, and scheduler requests. The transitions remain explicit rather than using a generic boolean option bag.

### Settlement coordinator

`mutation-settlement.ts` owns:

- confirmed-success effect preparation;
- explicit invalidation and event preparation;
- affected-derived predicate restrictions;
- known rejection;
- rollback conflict conversion;
- unknown outcomes;
- classifier failure fallback;
- remote-success reconciliation failure;
- existing public mutation error construction.

It delegates every graph transition to the committer.

### Runtime mutation controller

`mutation-controller.ts` remains the single runtime-facing composition root. It owns:

- internal collaborator composition;
- optimistic lifecycle entry;
- caller-owned remote attempt creation;
- remote execution;
- fulfilled and rejected outcome delegation;
- public `mutate(...)` orchestration.

## Lifecycle transitions

The final high-level lifecycle is:

```text
mutation requested
  -> optional optimistic session start
  -> remote execution
  -> confirmed success settlement
     -> success preparation
     -> success commit
     -> ownership release
  -> or remote failure settlement
     -> known rejection
        -> exact rollback
        -> or rollback-conflict stale reconciliation
     -> or unknown-outcome stale reconciliation
```

Confirmed remote success with a local reconciliation failure follows:

```text
remote success
  -> local preparation failure
  -> stale reconciliation
  -> ownership release
  -> GraphMutationReconciliationError
```

## Milestone 10 instrumentation seams

The controller exposes no public hooks, but names these private lifecycle seams:

```text
startOptimisticSession
executeRemoteMutation
settleRemoteSuccess
settleRemoteFailure
```

The committer and settlement coordinator also expose named internal transitions. Milestone 10 can instrument these boundaries without observing low-level validation, ownership-map operations, or individual mutable-state assignments.

No observability event model was added during M9H-G.

## Dependency direction

The final internal dependency graph is:

```text
runtime
  -> mutation-controller
       -> mutation-update-planner
            -> mutation-value-guard
       -> optimistic-session
       -> mutation-commit
            -> optimistic-session (types)
            -> mutation-update-planner (types)
       -> mutation-settlement
            -> mutation-update-planner
            -> optimistic-session
            -> mutation-commit
```

Static import analysis found no cycle. Supporting modules do not import `mutation-controller.ts`.

## Public API review

Static comparison confirms:

- `src/core/index.ts` does not export the four extracted modules;
- `GraphRuntime.mutate(...)` remains unchanged;
- mutation definition, option, effect, and error exports remain unchanged;
- `runtime.ts` still constructs exactly one mutation controller;
- runtime does not independently construct extracted mutation collaborators.

No generated declaration baseline is stored in the repository, so declaration-output comparison requires the production build in the normal dependency-backed environment.

## Test coverage retained

The complete behaviour-focused mutation suite remains the primary specification, including:

- base mutation execution;
- atomic success reconciliation;
- success updates, invalidation, and typed events;
- optimistic application and exact rollback;
- unknown outcomes and races;
- reconciliation failure recovery;
- rollback scheduler recovery;
- updater purity;
- optimistic descendant execution;
- affected-derived event restrictions;
- G0 decomposition safety coverage.

The G0 safety suite specifically protects no-op optimistic ownership, classifier single invocation, success-effect lifetime, multi-publication atomicity, and ownership release after reconciliation failure.

## Validation completed

The following checks passed in the contained environment:

- strict TypeScript compilation of core and mutation-related test sources using a local Vitest declaration shim;
- core boundary validation;
- mutation import-cycle analysis;
- extracted-module privacy checks;
- single-controller runtime wiring checks;
- lifecycle-seam checks;
- controller graph-write boundary checks;
- settlement graph-write boundary checks;
- documentation structure and internal-link checks;
- cumulative archive integrity validation.

## Dependency-backed validation limitation

The contained checkout had no `node_modules`. Dependency installation could not complete within the execution environment, and `pnpm install --frozen-lockfile` also reported that the supplied lockfile was not current for the installed pnpm version.

For that reason, G6 does not claim that the complete Vitest suite, Vue type check, production build, or generated declaration output ran in the contained environment.

## Required completion gate

Run these commands from the cumulative checkout in the normal development environment:

```text
pnpm install
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Review test output for:

- failed tests;
- unhandled rejections;
- unexpected warnings;
- changed notification counts;
- changed public errors or causes.

The existing Vue missing-injection warning from the intentional plugin guard test is expected if it remains paired with a passing test.

## Completion decision

M9H-G implementation is complete, but the milestone validation gate remains open until all four repository checks pass. Do not begin Milestone 10 based only on static validation.
