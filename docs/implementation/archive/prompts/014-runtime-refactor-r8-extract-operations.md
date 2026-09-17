# Implementation Prompt 014: Extract Prefetch and Refresh Operations

## Role

You are implementing **R8** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D and R2 through R7 have been validated offline.

The validated baseline includes:

- Immutable typed node definitions and validated graph topology
- Runtime-local node state and active-attempt storage
- A closure-based runtime observer
- One execution controller shared by explicit execution, scheduler execution, prefetch, and refresh
- A closure-based subscription controller
- A closure-based automatic scheduler
- A closure-based invalidation and context-update controller
- Caller-owned one-shot prefetch and refresh operations
- Refresh-operation deduplication by normalized target set
- Refresh generation preparation and supersession
- Changed-result descendant invalidation through the R7 controller
- Eleven established notification ownership points

R8 extracts prefetch and refresh operation orchestration from `runtime.ts` into one closure-based internal operations controller.

R8 is behavior-preserving. It must not create another execution engine, alter validation timing, broaden scheduler settlement, or absorb invalidation policy.

Do not start R9 or any later milestone.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/10-prefetch-and-refresh-implementation-note.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/21-runtime-refactor-r7-invalidation-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `src/core/operations.ts`
- `src/core/runtime-state.ts`
- `src/core/runtime-execution.ts`
- `src/core/runtime-invalidation.ts`
- `createRefreshOperationKey(...)`
- The runtime-local `refreshOperations` map
- `prefetch(...)`
- `refresh(...)`
- Refresh validation timing
- Target-key deduplication
- Refresh generation preparation
- Refresh supersession and abort behavior
- Refresh-preparation notification
- Execution origin sharing
- Changed-result invalidation ordering
- Existing prefetch, refresh, failure, race, cancellation, scheduler interaction, observation, and type tests

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

1. Apply only the R8 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve the single execution engine and all execution origins.
5. Preserve refresh validation timing exactly.
6. Preserve operation deduplication, generation preparation, abort behavior, and notification timing.
7. Preserve scheduler-only `whenSettled()` semantics.
8. Return a ZIP containing only files added or changed for R8.
9. Provide exact offline validation commands.
10. Report project commands as `Not run in contained environment`.

No file deletion is expected for R8.

## Objective

Extract prefetch and refresh orchestration into:

```text
src/core/runtime-operations.ts
```

Use one small closure-based internal controller.

A preferred contract is:

```ts
interface RuntimeOperationsController {
  readonly prefetch: (
    targets: readonly AnyNodeDefinition[]
  ) => Promise<void>;

  readonly refresh: (
    targets: readonly RefreshableNodeDefinition[]
  ) => Promise<void>;
}
```

A reasonable dependency contract is:

```ts
interface RuntimeOperationsDependencies {
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;

  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;

  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string
  ) => AnyNodeDefinition;

  readonly execute: (
    targets: readonly AnyNodeDefinition[],
    origin: "prefetch" | "refresh"
  ) => Promise<void>;

  readonly notify: () => void;
}
```

The exact interface may use the R3 state-store contract or a narrower structural subset.

The controller must:

- Own one-shot operation entry points
- Own the runtime-local refresh-operation map
- Own refresh-operation identity
- Own refresh validation and preparation
- Delegate all node execution to R4
- Leave changed-result invalidation in R7
- Leave scheduler state and settlement in R6

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

Preserve these signatures:

```ts
prefetch(
  nodes: readonly AnyNodeDefinition[]
): Promise<void>;

refresh(
  nodes: readonly RefreshableNodeDefinition[]
): Promise<void>;
```

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

Keep `src/core/operations.ts` as the public-contract module for `RefreshableNodeDefinition`.

Do not publicly export:

- `RuntimeOperationsController`
- `RuntimeOperationsDependencies`
- Refresh-operation maps
- Refresh-operation keys
- Refresh preparation helpers
- Internal operation-origin helpers

## Ownership boundary

### R8 operations controller owns

- Public-operation internal implementations for prefetch and refresh
- Empty prefetch and refresh behavior
- Prefetch delegation using the `prefetch` origin
- Refresh complete-list validation
- Equivalent-handle resolution by key
- Defensive runtime rejection of context refresh
- Refresh target deduplication
- Preservation of first-occurrence target order
- Normalized refresh-operation identity
- Runtime-local overlapping refresh-operation sharing
- Refresh target generation preparation
- Refresh target stale-state preparation
- Refresh target status reset
- Superseded-attempt abort decisions for requested refresh targets
- Refresh-preparation notification
- Refresh execution delegation using the `refresh` origin
- Token-safe refresh-operation map cleanup by promise identity

### R4 execution controller continues to own

- Dependency orchestration
- Fresh successful reuse
- Active-attempt construction
- Same-generation sharing
- Origin sharing
- Loader and derived execution
- Execution notifications
- Generation and token commit protection
- Branch-scoped failures
- `GraphExecutionError`
- Changed refresh-result detection

### R7 invalidation controller continues to own

- Descendant invalidation after a changed refresh result
- Descendant generation and stale-state commits
- Descendant aborts
- Descendant-invalidation notification
- Subscription-aware scheduler request

### `runtime.ts` continues to own

- Runtime composition
- General registered-node helper
- Public explicit execution wrapper
- Controller construction and dependency wiring
- Final-unsubscribe cancellation
- Frozen public runtime assembly

### R9 boundary

R8 must not perform general composition-root cleanup beyond constructing and delegating to the operations controller.

Do not move public runtime interface definitions or unrelated imports solely to make `runtime.ts` smaller.

## Required source changes

### 1. Add `runtime-operations.ts`

Add:

```text
src/core/runtime-operations.ts
```

Keep it internal and framework-agnostic.

It may import:

- `RefreshableNodeDefinition`
- Public graph node types
- Internal state and attempt types
- `ExecutionOrigin` only if needed for dependency typing

It must not import:

- Vue
- Pinia
- Devtools
- Playground code
- Runtime scheduler implementation
- Runtime subscription implementation
- Runtime invalidation implementation
- Runtime observer implementation

Prefer injected execution and state functions over importing controller implementations.

### 2. Move refresh-operation identity

Move `createRefreshOperationKey(...)` into `runtime-operations.ts`.

Preserve exact behavior:

```ts
const createRefreshOperationKey = (
  keys: ReadonlySet<string>
): string =>
  JSON.stringify([...keys].sort());
```

Requirements:

- Identity is order independent.
- Duplicate keys do not affect identity.
- Arbitrary strings remain safe because JSON encoding is used.
- Distinct target sets remain independent.

Keep the helper private.

### 3. Move the refresh-operation map

Move:

```ts
const refreshOperations =
  new Map<string, Promise<void>>();
```

into the operations-controller factory.

Preserve:

- One map per runtime
- No global mutable state
- Sharing only for equivalent overlapping refresh target sets
- Cleanup after success or failure
- Promise-identity-safe cleanup

Do not store completed operations.

Do not expose the map.

### 4. Move prefetch orchestration

Move the internal `prefetch(...)` implementation into the controller.

Preserve:

```ts
execution.execute(targets, "prefetch")
```

or the equivalent injected call.

Requirements:

- Empty input resolves immediately through existing execution behavior or an explicit no-op.
- Complete target validation remains inside R4's async execution boundary.
- Missing prefetch targets reject as promises.
- Equivalent handles resolve through R4 registered-node resolution.
- Prefetch does not create subscriptions.
- Prefetch does not mutate scheduler state directly.
- Prefetch does not use the refresh-operation map.
- Prefetch remains caller-owned.

Do not duplicate execution validation inside R8.

### 5. Move refresh complete-list validation

Move refresh's validation loop into the controller.

Preserve exact timing and atomicity.

#### Empty input

```ts
refresh([])
```

returns an already resolved promise and commits no state.

#### Missing target

The current non-async public implementation validates registered targets before returning its operation promise.

Preserve the existing behavior that a missing refresh target throws synchronously.

Do not convert this into a rejected promise.

#### Defensive context target

Although public typing excludes context nodes, an untyped context handle may reach runtime validation.

Preserve the existing behavior:

```ts
return Promise.reject(
  new Error(
    `Context node "${registered.key}" cannot be refreshed.`
  )
);
```

This remains a rejected promise, not a synchronous throw.

#### Complete validation

Validate and deduplicate all targets before:

- Incrementing any generation
- Marking any target stale
- Aborting any attempt
- Notifying
- Starting execution

Preserve first-occurrence target order.

### 6. Preserve equivalent-handle resolution

Use the injected registered-node resolver with purpose:

```text
manual refresh
```

Operate on registered definitions, not equivalent request objects.

Preserve key-based identity.

Do not weaken validation to object identity.

### 7. Preserve refresh target deduplication

Maintain:

```ts
const targets: RefreshableNodeDefinition[] = [];
const keys = new Set<string>();
```

For each validated registered target:

- Skip a key already present.
- Add the registered definition on first occurrence.
- Preserve first-occurrence order.

Do not deduplicate after preparation.

### 8. Preserve overlapping refresh sharing

After validation and key collection:

```ts
const operationKey =
  createRefreshOperationKey(keys);

const existing =
  refreshOperations.get(operationKey);

if (existing) return existing;
```

This lookup must occur before refresh generation preparation.

Equivalent overlapping requests must not:

- Increment generations again
- Abort the shared refresh attempt
- Send another preparation notification
- Invoke loaders again

Distinct target sets remain independent even when they overlap partially.

### 9. Preserve refresh generation preparation

For every deduplicated target:

```ts
const state = getMutableState(target.key);
const active = getActiveAttempt(target.key);
```

Preserve the current refresh-origin guard:

```ts
if (active?.origins.has("refresh")) {
  continue;
}
```

For targets requiring preparation:

```text
generation += 1
freshness = stale
status = hasSuccessfulValue ? success : idle
abort existing active attempt if present
```

Preserve current error behavior exactly. If refresh preparation currently does not clear `state.error`, do not add error clearing in R8. Execution attempt start remains responsible for clearing the previous error.

Preserve data and `hasSuccessfulValue`.

### 10. Preserve refresh supersession

A refresh supersedes active normal execution by:

- Incrementing the requested target generation
- Marking it stale
- Aborting its current attempt
- Starting refresh-origin execution in the new generation

A loader ignoring abort cannot commit because R4 checks generation and token identity.

Do not move obsolete-result policy into R8.

### 11. Preserve preparation notification

After all deduplicated targets are prepared, notify exactly once:

```ts
notify();
```

This notification remains owned by refresh preparation.

It occurs before execution attempt-start notifications.

Do not notify for:

- Empty refresh
- Missing-target validation failure
- Defensive context rejection
- An already shared refresh operation returned before preparation

Preserve current behavior when every target already has active refresh origin. Do not invent a new silent path unless the validated source is already silent.

### 12. Preserve refresh execution delegation

Delegate prepared registered targets to the R4 controller with the refresh origin:

```ts
execute(targets, "refresh")
```

Do not create refresh-specific dependency orchestration.

Preserve:

- Branch concurrency
- Ancestor reuse
- Failure aggregation
- Same-generation sharing
- Origin sharing
- Success and failure notifications
- Changed-result callback ordering

### 13. Preserve operation cleanup

Construct the operation with promise-identity-safe cleanup:

```ts
const operation = execute(
  targets,
  "refresh"
).finally(() => {
  if (
    refreshOperations.get(operationKey) === operation
  ) {
    refreshOperations.delete(operationKey);
  }
});

refreshOperations.set(operationKey, operation);
return operation;
```

Equivalent formatting is acceptable.

Preserve cleanup after success and failure.

Do not let an old completion delete a newer operation with the same key.

### 14. Preserve failure behavior

Prefetch and refresh remain caller-visible operations.

They:

- Resolve on success
- Reject with `GraphExecutionError` on execution failure
- Preserve independent branch success
- Preserve direct and blocked failure records
- Do not convert caller failures into scheduler errors unless scheduler execution independently shared and failed

Refresh failure preserves previous successful data through R4 state behavior.

Do not add operation-specific error classes.

### 15. Preserve changed-result invalidation

R8 does not directly invalidate descendants.

The flow remains:

1. R8 prepares refresh targets.
2. R8 delegates refresh-origin execution.
3. R4 commits successful node result and notifies.
4. R4 detects a changed refresh-owned result.
5. R4 invokes the R7 callback.
6. R7 invalidates descendants, notifies, and schedules where needed.

Do not pass the operations controller into the invalidation controller.

### 16. Preserve cancellation ownership

Final unsubscribe continues to cancel only scheduler-only attempts.

Prefetch and refresh origins continue to protect shared attempts.

R8 must not:

- Iterate subscriptions
- Iterate all active attempts
- Apply final-unsubscribe cancellation
- Resolve scheduler settlement

Context invalidation may still supersede caller-owned operations when dependencies change.

### 17. Preserve scheduler settlement boundary

`runtime.whenSettled()` remains scheduler-only.

Do not make the operations controller register with scheduler waiters.

Callers continue to await:

```ts
await runtime.prefetch([node]);
await runtime.refresh([node]);
```

A shared scheduler attempt may affect both promises naturally through R4, but no semantic broadening is permitted.

### 18. Rewire runtime composition

Construct one operations controller per runtime after required dependencies exist:

```ts
const operations =
  createRuntimeOperationsController({
    getMutableState,
    getActiveAttempt,
    resolveRegisteredNode: requireRegisteredNode,
    execute: (targets, origin) =>
      execution.execute(targets, origin),
    notify,
  });
```

Exact construction order may use a typed deferred binding if execution is initialized later.

The public runtime delegates:

```ts
prefetch: operations.prefetch,
refresh: operations.refresh,
```

Explicit execution remains a direct R4 wrapper in `runtime.ts`:

```ts
execute: targets =>
  execution.execute(targets, "explicit")
```

Do not move explicit execution into the operations controller in R8.

### 19. Keep public operation types unchanged

`src/core/operations.ts` remains unchanged unless a type-only import adjustment is unavoidable.

Do not change `RefreshableNodeDefinition`.

Do not add a public prefetch operation type or operation handle.

## Behavior that must remain unchanged

### Prefetch

- Accepts context, data, and derived handles.
- Includes required ancestors.
- Skips successful fresh nodes.
- Executes stale or never-successful nodes.
- Avoids unrelated nodes.
- Creates no subscriptions.
- Does not change public subscription counts.
- Shares matching active attempts.
- Survives final unsubscribe when caller-owned.
- Missing targets reject as promises.
- Empty input resolves silently.

### Refresh validation

- Accepts data and derived handles publicly.
- Rejects context handles at compile time.
- Missing registered targets throw synchronously.
- Defensive context refresh returns a rejected promise.
- Complete validation occurs before mutation.
- Equivalent handles resolve by key.
- Duplicate targets are removed.

### Refresh preparation

- Equivalent target sets share one overlapping operation.
- Operation identity is order independent.
- Duplicate target keys do not alter identity.
- Requested target generation increments once per new operation.
- Successful data is preserved.
- Never-successful data retains its initial representation.
- Targets become stale.
- Status resets to success or idle before execution.
- Superseded attempts are aborted.
- Preparation notifies once before execution starts.

### Refresh execution

- Fresh requested targets execute again.
- Data loaders rerun.
- Derived calculations rerun.
- Fresh ancestors are reused where valid.
- Independent targets execute concurrently.
- Branch-scoped failures remain unchanged.
- Refresh failure retains previous successful data.
- Later refresh after settlement runs again.

### Races and ownership

- Refresh supersedes active normal work.
- Old results cannot commit.
- Overlapping equivalent refreshes share work.
- Distinct target sets remain independent.
- Final unsubscribe does not cancel caller-owned prefetch or refresh.
- Scheduler and caller operations share attempts where generations match.

### Descendants and scheduling

- Changed refresh result invalidates descendants through R7.
- Equal result does not invalidate descendants.
- Subscribed descendants schedule automatic recomputation.
- Unsubscribed descendants remain stale.
- `whenSettled()` remains scheduler-only.

### Notifications

- Prefetch uses only R4 execution notifications.
- Refresh preparation owns one notification.
- R4 owns attempt start, success, and failure notifications.
- R7 owns later descendant-invalidation notification.
- Empty and pre-mutation validation failures are silent.
- The semantic total remains eleven notification ownership points.

### Public API

- Public signatures and exports remain unchanged.
- Internal operation state remains private.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not directly test the private operations controller unless public behavior cannot establish a requirement.

### 1. Existing prefetch coverage must remain

Existing tests must continue to prove:

- Loading without subscriptions
- Ancestor execution
- Fresh-value reuse
- Unrelated-node isolation
- No subscription changes
- Equivalent handles
- Empty input
- Atomic missing-target validation

### 2. Existing prefetch interaction coverage must remain

Existing tests must continue to prove:

- Scheduler sharing
- Explicit-execution sharing
- Final-unsubscribe protection
- Caller-visible failure
- Scheduler-error isolation

### 3. Existing refresh coverage must remain

Existing tests must continue to prove:

- Fresh data reload
- Value preservation while refreshing
- Derived recomputation
- Fresh ancestor reuse
- Empty input
- Duplicate targets
- Equivalent handles
- Atomic missing-target validation
- Defensive context rejection

### 4. Existing refresh interaction coverage must remain

Existing tests must continue to prove:

- Active normal work supersession
- Obsolete-result protection
- Equivalent overlapping refresh sharing
- A later refresh runs again
- Caller-owned refresh survives final unsubscribe
- Reversed order and duplicate target sharing
- Distinct target sets remain independent

### 5. Existing refresh failure coverage must remain

Existing tests must continue to prove:

- Successful-data retention
- Stale error state
- Recovery
- Derived failure normalization
- Scheduler-error isolation

### 6. Add refresh preparation notification coverage only if missing

If current tests do not establish preparation ordering, add one focused public test that observes:

1. Refresh preparation state before attempt start.
2. Attempt-start state after preparation.
3. Success or failure state afterward.

Prefer state progression over exact listener totals.

Do not add the test if existing observation coverage already proves this.

### 7. Add operation-map cleanup coverage only if missing behavior

Public behavior should prove a later refresh after either success or failure creates a new operation.

Existing tests already cover later refresh after success and recovery after failure. Add no private-map test.

### 8. Type tests

Existing type tests must continue to prove:

- Prefetch accepts context, data, and derived handles.
- Refresh accepts data and derived handles.
- Refresh rejects context handles.
- Readonly tuples are accepted.
- String keys are rejected.
- Both operations return `Promise<void>`.
- Public APIs require no `any`.

Do not expose internal controller or operation-map types.

### 9. Test restraint

Do not add tests for:

- Private map size
- Private operation-key strings
- Controller object identity
- Internal callback identity
- Source-file placement
- Exact promise allocation counts

Test observable behavior.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R7 remain validated offline.
- R8 implementation is prepared.
- R8 offline validation remains pending.
- R9 remains incomplete.
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
[x] R4 offline validation
[x] R5 implementation: Extract subscription storage and lifecycle
[x] R5 offline validation
[x] R6 implementation: Extract the automatic scheduler
[x] R6 offline validation
[x] R7 implementation: Extract invalidation and context updates
[x] R7 offline validation
[x] R8 implementation: Extract prefetch and refresh operations
[ ] R8 offline validation
[ ] R9: Simplify runtime assembly and document internal boundaries
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R7 as validated offline
- R8 as prepared with offline validation pending
- R9 as planned

Add a brief R8 decision:

- Prefetch and refresh orchestration moved into one runtime-local closure controller.
- The controller owns refresh validation, normalized operation identity, operation-map lifecycle, generation preparation, supersession, preparation notification, and execution delegation.
- R4 remains the single executor.
- R7 remains responsible for changed-result descendant invalidation.
- Scheduler settlement remains scheduler-only.

Do not rewrite earlier decisions.

### 3. Add an R8 implementation note

Add:

```text
docs/implementation/22-runtime-refactor-r8-operations-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Operations-controller contract
- Dependency contract
- Prefetch behavior and execution delegation
- Refresh validation timing
- Equivalent-handle and target-deduplication behavior
- Refresh-operation identity and map ownership
- Generation and stale-state preparation
- Active-attempt supersession
- Preparation notification ownership
- Execution and failure behavior
- Changed-result invalidation boundary
- Scheduler settlement boundary
- Tests added or updated
- Confirmation that public APIs and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R9
- Next task: R9

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/014-runtime-refactor-r8-extract-operations.md
```

## Out of scope

Do not implement:

- Explicit execution extraction into operations
- Execution-controller changes
- Invalidation-controller changes
- Subscription-controller changes
- Scheduler-controller changes
- Runtime-state-store changes
- Observer changes
- General runtime composition cleanup beyond controller construction and delegation
- Transactions
- Domain events
- Refresh policies
- Polling
- Stale-time behavior
- Retry or backoff
- Mutations
- Diagnostics or metrics
- Snapshots
- Devtools
- Cache garbage collection
- Public operation handles
- Public cancellation APIs
- Fluent builders
- Dependency-injection containers
- New public exports

Do not turn the operations controller into a general task or policy framework.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-operations.ts
src/core/runtime.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/22-runtime-refactor-r8-operations-implementation-note.md
docs/implementation/prompts/014-runtime-refactor-r8-extract-operations.md
```

Potential focused test changes only if existing coverage is insufficient:

```text
tests/core/refresh.spec.ts
tests/core/refresh-interaction.spec.ts
```

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve the single execution engine.
- Preserve all execution-origin semantics.
- Preserve validation timing exactly.
- Preserve complete validation before mutation.
- Preserve key-based identity.
- Preserve target ordering and deduplication.
- Preserve normalized refresh-operation identity.
- Preserve overlapping operation sharing.
- Preserve generation preparation and abort behavior.
- Preserve refresh-preparation notification timing.
- Preserve failure and recovery behavior.
- Preserve changed-result invalidation ordering.
- Preserve scheduler-only settlement.
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
11. Confirm `runtime-operations.ts` is not exported from `src/core/index.ts`.
12. Confirm `operations.ts` public contracts are unchanged.
13. Confirm one operations controller is created per runtime.
14. Confirm `createRefreshOperationKey(...)` moved out of `runtime.ts`.
15. Confirm `refreshOperations` moved out of `runtime.ts` and exists only inside the controller factory.
16. Confirm no module-level mutable operation state exists.
17. Confirm prefetch delegates to R4 with the prefetch origin.
18. Confirm prefetch does not duplicate registered-target validation.
19. Confirm missing refresh targets still throw synchronously.
20. Confirm defensive context refresh still returns a rejected promise.
21. Confirm complete refresh validation occurs before mutation.
22. Confirm target deduplication preserves first-occurrence order.
23. Confirm operation identity uses sorted unique keys encoded with JSON.
24. Confirm existing-operation lookup occurs before generation preparation.
25. Confirm refresh-origin active attempts skip repeated preparation.
26. Confirm generation, stale, status, and abort preparation match the validated baseline.
27. Confirm refresh preparation preserves data, successful-value state, and current error-clearing behavior.
28. Confirm one preparation notification occurs before refresh execution.
29. Confirm refresh delegates to R4 with the refresh origin.
30. Confirm operation cleanup is promise-identity safe.
31. Confirm R7 remains responsible for descendant invalidation.
32. Confirm `whenSettled()` remains scheduler-only.
33. Confirm final-unsubscribe cancellation remains outside operations.
34. Confirm explicit execution remains directly delegated from `runtime.ts` to R4.
35. Confirm R2 observer source is unchanged.
36. Confirm R3 runtime-state semantics are unchanged.
37. Confirm R4 execution semantics are unchanged.
38. Confirm R5 subscription semantics are unchanged.
39. Confirm R6 scheduler semantics are unchanged.
40. Confirm R7 invalidation semantics are unchanged.
41. Confirm the semantic total of notification ownership points remains eleven.
42. Confirm no R9 composition cleanup occurred beyond R8 wiring.
43. Confirm R8 is validation pending and R9 remains incomplete.
44. Create a ZIP containing only R8 files added or changed.
45. Validate ZIP integrity and contents before responding.

Use mechanical source reconstruction or focused diff inspection to prove `runtime.ts` changes are limited to:

- Operations-controller import and construction
- Removal of refresh-operation key helper
- Removal of refresh-operation map
- Removal of local prefetch and refresh implementations
- Public prefetch and refresh delegation
- Narrow execution and state dependency wiring

These static checks do not prove TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R8 ZIP, run from the repository root:

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

R8 is ready for offline validation when:

- One closure-based operations controller exists per runtime.
- Prefetch delegates to the R4 execution controller with the prefetch origin.
- Refresh validation timing remains unchanged.
- Complete refresh validation occurs before mutation.
- Equivalent handles resolve through registered keys.
- Duplicate targets preserve first-occurrence order.
- Overlapping equivalent target sets share one operation.
- Distinct target sets remain independent.
- Refresh operation state is runtime-local and cleaned safely.
- Generation preparation and supersession remain unchanged.
- Refresh preparation notification remains correctly ordered.
- Refresh execution delegates to R4 with the refresh origin.
- R7 remains responsible for changed-result invalidation.
- Final-unsubscribe cancellation remains outside operations.
- `whenSettled()` remains scheduler-only.
- Public APIs and exports are unchanged.
- R2 through R7 capability semantics remain intact.
- Existing behavior-focused tests remain intact.
- R8 is marked prepared with offline validation pending.
- R9 remains incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R8 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Prefetch, refresh, validation, operation sharing, supersession, failure, recovery, invalidation interaction, cancellation ownership, and typing remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R8.
2. A ZIP containing only R8 files added or changed.
3. Files added and changed.
4. The internal operations-controller contract.
5. The controller dependency contract.
6. Prefetch delegation decisions.
7. Refresh validation timing and atomicity decisions.
8. Operation identity, sharing, preparation, supersession, and cleanup decisions.
9. Notification, execution, invalidation, cancellation, and settlement boundaries.
10. Tests added or updated.
11. Confirmation that public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, R6 scheduler, R7 invalidation, cancellation policy, and runtime behavior were intentionally preserved.
12. Static checks and results.
13. Project commands marked `Not run in contained environment`.
14. Exact offline validation steps.
15. The next planned task: R9.
