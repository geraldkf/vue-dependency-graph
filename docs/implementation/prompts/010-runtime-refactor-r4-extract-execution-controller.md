# Implementation Prompt 010: Extract the Execution Controller

## Role

You are implementing **R4** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D, R2, and R3 have been validated offline.

The validated baseline includes:

- Immutable typed node definitions and validated topology
- Per-runtime mutable node state in a closure-based runtime-state store
- Runtime-local active-attempt storage with token-safe cleanup
- Typed frozen runtime-state snapshots
- A closure-based runtime observer
- Eleven established notification ownership points
- Standardised registered-node validation
- Explicit, scheduler, prefetch, and refresh execution origins
- One dependency-aware execution engine
- Branch-scoped execution failures
- Generation and token-based obsolete-result protection
- In-flight attempt sharing

R4 extracts the existing execution engine from `runtime.ts` into one closure-based internal execution controller.

R4 is a behavior-preserving extraction. It must not create a second execution path or redesign execution semantics.

Do not start R5 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/16-runtime-refactor-r2-observation-implementation-note.md`
- `docs/implementation/17-runtime-refactor-r3-state-storage-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `src/core/runtime-state.ts`
- `src/core/runtime-observer.ts`
- `src/core/execution.ts`
- `executeNode(...)`
- `executeInternal(...)`
- `getDependencyValue(...)`
- `NodeAttemptFailure`
- `NodeBlockedFailure`
- `ObsoleteAttempt`
- `hasFreshSuccessfulValue(...)`
- Attempt origin sharing
- Active-attempt construction and token-safe cleanup
- Refresh-result descendant invalidation
- Execution notification call sites
- Registered-target validation timing
- Existing execution, failure, race, deduplication, prefetch, refresh, scheduler, and cancellation tests

If the repository differs from this prompt, describe the discrepancy and make the smallest reasonable adjustment. Do not infer missing behavior.

## Environment constraint

You are working in a contained environment.

Do not:

- Install dependencies
- Run pnpm commands
- Run TypeScript compilation
- Run Vitest
- Run Vite
- Claim offline validation succeeded

You must:

1. Apply only the R4 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve the single execution engine.
5. Preserve execution-origin sharing and cancellation ownership.
6. Preserve validation timing and branch-scoped failure behavior.
7. Preserve all established notification points and timing.
8. Return a ZIP containing only files added or changed for R4.
9. Provide exact offline validation commands.
10. Report project commands as `Not run in contained environment`.

No file deletion is expected for R4.

## Objective

Extract the existing execution engine into:

```text
src/core/runtime-execution.ts
```

Use one small closure-based controller with a narrow explicit dependency contract.

A reasonable internal direction is:

```ts
interface RuntimeExecutionController {
  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    origin: ExecutionOrigin
  ) => Promise<void>;
}

interface RuntimeExecutionDependencies {
  readonly graph: Graph;
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;
  readonly setActiveAttempt: (
    key: string,
    attempt: ActiveAttempt
  ) => void;
  readonly deleteActiveAttempt: (
    key: string,
    token: symbol
  ) => void;
  readonly requireRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onChangedRefreshResult: (
    node: AnyNodeDefinition
  ) => void;
}
```

The exact contract may differ if a smaller interface preserves behavior more clearly.

Prefer the simplest controller that:

- Owns execution orchestration
- Uses the existing runtime-state store
- Uses the existing graph topology
- Preserves notification ownership
- Preserves one execution engine for every origin
- Does not absorb scheduler, subscription, invalidation, or refresh-operation orchestration

## Public API constraint

The complete public API remains unchanged:

```ts
runtime.getState(node);
runtime.setContext(contextNode, value);

runtime.execute(nodes);
runtime.prefetch(nodes);
runtime.refresh(nodes);

runtime.subscribeNodes(nodes);
runtime.getSubscriptionState(node);
runtime.hasSubscribers(node);

runtime.getSchedulerState();
runtime.whenSettled();

runtime.onChange(listener);
```

Do not add, remove, rename, overload, or export public APIs.

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

Keep these public error contracts unchanged:

```ts
GraphExecutionError
NodeExecutionFailure
NodeExecutionFailureKind
```

Do not publicly export:

- `RuntimeExecutionController`
- `RuntimeExecutionDependencies`
- `executeNode(...)`
- `executeInternal(...)`
- `NodeAttemptFailure`
- `NodeBlockedFailure`
- `ObsoleteAttempt`
- `ExecutionOrigin`
- `ActiveAttempt`
- Internal dependency-value access

## Ownership boundary

### R4 execution controller owns

- Per-operation target resolution inside the existing async execution boundary
- Recursive dependency orchestration
- Required-parent execution
- Per-operation requested-node promise deduplication
- Branch failure collection
- Blocked-descendant reporting
- Node attempt reuse for the same generation
- Adding an execution origin to a shared attempt
- Attempt construction
- Attempt-scoped `AbortController` creation
- Attempt start state transition
- Loader execution
- Derived calculation
- Dependency-value access during execution
- Success commit checks
- Failure commit checks
- Obsolete and abort handling
- Token-safe active-attempt cleanup through the state store
- Construction and throwing of `GraphExecutionError`
- Execution-owned notifications after attempt start, committed success, and committed failure

### `runtime.ts` continues to own

- Public operation entry points
- Mapping public operations to execution origins
- Subscription lifecycle
- Final-unsubscribe cancellation decisions
- Context updates
- Descendant invalidation traversal
- Scheduler state and flush lifecycle
- Refresh target validation
- Refresh generation preparation
- Refresh-operation deduplication
- Refresh operation map ownership
- Scheduler target selection
- Scheduler failure storage
- Scheduler settlement
- Registered-node validation helper ownership unless a smaller injected resolver is clearly preferable
- The observer composition root
- Runtime composition

### Refresh-result boundary

The execution controller detects when a successful attempt:

- Is owned by `refresh`
- Had a previous successful value
- Commits a value that differs by `Object.is`

The controller must then invoke one explicit dependency supplied by `runtime.ts`, such as:

```ts
onChangedRefreshResult(node)
```

That callback continues to own:

- Descendant invalidation traversal
- Descendant generation changes
- Descendant abort decisions
- Descendant-invalidation notification
- Scheduler request for affected subscribed descendants

Do not move invalidation traversal into the execution controller in R4. That belongs to R7.

## Required source changes

### 1. Add `runtime-execution.ts`

Add:

```text
src/core/runtime-execution.ts
```

Keep this module internal and framework-agnostic.

It may import:

- Public graph and node types
- `GraphExecutionError`, `NodeExecutionFailure`, `isAbortError`, and `toError`
- Internal runtime-state contracts

It must not import:

- Vue
- Pinia
- Devtools
- Playground code
- Subscription storage
- Scheduler implementation
- Runtime observer implementation
- Prefetch or refresh operation maps

Prefer explicit injected dependencies over importing `runtime.ts`.

### 2. Move execution-only private failure classes

Move these private classes from `runtime.ts` into `runtime-execution.ts`:

```ts
NodeAttemptFailure
NodeBlockedFailure
ObsoleteAttempt
```

Preserve their exact semantics and messages.

Do not export them publicly.

Internal module exports are unnecessary unless another internal module genuinely needs them.

Do not change `GraphExecutionError` or move its public definition from `execution.ts`.

### 3. Move node-kind guards only where needed

The execution controller needs to distinguish:

- Context nodes
- Data nodes
- Derived nodes

Move or define the minimal private type guards in `runtime-execution.ts`:

```ts
isContextNode(...)
isDataNode(...)
isDerivedNode(...)
```

If `runtime.ts` still needs a context-node guard for validation, retain its own focused validation guard or move a neutral guard into a pre-existing shared module only if that is clearly simpler.

Do not create a general node-utilities module in R4.

Avoid broad helper relocation.

### 4. Move fresh-success execution policy

Move `hasFreshSuccessfulValue(...)` into `runtime-execution.ts` because it directly controls:

- Reuse of fresh execution results
- Scheduler target selection indirectly through a runtime-facing query

However, avoid duplicating the invariant.

Choose one of these narrow designs:

#### Preferred design

The execution controller exposes:

```ts
needsExecution(node): boolean
```

or:

```ts
hasFreshSuccessfulValue(node): boolean
```

using state-store access internally.

`runtime.ts` uses that method only for scheduler target selection.

#### Acceptable design

Keep the pure private predicate in `runtime.ts` and duplicate no logic by injecting it into the execution controller.

Prefer the design that keeps one named implementation without expanding the controller unnecessarily.

The exact invariant remains:

```ts
state.hasSuccessfulValue &&
state.status === "success" &&
state.freshness === "fresh"
```

Do not weaken it to freshness alone or successful-value alone.

### 5. Move dependency-value access

Move `getDependencyValue(...)` into the execution controller.

Preserve behavior:

- Lookup uses the dependency key.
- The dependency must have a successful value.
- The dependency must be fresh.
- Failure throws a clear internal error containing the dependency key.
- The returned value retains `NodeValue<TNode>` typing.

Do not expose mutable state to loaders or derived functions.

Do not allow undeclared dependencies at compile time. Existing node typing remains responsible for that contract.

### 6. Move node-attempt execution

Move `executeNode(...)` into the controller.

Preserve exact behavior:

#### Fresh reuse

A successful fresh node resolves without creating an attempt or notifying.

#### Same-generation sharing

If an active attempt exists for the current generation:

- Add the new origin to its mutable origin set.
- Return the existing promise.
- Do not invoke the loader or derived function again.
- Do not emit another attempt-start notification.

#### Context nodes

Context nodes resolve without loaders or derived logic.

#### New attempt

For a new data or derived attempt:

- Capture generation.
- Capture previous data.
- Capture previous successful-value state.
- Create a unique token.
- Create one `AbortController`.
- Transition status to `loading` or `refreshing`.
- Mark freshness stale.
- Clear the previous error.
- Notify after the start state is committed.

#### Execution

- Data nodes call their loader with typed `get` and attempt signal.
- Derived nodes calculate synchronously with typed `get`.
- Non-Error thrown values are normalized.

#### Commit protection

Success commits only if:

- The mutable state still exists.
- The generation still matches.
- The stored active attempt token still matches.
- The signal is not aborted.

Preserve the current effective missing-state behavior. Runtime state is eagerly initialized, so missing state remains an internal defect.

#### Success commit

Commit:

```text
data
status: success
freshness: fresh
error: null
hasSuccessfulValue: true
```

Then notify.

#### Changed refresh result

After success notification, invoke the injected changed-refresh-result callback only when:

- The current attempt includes the `refresh` origin.
- The node previously had a successful value.
- The prior and new values differ by `Object.is`.

Preserve the existing ordering between node success notification and later descendant invalidation notification.

#### Failure commit

For a non-obsolete failure:

```text
status: error
freshness: stale
error: normalized error
```

Preserve existing data and successful-value state.

Notify after failure state commit, then throw the private direct-failure wrapper.

#### Obsolete behavior

Abort, generation mismatch, token mismatch, explicit obsolete marker, and recognized abort error remain obsolete execution rather than business failure.

#### Cleanup

Always call token-safe store cleanup in `finally`.

Do not move cancellation policy into the controller.

### 7. Move dependency-aware orchestration

Move `executeInternal(...)` into the controller as its primary operation.

Preserve:

- Empty target list resolves immediately.
- Validation remains inside the async execution boundary.
- Registered target resolution occurs before any loader begins.
- Equivalent handles resolve to registered definitions.
- Missing execution and prefetch targets reject as promises.
- Required parents execute recursively.
- Independent parent branches execute concurrently through `Promise.allSettled(...)`.
- Per-operation requested-node promises deduplicate shared ancestors.
- Obsolete parent results propagate as obsolete without becoming blocked business failures.
- Failed parents generate blocked descendant records.
- Independent branches continue.
- Direct and blocked failures are recorded once by node key.
- All executable requested branches settle before aggregate rejection.
- `GraphExecutionError` contains the existing failure records.

Do not replace recursive orchestration with waves, queues, task graphs, or a new planner abstraction.

Do not add configurable concurrency.

### 8. Preserve one execution engine for all origins

The controller must accept an `ExecutionOrigin`:

```ts
type ExecutionOrigin =
  | "explicit"
  | "scheduler"
  | "prefetch"
  | "refresh";
```

All four operations delegate to the same controller method:

```ts
execution.execute(targets, "explicit");
execution.execute(targets, "prefetch");
execution.execute(targets, "scheduler");
execution.execute(targets, "refresh");
```

Do not create origin-specific executors.

Do not create a second scheduler execution path.

### 9. Rewire explicit execution and prefetch

In `runtime.ts`, preserve the public wrappers:

```ts
const execute = (
  targets: readonly AnyNodeDefinition[]
): Promise<void> =>
  execution.execute(targets, "explicit");

const prefetch = (
  targets: readonly AnyNodeDefinition[]
): Promise<void> =>
  execution.execute(targets, "prefetch");
```

Exact local naming may vary.

Do not move public API assembly into the controller.

### 10. Rewire refresh execution only

`runtime.ts` continues to own:

- Empty refresh behavior
- Complete target validation
- Defensive context rejection
- Key deduplication
- Refresh-operation key creation
- Overlapping operation map
- Generation preparation
- Stale-state preparation
- Existing-attempt abort decisions
- Refresh-preparation notification

After preparation, delegate only execution:

```ts
execution.execute(targets, "refresh")
```

Do not move refresh-operation ownership into the execution controller.

### 11. Rewire scheduler execution only

The scheduler continues to own:

- Scheduled/running/follow-up flags
- Scheduler error
- Scheduler notifications
- Target selection
- Settlement waiters

The scheduler delegates selected targets to:

```ts
execution.execute(targets, "scheduler")
```

Do not move scheduler state into the controller.

### 12. Preserve scheduler target selection

The scheduler should continue selecting directly subscribed non-context nodes that do not have a fresh successful value.

If fresh-success policy moved into the controller, expose one narrow query method such as:

```ts
execution.needsExecution(node)
```

Do not expose mutable state merely for target selection if a narrow query is clearer.

Do not change direct-versus-required target selection.

### 13. Preserve active-attempt ownership access

Final-unsubscribe cancellation remains in `runtime.ts`.

R4 must not hide the active attempts needed by that policy.

The R3 state store remains available to runtime subscription and refresh code for:

- Active-attempt iteration
- Active-attempt lookup
- Abort decisions

The execution controller also receives only the state-store methods it needs.

Do not make the execution controller the sole owner of cancellation decisions.

### 14. Preserve registered-node validation timing

Execution target validation must remain inside the async controller operation.

Do not validate public `execute(...)` or `prefetch(...)` targets synchronously before returning a promise.

Refresh validation remains in `runtime.ts` with its current mixed timing:

- Missing target preserves its current synchronous throw behavior.
- Defensive context-node refresh preserves its current rejected-promise behavior.

Do not standardize timing in R4.

### 15. Preserve observer and notification ownership

The controller may receive:

```ts
notify: () => void
```

because execution owns notifications after its committed transitions.

It must notify only at the three existing execution-owned points:

- Attempt start
- Committed success
- Committed direct failure

The changed-refresh-result callback remains responsible for any later descendant-invalidation notification.

Do not:

- Notify on fresh reuse
- Notify when joining an active attempt
- Notify for context-node execution
- Notify for blocked descendants
- Notify for obsolete results
- Notify for aggregate `GraphExecutionError`
- Batch or defer execution notifications
- Move subscription or scheduler notifications into the controller

The semantic total of established notification points across runtime and controller remains eleven.

## Internal dependency design

Prefer a narrow structural dependency contract rather than passing the entire runtime object.

A reasonable dependency shape is:

```ts
interface RuntimeExecutionDependencies {
  readonly graph: Graph;
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;
  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;
  readonly setActiveAttempt: (
    key: string,
    attempt: ActiveAttempt
  ) => void;
  readonly deleteActiveAttempt: (
    key: string,
    token: symbol
  ) => void;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly onChangedRefreshResult: (
    node: AnyNodeDefinition
  ) => void;
}
```

If practical, group the state methods behind the existing internal state-store interface rather than restating each method.

Do not inject:

- Public `GraphRuntime`
- Subscription controller
- Scheduler controller
- Refresh-operation map
- Settlement waiters
- Observer object when only `notify` is needed
- A service locator
- A dependency-injection container

Use explicit dependencies and keep them small.

## Behavior that must remain unchanged

### Execution planning

- Only requested targets and required ancestors execute.
- Parents execute before children.
- Independent branches run concurrently.
- Shared ancestors execute once per operation and generation.
- Fresh successful nodes are reused.
- Context nodes do not execute loaders.
- Derived nodes execute only after fresh successful dependencies.

### Attempt sharing

- Overlapping explicit calls share attempts.
- Explicit and prefetch calls share attempts.
- Scheduler and prefetch calls share attempts.
- Scheduler and explicit calls share attempts.
- Scheduler and refresh may share the refresh generation where existing behavior permits.
- Same-generation joining adds the new origin.
- Joining does not duplicate notifications or loader calls.

### Cancellation ownership

- Final unsubscribe cancels scheduler-only work no longer required.
- Explicit, prefetch, and refresh origins protect shared work.
- Context invalidation may abort obsolete work regardless of origin.
- Refresh may supersede active normal work.
- Cancellation policy remains outside the controller.

### Race protection

- Generation mismatch prevents obsolete commits.
- Token mismatch prevents obsolete commits.
- Abort prevents obsolete commits.
- Old completion cannot delete newer active work.
- A loader ignoring abort cannot overwrite newer data.

### Failure behavior

- Direct failures update only the directly failed node.
- Failed parents block dependent descendants.
- Blocked descendants do not execute.
- Independent branches continue.
- Aggregate rejection occurs after executable branches settle.
- Failure records preserve kind, node key, error, and blocked dependencies.
- Refresh failures preserve previous successful data.
- Abort and obsolete work do not become business errors.

### Notifications

- Attempt start notification remains after start state commit.
- Success notification remains after success commit.
- Failure notification remains after failure commit.
- Changed refresh result invalidation remains a later separate transition.
- Blocked nodes and aggregate errors do not add notifications.
- All other notification ownership remains unchanged.

### Validation

- Equivalent handles resolve by key.
- Missing execution and prefetch targets reject through promises.
- Complete target validation occurs before loader work.
- Refresh validation timing remains unchanged.
- `GraphExecutionError` behavior remains unchanged.

### Public APIs

- Public signatures and return types remain unchanged.
- Public exports remain unchanged.
- `whenSettled()` remains scheduler-specific.
- Prefetch and refresh remain caller-owned operations.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not directly test the private execution controller unless a behavior cannot be exercised through `GraphRuntime`. Prefer public entry points.

### 1. Existing execution coverage must remain

Existing tests must continue to prove:

- Empty execution resolves.
- Ancestors execute before descendants.
- Unrelated nodes do not execute.
- Independent parents execute concurrently.
- Fresh nodes are skipped.
- Equivalent targets use registered definitions.
- Complete validation occurs before execution starts.
- Initial and derived failures normalize errors.
- Failed parents block descendants.
- Independent branches continue.
- Refresh failure retains successful data.

### 2. Existing deduplication coverage must remain

Existing tests must continue to prove:

- Overlapping explicit calls share one attempt.
- Shared ancestors execute once.
- Different runtimes do not share attempts.
- New generations do not reuse obsolete attempts.
- Explicit and prefetch share work.
- Scheduler and prefetch share work.
- Final unsubscribe preserves caller-owned attempts.

### 3. Existing race coverage must remain

Existing tests must continue to prove:

- Context changes abort affected work.
- Unrelated work remains active.
- Obsolete results do not commit.
- Replacement generations can complete successfully.
- Refresh supersedes active normal execution.
- Old refresh or execution cleanup cannot delete newer work.

Add only the smallest missing behavior-focused test.

### 4. Verify execution notification ownership

Ensure public tests cover:

- Attempt start is observable.
- Success is observable.
- Direct failure is observable.
- Fresh reuse is silent.
- Joining an existing attempt does not create another start transition.
- Obsolete completion does not notify as success or failure.
- Blocked descendants do not gain node-state notifications merely from aggregate failure reporting.

Use state progression rather than brittle total call counts for multi-stage operations.

Add a focused test only where the current suite lacks clear coverage.

### 5. Verify all origins still use one engine

Behavior tests should demonstrate:

- Explicit execution
- Scheduler execution
- Prefetch
- Refresh

all retain the same dependency ordering, attempt sharing, state transitions, and failure semantics.

Do not test private controller method identity.

Existing interaction tests may already be sufficient.

### 6. Type tests

Existing type tests must continue to prove:

- `execute(...)` accepts readonly node handles.
- `prefetch(...)` accepts context, data, and derived handles.
- `refresh(...)` accepts data and derived handles but rejects context handles.
- Loader and derived dependency access remains typed.
- Public operation methods return `Promise<void>`.
- Public APIs require no `any`.

Do not publicly export controller or internal origin types.

### 7. Test restraint

Do not add tests for:

- Private controller object shape
- Private dependency interface
- Source-file placement
- Private failure wrapper classes
- Internal requested-promise map size
- Exact recursive call count

Test observable behavior through the public runtime.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R3 remain validated offline.
- R4 implementation is prepared.
- R4 offline validation remains pending.
- R5 through R9 remain incomplete.
- The overall runtime composition refactor remains incomplete.
- Milestone 4 remains not started.

A reasonable checklist is:

```text
[x] R1A implementation: Documentation and repository cleanup
[x] R1A offline validation
[x] R1B implementation: Name existing runtime invariants
[x] R1B offline validation
[x] R1C implementation: Standardise registered-node validation
[x] R1C offline validation
[x] R1D implementation: Document notification ownership
[x] R1D offline validation
[x] R2 implementation: Extract runtime observation
[x] R2 offline validation
[x] R3 implementation: Extract runtime state and active-attempt storage
[x] R3 offline validation
[x] R4 implementation: Extract the execution controller
[ ] R4 offline validation
[ ] R5: Extract subscription storage and lifecycle
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R3 as validated offline
- R4 as prepared with offline validation pending
- R5 through R9 as planned

Add a brief R4 implementation decision under the R4 section:

- The existing single execution engine moved into one closure-based controller.
- Explicit, scheduler, prefetch, and refresh work still use that controller.
- Runtime state remains in the R3 store.
- Execution owns start, success, and failure notifications.
- Descendant invalidation and scheduling remain outside the controller.

Do not rewrite the R1D ownership contract, R2 observer decision, or R3 storage decision.

### 3. Add an R4 implementation note

Add:

```text
docs/implementation/18-runtime-refactor-r4-execution-controller-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Execution-controller contract
- Dependency contract
- Single-engine decision
- Target validation timing
- Dependency orchestration behavior
- Attempt sharing and origin ownership
- Start, success, failure, and obsolete-result behavior
- Branch-scoped failure behavior
- Refresh-result callback boundary
- Notification ownership preservation
- Tests added or updated
- Explicit confirmation that public APIs and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R5
- Next task: R5

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/010-runtime-refactor-r4-extract-execution-controller.md
```

## Out of scope

Do not implement:

- Subscription storage extraction
- Subscription lifecycle extraction
- Scheduler extraction
- Invalidation extraction
- Context-update extraction
- Prefetch-operation extraction
- Refresh-operation extraction
- Runtime composition-root simplification beyond execution-controller construction and wiring
- Changes to runtime-state storage
- Changes to runtime observation
- Notification batching or payloads
- New execution origins
- Retry or backoff
- Configurable concurrency
- Transactions
- Domain events
- Vue composables
- Query groups
- Polling
- Mutations
- Diagnostics or metrics
- Snapshots
- Devtools
- Cache garbage collection
- Fluent builders
- Dependency-injection containers
- Public controller APIs
- New public exports

Do not create a planner framework, executor hierarchy, base class, strategy pattern, or service locator.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-execution.ts
src/core/runtime.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/18-runtime-refactor-r4-execution-controller-implementation-note.md
docs/implementation/prompts/010-runtime-refactor-r4-extract-execution-controller.md
```

Potential focused test changes, only if existing coverage is insufficient:

```text
tests/core/execution-order.spec.ts
tests/core/execution-failure.spec.ts
tests/core/runtime-deduplication.spec.ts
tests/core/runtime-races.spec.ts
tests/core/prefetch-interaction.spec.ts
tests/core/refresh-interaction.spec.ts
```

Change fewer test files when existing tests already protect the behavior.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve runtime behavior exactly.
- Keep one execution engine.
- Preserve all four execution origins.
- Preserve origin sharing on active attempts.
- Preserve branch-scoped failure handling.
- Preserve token-safe cleanup.
- Preserve generation and token obsolete-result protection.
- Preserve validation timing.
- Preserve notification ownership and timing.
- Preserve refresh-result invalidation ordering.
- Keep cancellation policy outside the controller.
- Keep invalidation traversal outside the controller.
- Keep scheduler state outside the controller.
- Keep subscription state outside the controller.
- Keep operation maps outside the controller.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging.
- Do not add global state.
- Do not add dependencies.
- Do not expose internal controller contracts publicly.
- Keep tests deterministic and behavior-focused.

## Static inspection

Perform these dependency-free checks:

1. List all changed and added files.
2. Confirm no files were deleted.
3. Parse available JSON configuration files.
4. Run the dependency-free core boundary script if available.
5. Search `src/core` for forbidden imports from Vue, Pinia, devtools, or playground code.
6. Search changed implementation and tests for explicit `any` usage.
7. Confirm TypeScript suppression comments occur only in intentional type-test files.
8. Search core source for console logging.
9. Compare the public `GraphRuntime` interface before and after. It must be unchanged.
10. Compare public exports before and after. They must be unchanged.
11. Confirm `runtime-execution.ts` is not exported from `src/core/index.ts`.
12. Confirm there is exactly one execution-controller factory per runtime.
13. Confirm explicit, scheduler, prefetch, and refresh all delegate to the same controller method.
14. Confirm `executeNode(...)` and dependency orchestration no longer remain duplicated in `runtime.ts`.
15. Confirm private execution failure wrappers moved without semantic changes.
16. Confirm target validation remains inside the async execution operation.
17. Confirm registered-target resolution occurs before loader work begins.
18. Confirm dependency recursion, branch concurrency, and requested-node deduplication remain structurally equivalent.
19. Confirm active-attempt origin sharing remains unchanged.
20. Confirm attempt construction still uses one token and one `AbortController`.
21. Confirm start, success, and direct-failure notifications remain after the same state commits.
22. Confirm obsolete paths do not notify or become business failures.
23. Confirm token-safe cleanup still delegates to the R3 state store.
24. Confirm changed refresh results invoke an injected callback after success notification.
25. Confirm descendant invalidation traversal remains outside the controller.
26. Confirm final-unsubscribe cancellation remains outside the controller.
27. Confirm refresh preparation and operation deduplication remain outside the controller.
28. Confirm scheduler flags, errors, follow-up handling, and settlement remain outside the controller.
29. Confirm the R2 observer module is unchanged.
30. Confirm the R3 runtime-state store semantics are unchanged except for type imports required by R4.
31. Confirm the semantic total of established notification ownership points remains eleven.
32. Confirm no R5 or later extraction occurred.
33. Confirm R4 is validation pending and R5 through R9 remain incomplete.
34. Create a ZIP containing only R4 files added or changed.
35. Validate ZIP integrity and contents before responding.

Use a mechanical source reconstruction or focused diff review to prove that moved execution code is semantically equivalent to the validated R3 source.

These static checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R4 ZIP, run from the repository root:

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

If tests fail, capture complete output:

```powershell
pnpm test:run --reporter verbose --no-color 2>&1 |
    Tee-Object -FilePath ".\unit-test-output.log"
```

The developer should return:

- Full output for failed commands
- Type errors with file and line number
- Failed test names and assertion output
- Unhandled rejection warnings
- Confirmation that the playground still renders

## Prepared acceptance criteria

R4 is ready for offline validation when:

- One closure-based internal execution controller exists.
- `runtime.ts` creates one controller per runtime.
- Explicit, scheduler, prefetch, and refresh use the same controller.
- Target validation remains inside the asynchronous execution boundary.
- Registered targets resolve before loader work begins.
- Dependency recursion and independent concurrency are unchanged.
- Shared ancestors and overlapping calls remain deduplicated.
- Attempt origins are shared exactly as before.
- Attempt construction and token-safe cleanup are unchanged.
- Fresh successful nodes remain reusable.
- Context nodes remain non-executable inputs.
- Data and derived execution behavior is unchanged.
- Branch-scoped failure collection remains unchanged.
- Obsolete and aborted work remains non-business failure.
- Start, success, and failure notifications remain owned by execution.
- Changed refresh result invalidation remains a later external callback.
- Cancellation, invalidation traversal, scheduler state, subscription state, refresh preparation, and operation maps remain outside the controller.
- Public APIs and exports are unchanged.
- R1B invariants, R1C validation, R2 observation, and R3 storage semantics remain intact.
- R4 is marked prepared with offline validation pending.
- R5 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R4 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Execution ordering, concurrency, deduplication, failures, cancellation, races, prefetch, refresh, and scheduler behavior remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R4.
2. A ZIP containing only R4 files added or changed.
3. Files added and changed.
4. The internal execution-controller contract.
5. The controller dependency contract.
6. The single-engine wiring for all four origins.
7. Target validation and dependency-orchestration decisions.
8. Attempt-sharing, commit-protection, and failure decisions.
9. Refresh-result callback and notification ownership decisions.
10. Tests added or updated.
11. Confirmation that public APIs, exports, validation timing, R2 observation, R3 storage, cancellation policy, scheduler behavior, and runtime behavior were intentionally preserved.
12. Static checks and results.
13. Project commands marked `Not run in contained environment`.
14. Exact offline validation steps.
15. The next planned task: R5.
