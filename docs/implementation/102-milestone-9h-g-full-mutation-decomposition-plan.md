# Milestone 9H-G: Full Mutation Controller Decomposition Plan

## Status

M9H-G0 through M9H-G6 are implemented and validated. The project owner reported successful dependency-backed type checking, full test execution, boundary validation, and production build on 15 September 2026.

M9H-A through M9H-F behaviour is the baseline. M9H-G is a mechanical internal refactor before Milestone 10 observability.

## Decision

Proceed with the full decomposition now, before Milestone 10, because mutation lifecycle instrumentation will otherwise couple to one large controller and later move with the refactor.

The decomposition is justified by distinct responsibilities and lifecycle boundaries, not by file length. The public API, runtime wiring, graph state model, errors, notification behaviour, scheduling behaviour, and mutation semantics must remain unchanged.

## Goals

M9H-G will:

- separate pure update preparation from graph mutation;
- centralise optimistic ownership and snapshot invariants;
- centralise state-transition commit ordering;
- model remote settlement as explicit internal transitions;
- provide stable internal lifecycle seams for Milestone 10;
- preserve one runtime-level mutation coordinator;
- retain behaviour-focused tests as the primary specification.

## Non-goals

M9H-G will not:

- add or change public APIs;
- add public mutation state or progress reporting;
- add telemetry, tracing, or devtools events;
- alter failure classification;
- alter optimistic descendant loading;
- alter concurrency limits;
- alter notification or scheduler semantics;
- create generic repositories, services, base classes, or dependency-injection layers;
- replace runtime-level tests with internal implementation tests;
- optimise performance unless a regression is introduced by the refactor.

## Existing domain patterns to preserve

The core uses a controller plus focused supporting modules:

- execution retains lifecycle orchestration and extracts the concurrency limiter;
- events separate indexing and matching from runtime orchestration;
- transactions retain lifecycle coordination and extract notification buffering;
- refresh policies keep their state machine together while using focused environment and error modules;
- mutations already separate definitions, errors, types, and value guarding.

M9H-G follows that pattern. Supporting modules receive narrow dependencies and return explicit results. The mutation controller remains the single public-runtime entry coordinator.

## Target module structure

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

Only `mutation-controller.ts` is wired by `runtime.ts`. The extracted modules are private core implementation details and must not be exported from `src/core/index.ts`.

## Responsibility boundaries

### `mutation-update-planner.ts`

Owns pure update draft collection and preparation.

Responsibilities:

- collect synchronous `effects.update(...)` calls;
- reject calls after the callback closes;
- reject duplicate update targets before evaluating any updater;
- resolve equivalent node handles through registered keys;
- reject non-data targets;
- reject targets without a successful value;
- invoke development/test updater protection;
- reject in-place mutation attempts;
- reject Promise-like callbacks and updater results;
- unwrap protected replacement values;
- calculate `changed` using `Object.is` and visible-state rules;
- return immutable prepared update records.

Must not:

- mutate graph state;
- own optimistic ownership;
- abort work;
- notify or schedule;
- classify remote outcomes;
- know about event publications or rollback.

Proposed internal contract:

```ts
interface MutationUpdatePlanner {
  collect(
    work: (effects: MutationUpdateEffects) => void,
    operation: "optimistic" | "success",
  ): readonly MutationUpdateDraft[];

  prepare(
    drafts: readonly MutationUpdateDraft[],
  ): readonly PreparedMutationUpdate[];
}
```

The planner factory receives only `resolveRegisteredNode` and `getMutableState`.

### `optimistic-session.ts`

Owns optimistic session identity, ownership, snapshots, and rollback eligibility.

Responsibilities:

- maintain the private node-key to owner-token map;
- detect optimistic target conflicts before remote execution;
- capture complete target and affected-descendant snapshots;
- acquire ownership atomically for effective targets;
- record expected post-optimistic generations;
- expose immutable session data to settlement;
- release ownership idempotently for the owning session;
- calculate rollback conflict keys;
- include settled changed non-target data descendants in conflict detection;
- calculate whether restored snapshots require subscribed-stale scheduling.

Must not:

- execute mutation callbacks;
- commit data or freshness changes;
- notify or schedule directly;
- classify remote failures;
- construct public mutation errors.

Proposed internal contract:

```ts
interface OptimisticSessionManager {
  begin(
    targets: readonly PreparedMutationUpdate[],
    affectedNodes: readonly AnyNodeDefinition[],
  ): OptimisticSession;

  getRollbackConflicts(
    session: OptimisticSession,
  ): readonly string[];

  shouldScheduleRestoredState(
    session: OptimisticSession,
  ): boolean;

  release(session: OptimisticSession): void;
}
```

`begin(...)` records ownership and snapshots but does not commit optimistic values. This keeps ownership/snapshot policy separate from state-transition ordering.

The manager receives only node state lookup and subscription lookup. It does not receive `notify`, `schedule`, or invalidation commit capabilities.

### `mutation-commit.ts`

Owns mutation-specific graph transition ordering. It is not a generic configurable commit engine.

Responsibilities are exposed as named transitions, not boolean option bags:

```ts
interface MutationCommitter {
  commitOptimistic(...): void;
  commitSuccess(...): void;
  commitRollback(...): void;
  commitStaleReconciliation(...): void;
}
```

#### `commitOptimistic(...)`

- commits effective optimistic target values;
- marks direct targets successful and fresh;
- advances target generations;
- invalidates changed-result descendants;
- advances affected generations before aborting active work;
- records expected generations through the session manager result;
- emits one observer notification;
- requests at most one scheduler pass.

#### `commitSuccess(...)`

- commits prepared direct updates;
- commits combined direct, explicit, and event invalidation;
- preserves directly updated roots according to the combined plan;
- advances generations before abort;
- emits one notification;
- requests at most one scheduler pass.

#### `commitRollback(...)`

- restores logical snapshot fields;
- advances every restored generation exactly once;
- aborts active work only after generation advancement;
- emits one notification;
- requests one scheduler pass only for restored stale subscribed state.

#### `commitStaleReconciliation(...)`

Used by unknown outcome, rollback conflict, and remote-success reconciliation failure.

- retains current visible values;
- marks the captured affected graph stale;
- advances generations before abort;
- emits one notification;
- requests at most one scheduler pass.

The committer must use named methods because these transitions have materially different preservation rules. Do not introduce a generic method with flags such as `restore`, `stale`, `notify`, or `schedule`.

The committer receives state lookup, active-attempt lookup, combined invalidation preparation, `notify`, and `schedule`. It does not own sessions or classify outcomes.

### `mutation-settlement.ts`

Owns explicit post-execution lifecycle transitions.

Responsibilities:

- confirmed remote success;
- local success reconciliation failure;
- confirmed known rejection;
- rollback conflict;
- unknown remote outcome;
- failure-classifier exceptions;
- construction of the correct public error;
- guaranteed ownership release exactly once.

Proposed internal transition methods:

```ts
interface MutationSettlementCoordinator {
  settleSuccess<TResult>(...): TResult;
  settleFailure(...): never;
}
```

Internally, settlement must use named branch functions:

```text
settleConfirmedSuccess
settleReconciliationFailure
settleKnownRejection
settleRollbackConflict
settleUnknownOutcome
```

Settlement may call the session manager and committer, but it must not directly edit mutable graph state.

### `mutation-controller.ts`

Remains the single runtime-facing coordinator.

Responsibilities after decomposition:

- expose `mutate(...)`;
- create the attempt-scoped `AbortController`;
- run optimistic callback preparation;
- start remote execution;
- delegate confirmed success or failure to settlement;
- preserve synchronous-throw normalisation through the Promise chain.

The target controller should read as lifecycle orchestration rather than state-manipulation detail.

Illustrative shape:

```ts
const mutate = <TInput, TResult>(...) => {
  const controller = new AbortController();
  let optimistic: OptimisticSession | undefined;

  return Promise.resolve()
    .then(() => {
      optimistic = prepareAndCommitOptimistic(...);
      return mutation.execute({ input, signal: controller.signal });
    })
    .then(
      result => settlement.settleSuccess(...),
      error => settlement.settleFailure(...),
    );
};
```

This is illustrative only. Existing type inference and synchronous-error behaviour must be retained.

## Dependency direction

Allowed dependency direction:

```text
mutation-controller
  -> mutation-settlement
  -> optimistic-session
  -> mutation-commit
  -> mutation-update-planner

mutation-settlement
  -> optimistic-session
  -> mutation-commit
  -> mutation-update-planner for success preparation

mutation-commit
  -> invalidation controller contract
  -> mutable state and active attempts

optimistic-session
  -> mutable state and subscriptions

mutation-update-planner
  -> mutable state, node resolution, value guard
```

Prohibited dependencies:

- support modules importing `mutation-controller.ts`;
- circular imports between settlement and commit;
- commit constructing settlement errors;
- session manager notifying or scheduling;
- planner importing invalidation, events, scheduler, or subscriptions;
- runtime wiring each internal module independently.

## Shared internal types

Create a private `mutation-internals.ts` only if type-only imports would otherwise create cycles. Prefer colocating types with their owning module:

- drafts and prepared updates belong to the planner;
- snapshots and sessions belong to the session manager;
- success effect plans belong to settlement or commit according to who constructs them.

Do not create a miscellaneous shared-types file merely for convenience.

## Behavioural invariants that must not change

### Update preparation

- all targets validate before any updater executes;
- duplicates reject before updater evaluation;
- equivalent handles resolve by registered key;
- placeholder initial values are not successful mutation targets;
- success and optimistic callbacks are synchronous;
- updater results are synchronous;
- in-place array and plain-object writes fail in development/test;
- no protected proxy enters committed state;
- non-plain values retain immutable replacement semantics.

### Optimistic application

- no-op optimistic drafts create no session and do not start ownership;
- conflicts reject before the second remote request starts;
- snapshots cover effective targets and affected descendants;
- target and descendant state changes commit atomically;
- subscribed descendants may load before remote settlement;
- mutation execution remains outside `maxConcurrentLoads`.

### Confirmed success

- success effects prepare completely before commit;
- direct updates, explicit invalidation, and events commit once;
- final direct values are visible to event predicates through overlays;
- affected derived predicate reads reject;
- optimistic targets also prohibit affected derived reads;
- event publications remain success-only;
- local reconciliation failure after remote success never rolls back.

### Known rejection and rollback

- rollback requires ownership and expected-generation matches;
- changed settled non-target data descendants cause conflict;
- rollback restores logical fields but generations remain monotonic;
- all generations advance before active work is aborted;
- ignored-abort completions cannot become current;
- stale subscribed restored state schedules once;
- fresh or unsubscribed restored state does not schedule;
- original rejection remains the error or error cause as specified.

### Unknown outcome and conflicts

- optimistic values remain visible;
- affected state becomes stale;
- ownership releases;
- subscribed authoritative recovery schedules once;
- immutable unique sorted node keys are preserved;
- public errors and `cause` semantics remain unchanged.

### Dispatch and settlement

- each committed mutation transition emits one coherent state notification;
- scheduler notification transitions remain separate scheduler behaviour;
- listener failures remain isolated by the existing observer;
- `whenSettled()` includes mutation-triggered scheduler work;
- every branch releases optimistic ownership exactly once;
- non-optimistic failures preserve their existing errors.

## Test coverage assessment

The existing mutation suite already covers the major external behaviour across:

```text
mutation-execution.spec.ts
mutation-reconciliation.spec.ts
mutation-success-effects.spec.ts
mutation-optimistic.spec.ts
mutation-outcomes-races.spec.ts
mutation-reconciliation-failure.spec.ts
mutation-rollback-scheduling.spec.ts
mutation-updater-purity.spec.ts
mutation-optimistic-descendants.spec.ts
mutation-event-derived-restrictions.spec.ts
```

These runtime-level tests remain the primary regression suite.

## Additional tests required before moving code

Add a focused decomposition safety suite before the first extraction. These tests close lifecycle gaps that are especially vulnerable to module boundaries.

### Ownership release matrix

Add one parameterised or clearly grouped runtime test for ownership release after:

- confirmed success;
- known rejection with exact rollback;
- known rejection with rollback conflict;
- unknown outcome;
- classifier exception;
- remote success with local reconciliation failure;
- success event predicate restriction failure.

Each case must prove a later optimistic mutation can target the same node.

### Notification matrix

Verify graph-state notifications for:

- optimistic apply;
- confirmed success reconciliation;
- exact rollback;
- unknown outcome stale reconciliation;
- rollback-conflict stale reconciliation;
- remote-success reconciliation-failure stale reconciliation.

Assertions should use visible state snapshots rather than internal calls. Scheduler state notifications must not be mistaken for extra mutation commits.

### Generation and abort ordering matrix

For optimistic commit, success commit, rollback, and stale reconciliation:

- capture the active attempt generation;
- observe abort;
- assert the runtime generation has already advanced when abort is observed;
- resolve an ignored-abort loader;
- assert it cannot overwrite current state.

Existing tests cover several branches, but the matrix should explicitly cover all four commit methods planned for extraction.

### No-op optimistic session

Add coverage proving an optimistic callback that returns only unchanged values:

- creates no ownership conflict;
- does not change generations;
- emits no graph notification;
- does not schedule;
- still allows the remote command and success effects to run;
- does not wrap a later local success failure as optimistic reconciliation failure.

### Failure classifier single invocation

Add coverage proving:

- `classifyFailure` runs once;
- a classifier throw enters the unknown path once;
- ownership releases once;
- one stale reconciliation commit occurs;
- the original remote failure remains the cause of `GraphMutationOutcomeUnknownError` according to the existing contract.

### Success callback lifetime

Add coverage proving retained success effects cannot be used after callback completion for:

- `update`;
- `invalidate`;
- `publish`.

This protects callback closure state when collection moves to the planner or settlement module.

### Multi-publication affected-derived failure

Add coverage where:

- an earlier publication matches validly;
- a later publication reads a prohibited derived dependency;
- no earlier event invalidation commits;
- no direct update or explicit invalidation commits;
- publication order remains deterministic for the valid case.

### Multiple rollback conflict reasons

Add one test combining:

- a generation mismatch;
- a settled changed data descendant;
- duplicate graph paths.

Assert immutable, unique, sorted conflict keys and one stale reconciliation commit.

## Internal module tests

Add internal unit tests only for pure or policy-dense modules. Do not test simple delegation.

### Planner tests

Directly test:

- validation before updater execution;
- duplicate detection;
- synchronous callback closure;
- Promise-like rejection;
- purity guard translation;
- protected-value unwrapping;
- `changed` calculation.

Keep runtime tests for all externally observable outcomes.

### Optimistic session tests

Directly test only pure policy that is awkward to isolate through runtime tests:

- ownership acquisition is atomic;
- conflict keys are unique and sorted;
- settled changed data descendant detection;
- release is owner-safe and idempotent;
- restored stale subscribed scheduling decision.

Do not expose these types publicly.

### Commit and settlement tests

Prefer runtime-level tests. Add direct tests only if exact ordering cannot be observed through public state and abort signals. Avoid mocks that merely verify one internal module called another.

## Delivery plan

### M9H-G0: Baseline and safety-net tests

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/103-milestone-9h-g0-safety-net-note.md`.

No production refactor.

Tasks:

1. Run and record the full validation baseline.
2. Add the ownership release matrix.
3. Add the notification matrix.
4. Add missing generation and abort-order cases.
5. Add no-op optimistic session coverage.
6. Add classifier single-invocation coverage.
7. Add callback lifetime coverage.
8. Add multi-publication atomic-failure coverage.
9. Add multiple rollback-conflict-reason coverage.

Exit criteria:

- all existing and new tests pass;
- no production behaviour changes;
- the test names describe behaviour, not proposed modules.

### M9H-G1: Extract update planning

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/104-milestone-9h-g1-update-planner-extraction-note.md`.

Tasks:

1. Add `mutation-update-planner.ts`.
2. Move draft and prepared-update types.
3. Move callback collection.
4. Move target validation and updater evaluation.
5. Keep all function signatures and error messages stable.
6. Wire one planner instance inside `createRuntimeMutationController(...)`.

Exit criteria:

- controller owns no updater-protection details;
- planner has no scheduling, invalidation, event, session, or settlement dependency;
- full suite passes unchanged.

### M9H-G2: Extract optimistic sessions

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/105-milestone-9h-g2-optimistic-session-extraction-note.md`.

Tasks:

1. Add `optimistic-session.ts`.
2. Move snapshot and session types.
3. Move ownership map into the session manager closure.
4. Move snapshot capture.
5. Move atomic ownership acquisition and release.
6. Move rollback conflict calculation.
7. Move restored-state scheduling decision.
8. Keep optimistic state commits in the controller or committer until G3.

Exit criteria:

- only the session manager can read or write ownership tokens;
- session manager does not notify, schedule, abort, or commit state;
- full suite passes.

### M9H-G3: Extract named commit transitions

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/106-milestone-9h-g3-mutation-commit-extraction-note.md`.

Tasks:

1. Add `mutation-commit.ts`.
2. Move optimistic state commit.
3. Move confirmed success commit.
4. Move exact rollback commit.
5. Move stale reconciliation commit.
6. Preserve generation-before-abort ordering visibly in each named method.
7. Preserve one notification and at-most-one schedule decision.
8. Do not introduce a generic flag-driven commit operation.

Exit criteria:

- all mutable graph writes owned by mutation flow occur in the committer;
- session manager remains mutation-free;
- settlement and controller do not edit mutable node fields;
- ordering matrix passes.

### M9H-G4: Extract settlement coordination

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/107-milestone-9h-g4-mutation-settlement-extraction-note.md`.

Tasks:

1. Add `mutation-settlement.ts`.
2. Move success-effect draft preparation and event matching into confirmed-success settlement preparation.
3. Move known-rejection classification handling.
4. Move rollback conflict conversion.
5. Move unknown-outcome conversion.
6. Move reconciliation-failure conversion.
7. Guarantee ownership release on all branches.
8. Keep the public errors unchanged.

Exit criteria:

- settlement does not directly edit mutable graph state;
- controller contains the remote attempt Promise flow and delegates outcomes;
- ownership matrix passes;
- public error contract tests pass.

### M9H-G5: Controller simplification and lifecycle seams

Status: Implemented. Offline full-suite validation pending. See `docs/implementation/108-milestone-9h-g5-controller-lifecycle-seams-note.md`.

Tasks:

1. Reduce `mutation-controller.ts` to dependency composition and `mutate(...)` orchestration.
2. Add explicit private lifecycle transition names suitable for M10 instrumentation.
3. Do not emit observability events yet.
4. Audit dependency direction and remove accidental cycles.
5. Run boundary checks and inspect the generated module graph.

Exit criteria:

- `runtime.ts` still creates only one mutation controller;
- no extracted module is publicly exported;
- no public API or type declaration changes;
- M10 can instrument named transitions without observing low-level helper calls.

### M9H-G6: Final regression and documentation

Status: Implemented with static validation complete. Dependency-backed validation remains pending. See `docs/implementation/109-milestone-9h-g6-final-regression-summary.md`.

Tasks:

1. Run full type checking.
2. Run the complete test suite.
3. Run production build.
4. Run boundary checks.
5. Review test output for warnings and unhandled rejections.
6. Compare public declaration output if available.
7. Update architecture, ADR, test strategy, roadmap, and implementation summary.
8. Record the final internal dependency diagram and lifecycle transition list.

Exit criteria:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

All commands pass from the combined checkout.

## Per-step change-control rules

Each step must:

- start from the previous passing cumulative package;
- move one responsibility only;
- avoid unrelated renaming or formatting;
- preserve existing error text unless a test proves it is internal and irrelevant;
- retain public runtime behavioural tests;
- produce a separate cumulative package;
- stop if a behavioural test requires changing expected semantics;
- document any discrepancy before proceeding.

Do not combine G2, G3, and G4 in one change. Their boundaries are exactly where ownership, commit ordering, and settlement errors can regress.

## Rollback strategy

Every sub-step is independently revertible:

- G1 can revert planner wiring without touching sessions;
- G2 can restore the ownership map to the controller without touching commit logic;
- G3 can restore named commit functions to the controller without changing settlement;
- G4 can restore settlement branches to the controller without changing planner, session, or commit modules;
- G5 is cleanup only and must not contain semantic changes.

If a step reveals that its proposed module needs most controller dependencies, stop and revise the boundary instead of forwarding the full dependency object.

## Review checklist

Before approving each extraction, verify:

- Does the module own one coherent policy?
- Are its dependencies narrower than the original controller's?
- Does it avoid direct imports from later lifecycle layers?
- Can its result be described without mentioning file length?
- Does error translation occur at the correct layer?
- Is ownership released exactly once?
- Are generations advanced before abort?
- Is notification emitted once per committed graph transition?
- Is scheduling requested at most once?
- Are optimistic and non-optimistic paths still distinct where required?
- Are M9H-E descendant conflict rules preserved?
- Are M9H-F optimistic affected-derived rules preserved?
- Are public exports unchanged?

## Expected result

After M9H-G, mutation behaviour remains unchanged, but the implementation has four explicit internal layers:

```text
prepare -> session -> commit -> settle
```

The controller remains the runtime-facing coordinator. Milestone 10 can instrument lifecycle transitions at settlement and commit boundaries without coupling to updater validation, ownership-map details, or individual mutable-state assignments.
