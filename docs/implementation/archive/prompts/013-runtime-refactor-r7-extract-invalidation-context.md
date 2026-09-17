# Implementation Prompt 013: Extract Invalidation and Context Updates

## Role

You are implementing **R7** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D and R2 through R6 have been validated offline.

The validated baseline includes:

- Immutable typed node definitions and validated graph topology
- Runtime-local node state and active-attempt storage
- A closure-based runtime observer
- One execution controller shared by explicit execution, scheduler execution, prefetch, and refresh
- A closure-based subscription controller
- A closure-based automatic scheduler
- Context updates that synchronously invalidate transitive descendants
- Changed refresh results that invalidate transitive descendants
- Generation-based obsolete-result protection
- Attempt aborts during invalidation
- Subscription-aware scheduling after invalidation
- Eleven established notification ownership points

R7 extracts context updates and reusable descendant invalidation into one closure-based internal capability.

R7 is behavior-preserving. It must not redesign invalidation semantics, move refresh-operation ownership, or introduce transactions.

Do not start R8 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/20-runtime-refactor-r6-scheduler-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `src/core/runtime-state.ts`
- `src/core/runtime-execution.ts`
- `src/core/runtime-subscriptions.ts`
- `src/core/runtime-scheduler.ts`
- `requireRegisteredContextNode(...)`
- `invalidateDescendants(...)`
- `setContext(...)`
- The changed-refresh-result callback passed to the execution controller
- Context generation changes
- Descendant generation, status, freshness, and error changes
- Active-attempt abort behavior
- Subscriber detection during invalidation
- Context and descendant-invalidation notification ordering
- Scheduler request ordering
- Existing context, race, scheduler-context, refresh-descendant, refresh-interaction, observer, and type tests

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

1. Apply only the R7 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve synchronous context mutation and invalidation.
5. Preserve generation, status, freshness, error, abort, notification, and scheduling behavior.
6. Preserve refresh-result invalidation ordering.
7. Return a ZIP containing only files added or changed for R7.
8. Provide exact offline validation commands.
9. Report project commands as `Not run in contained environment`.

No file deletion is expected for R7.

## Objective

Extract context updates and reusable descendant invalidation into:

```text
src/core/runtime-invalidation.ts
```

Use one small closure-based internal controller.

A reasonable contract is:

```ts
interface RuntimeInvalidationController {
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;

  readonly invalidateDescendants: (
    node: AnyNodeDefinition
  ) => boolean;
}
```

The boolean result preserves the current internal meaning:

```text
true when at least one invalidated descendant currently has subscribers
```

A reasonable dependency contract is:

```ts
interface RuntimeInvalidationDependencies {
  readonly graph: Graph;

  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;

  readonly getActiveAttempt: (
    key: string
  ) => ActiveAttempt | undefined;

  readonly hasSubscribers: (
    node: AnyNodeDefinition
  ) => boolean;

  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition,
    purpose: string
  ) => AnyNodeDefinition;

  readonly notify: () => void;
  readonly schedule: () => void;
}
```

The exact contract may be smaller if existing construction order allows direct narrow functions without unnecessary wrappers.

Prefer the simplest controller that:

- Owns context-node validation after registered-key resolution
- Owns context value commits
- Owns transitive descendant traversal and invalidation
- Owns invalidation-time aborts
- Owns context/invalidation notification
- Owns the scheduler request decision after context mutation
- Exposes reusable descendant invalidation for changed refresh results
- Does not absorb refresh-operation preparation or execution-result comparison

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

Preserve the generic public context signature:

```ts
setContext<TValue>(
  node: ContextNodeDefinition<TValue>,
  value: TValue
): void;
```

Do not add, remove, rename, or overload public APIs.

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

Do not publicly export:

- `RuntimeInvalidationController`
- `RuntimeInvalidationDependencies`
- `invalidateDescendants(...)`
- Registered-context validation helpers
- Invalidation traversal state
- Subscriber-detection results
- Abort helpers

## Ownership boundary

### R7 invalidation controller owns

- Registered context-node validation
- Context-kind validation
- Equivalent context-handle resolution by key
- `Object.is` equality check
- Context value commit
- Context generation increment
- Transitive descendant traversal
- Descendant deduplication by key
- Descendant generation increment
- Descendant stale-state commit
- Descendant status reset
- Descendant error clearing
- Aborting active descendant attempts
- Detecting whether invalidated descendants have subscribers
- Context/invalidation notification after the complete synchronous commit
- Scheduler request after context notification when subscribed descendants changed
- Reusable descendant invalidation for changed refresh results

### `runtime.ts` continues to own

- Runtime composition
- General registered-node lookup
- Observer construction
- State-store construction
- Execution-controller construction
- Subscription-controller construction
- Scheduler-controller construction
- Refresh target validation
- Refresh preparation
- Refresh-operation deduplication and map ownership
- Public prefetch and refresh wrappers
- Final-unsubscribe cancellation
- Public runtime object assembly

### R4 execution boundary

The execution controller continues to detect a changed successful refresh result using:

- Refresh origin ownership
- Prior successful-value state
- `Object.is(previousData, value)`

It invokes one runtime-supplied callback after the refreshed node success notification.

R7 changes that callback to delegate descendant invalidation to the invalidation controller.

Do not move successful-result comparison into the invalidation controller.

### R6 scheduler boundary

The scheduler continues to own queued, running, follow-up, error, notification, and settlement state.

The invalidation controller receives only:

```ts
schedule: scheduler.schedule
```

It must not inspect or mutate scheduler state.

### R8 operation boundary

R7 must not move:

- `refreshOperations`
- Refresh operation keys
- Refresh target validation
- Refresh generation preparation
- Refresh target abort decisions
- Prefetch wrappers
- Refresh wrappers

Those belong to R8.

## Required source changes

### 1. Add `runtime-invalidation.ts`

Add:

```text
src/core/runtime-invalidation.ts
```

Keep it internal and framework-agnostic.

It may import internal state types and public node or graph types.

It must not import:

- Vue
- Pinia
- Devtools
- Playground code
- Runtime scheduler implementation
- Runtime subscription implementation
- Runtime execution implementation
- Refresh-operation maps

Prefer injected structural functions over importing other controllers.

### 2. Move the context-node type guard

Move the context-node guard needed by context validation into the invalidation module:

```ts
const isContextNode = (
  node: AnyNodeDefinition
): node is ContextNodeDefinition<unknown> =>
  node.kind === "context";
```

Preserve its semantics.

If `runtime.ts` no longer needs the guard, remove it there.

Do not create a new general node-guards module.

### 3. Move registered context validation

Move `requireRegisteredContextNode(...)` into the invalidation controller.

Preserve:

1. Resolve through the existing general registered-node helper.
2. Use purpose `"context update"`.
3. Reject missing keys synchronously.
4. Reject a registered non-context node synchronously.
5. Include the relevant key in the error.
6. Return the registered context definition rather than the equivalent request object.

Preserve the current non-context error text unless a type-only adjustment requires a mechanically equivalent form.

Do not change the general `requireRegisteredNode(...)` helper in R7.

### 4. Move descendant invalidation traversal

Move `invalidateDescendants(...)` into the controller.

Preserve the current breadth-first traversal structure unless a mechanical equivalent is simpler:

```ts
const visited = new Set<string>();
const queue = [...graph.getChildren(node)];
```

For every unique descendant:

```text
generation += 1
freshness = stale
status = hasSuccessfulValue ? success : idle
error = null
abort active attempt if present
```

Then inspect current total subscription state.

Preserve:

- Transitive traversal
- One invalidation per descendant key
- Diamond deduplication
- Existing graph child order
- Data preservation
- `hasSuccessfulValue` preservation
- Unrelated-node isolation
- Active-attempt abort
- Subscriber detection after the state commit

Do not:

- Clear data
- Change `hasSuccessfulValue`
- Set status to `refreshing`
- Store abort as an error
- Notify inside the descendant loop
- Schedule inside the descendant loop
- Scan every graph node

### 5. Preserve the boolean invalidation result

`invalidateDescendants(node)` returns whether at least one invalidated descendant currently has total subscription greater than zero.

Use the R5 controller through an injected query:

```ts
hasSubscribers(descendant)
```

Preserve total-subscriber semantics. Do not change this to direct-only subscribers.

The result is used by:

- Context updates
- Changed refresh results

Do not expose the boolean publicly.

### 6. Move context updates

Move `setContext(...)` into the invalidation controller.

Preserve exact behavior.

#### Validation

Validate and resolve the registered context before mutating state.

#### Equal value

If:

```ts
Object.is(state.data, value)
```

return immediately.

Equal updates must not:

- Increment generation
- Invalidate descendants
- Abort attempts
- Notify
- Schedule

#### Changed value

For a changed value:

1. Commit the context value.
2. Increment the context generation once.
3. Invalidate all transitive descendants synchronously.
4. Notify once after the context and all descendant invalidation state is committed.
5. Request scheduler work only when at least one invalidated descendant has subscribers.

Preserve context state fields not currently changed by `setContext(...)`.

Do not add a context status or freshness reassignment unless it already exists in the validated baseline.

### 7. Preserve context notification ownership

The context/invalidation controller owns one semantic notification for a changed context operation.

The listener must observe, in the same notification:

- Updated context value
- Updated context generation
- Every affected descendant generation
- Every affected descendant stale state
- Cleared descendant errors
- Aborted affected attempts where observable through later behavior

Do not notify separately for each descendant.

Do not notify for an equal update or validation failure.

### 8. Preserve context scheduling order

For a changed context:

```text
commit context and descendants
notify
conditionally request scheduler work
```

The scheduler request is a distinct observable transition and may send its own scheduler notification.

Do not schedule before the context/invalidation notification.

Do not invoke loaders synchronously.

### 9. Rewire changed refresh-result invalidation

The execution controller callback remains in `runtime.ts`, but delegates traversal:

```ts
onChangedRefreshResult: node => {
  const subscribedDescendantChanged =
    invalidation.invalidateDescendants(node);

  if (graph.getChildren(node).length > 0) {
    notify();
  }

  if (subscribedDescendantChanged) {
    scheduler.schedule();
  }
}
```

However, prefer moving the full refresh-descendant commit coordination into one controller method if it produces a cleaner ownership boundary without moving result comparison.

A suitable additional method is:

```ts
commitChangedResultDescendantInvalidation(
  node: AnyNodeDefinition
): void;
```

It would:

1. Invalidate descendants.
2. Notify only when the node has at least one descendant.
3. Schedule when at least one invalidated descendant has subscribers.

This is preferable if it prevents `runtime.ts` from retaining invalidation notification policy.

Choose one consistent contract.

Required refresh-result ordering remains:

1. Refreshed node success commit
2. Execution success notification
3. Descendant invalidation commit
4. Descendant-invalidation notification when descendants exist
5. Scheduler request when affected descendants are subscribed

Do not notify when the changed node has no descendants.

### 10. Clarify controller API

Preferred final internal contract:

```ts
interface RuntimeInvalidationController {
  readonly setContext: <TValue>(
    node: ContextNodeDefinition<TValue>,
    value: TValue
  ) => void;

  readonly invalidateChangedResultDescendants: (
    node: AnyNodeDefinition
  ) => void;
}
```

Keep raw `invalidateDescendants(...)` private if only the controller uses it.

This is preferable because:

- The controller owns invalidation notification policy.
- The controller owns scheduler request ordering.
- `runtime.ts` does not need the boolean result.

An acceptable alternative is exposing raw internal invalidation when it materially simplifies composition. If chosen, document why notification and scheduling coordination remains outside.

Prefer the first design.

### 11. Rewire the execution controller callback

After constructing the invalidation controller, configure execution with:

```ts
onChangedRefreshResult:
  invalidation.invalidateChangedResultDescendants
```

Construction order may require deferred typed bindings because:

- Invalidation requires scheduler and subscriptions.
- Execution requires the invalidation callback.
- Scheduler execution delegates to execution.

Use the smallest explicit composition solution.

Acceptable approaches:

- Typed deferred local bindings initialized before any callback can run
- Narrow forwarding closures
- Reordering construction where safe

Do not introduce:

- A dependency-injection container
- A service locator
- A builder
- Mutable public controller references

### 12. Rewire public `setContext(...)`

The returned runtime delegates:

```ts
setContext: invalidation.setContext
```

Preserve public generic inference.

Be careful that assigning a generic method through an object preserves:

```ts
runtime.setContext(context, correctlyTypedValue)
```

and continues to reject wrong value types, data nodes, and derived nodes.

Do not wrap it in an untyped function.

### 13. Preserve refresh preparation

Refresh preparation remains in `runtime.ts` in R7.

It continues to:

- Validate complete target list
- Reject context refresh appropriately
- Deduplicate targets
- Own `refreshOperations`
- Advance requested target generations
- Mark requested targets stale
- Reset requested target status
- Abort superseded active attempts
- Send refresh-preparation notification
- Delegate execution to the R4 controller

Do not move or alter this code except the changed-result callback wiring.

### 14. Preserve final-unsubscribe cancellation

Do not alter:

- Active-attempt iteration
- Total-subscriber checks
- Scheduler-only origin predicate
- Abort decisions
- Settlement re-check

R7 invalidation aborts attempts only because their dependencies became obsolete. Final unsubscribe cancellation remains a separate policy.

### 15. Preserve error behavior

Invalidation clears descendant node errors as currently implemented.

Preserve:

- Context validation errors remain synchronous.
- Equal updates do nothing.
- Abort does not become node error.
- Obsolete attempts do not commit failure.
- Scheduler errors are not directly changed by invalidation.
- A later scheduler flush clears its prior scheduler error at flush start.

Do not introduce invalidation-specific error classes.

## Behavior that must remain unchanged

### Context validation

- Equivalent context handles resolve by key.
- Missing context keys throw synchronously.
- A context-shaped handle for a registered data node throws synchronously.
- Failed validation changes no state.
- Failed validation does not notify or schedule.

### Equal updates

- `Object.is` equal context values are silent.
- No generation changes.
- No descendant invalidation.
- No aborts.
- No scheduler request.

### Changed context updates

- Context value changes synchronously.
- Context generation increments once.
- Every transitive descendant generation increments once.
- Descendants become stale.
- Successful descendants use `success` status.
- Never-successful descendants use `idle` status.
- Descendant errors clear.
- Descendant data is preserved.
- `hasSuccessfulValue` is preserved.
- Unrelated nodes remain unchanged.

### Traversal

- Direct descendants are invalidated.
- Transitive descendants are invalidated.
- Diamond descendants are invalidated once.
- Traversal uses registered graph topology.
- Empty descendant sets are valid.

### Abort and race behavior

- Active affected descendants are aborted.
- Unrelated attempts remain active.
- A loader ignoring abort cannot commit obsolete data.
- Replacement generation can execute successfully.
- Abort remains non-business failure.

### Subscription-aware scheduling

- If any affected descendant has total subscription, scheduler work is requested.
- Required-only subscription counts are respected.
- Unsubscribed descendants remain stale without loading.
- Scheduler requests occur after invalidation notification.
- Multiple synchronous requests still coalesce in R6.

### Refresh-result invalidation

- Changed successful refresh results invalidate descendants.
- Equal results do not invoke invalidation.
- Descendant generations increment once.
- Data is preserved.
- Affected attempts are aborted.
- Subscribed descendants schedule automatic recomputation.
- Unsubscribed descendants remain stale.
- Unrelated branches remain unchanged.
- Success notification precedes descendant-invalidation notification.

### Public API

- Public signatures and exports remain unchanged.
- `setContext(...)` remains strongly typed.
- Internal invalidation APIs remain private.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not directly test the private invalidation controller unless a requirement cannot be proven through `GraphRuntime`. Prefer public behavior.

### 1. Existing context coverage must remain

Existing tests must continue to prove:

- Transitive invalidation
- Data preservation
- Unrelated-node isolation
- Equivalent context-handle resolution
- Invalid context-handle rejection
- No notification after failed validation
- Equal-value silence

### 2. Existing race coverage must remain

Existing tests must continue to prove:

- Affected work aborts
- Unrelated work remains active
- Obsolete results do not commit
- Replacement generations execute
- A new generation does not reuse obsolete work

### 3. Existing scheduler-context coverage must remain

Existing tests must continue to prove:

- Subscribed descendants reload automatically
- A follow-up uses the latest context
- Multiple synchronous context changes coalesce
- Unsubscribed descendants do not load
- Scheduler settlement includes follow-up work

### 4. Existing refresh-descendant coverage must remain

Existing tests must continue to prove:

- Changed results invalidate transitive descendants
- Equal results do not invalidate descendants
- Subscribed descendants recompute
- Unrelated nodes do not execute

### 5. Add diamond descendant invalidation coverage if missing

Ensure one public behavior test proves a diamond descendant is invalidated exactly once.

A suitable graph is:

```text
Context
├── Left
├── Right
└── both feed Leaf
```

After changing the context, verify:

- Left generation increments once
- Right generation increments once
- Leaf generation increments once, not twice

Add this to:

```text
tests/core/runtime-context.spec.ts
```

only if existing tests do not explicitly cover descendant deduplication.

### 6. Add committed-state notification coverage if missing

Ensure a listener invoked for a changed context can observe:

- The new context value
- All affected descendant stale states
- Updated generations

The listener must not observe a partially invalidated graph.

Add one focused test only if existing observation tests do not establish this.

Do not assert total notification counts across scheduler follow-up operations.

### 7. Preserve refresh notification ordering coverage

If current tests do not clearly prove success-before-descendant-invalidation observation, add a focused test that records public state snapshots during notifications.

Prefer assertions on state progression instead of exact total listener counts.

Add only if necessary.

### 8. Type tests

Existing type tests must continue to prove:

- `setContext(...)` accepts the context value type.
- Wrong context value types fail.
- Data nodes cannot be passed to `setContext(...)`.
- Derived nodes cannot be passed to `setContext(...)`.
- Public runtime methods require no `any`.

Do not expose invalidation-controller types publicly.

### 9. Test restraint

Do not add tests for:

- Private queue shape
- Private visited-set size
- Controller method identity
- Internal callback identity
- Source-file placement
- Exact internal traversal call count

Test observable behavior.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R6 remain validated offline.
- R7 implementation is prepared.
- R7 offline validation remains pending.
- R8 and R9 remain incomplete.
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
[ ] R7 offline validation
[ ] R8: Extract prefetch and refresh operations
[ ] R9: Simplify runtime assembly and document internal boundaries
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R6 as validated offline
- R7 as prepared with offline validation pending
- R8 and R9 as planned

Add a brief R7 decision:

- Context validation, context commits, and transitive descendant invalidation moved into one runtime-local closure controller.
- The controller owns generation changes, stale-state commits, invalidation aborts, notification ordering, and scheduler requests.
- Changed refresh results reuse the same descendant invalidation capability after execution success.
- Refresh-operation preparation and ownership remain outside for R8.

Do not rewrite earlier decisions.

### 3. Add an R7 implementation note

Add:

```text
docs/implementation/21-runtime-refactor-r7-invalidation-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Invalidation-controller contract
- Dependency contract
- Context validation
- Equal-value behavior
- Context commit behavior
- Descendant traversal and deduplication
- State-transition behavior
- Attempt abort behavior
- Subscriber detection
- Notification ownership and ordering
- Scheduler request boundary
- Refresh-result reuse and ordering
- Tests added or updated
- Confirmation that public APIs and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R8
- Next task: R8

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/013-runtime-refactor-r7-extract-invalidation-context.md
```

## Out of scope

Do not implement:

- Prefetch extraction
- Refresh-operation extraction
- Refresh-operation map movement
- Refresh target validation movement
- Refresh preparation movement
- Execution-controller changes beyond callback wiring
- Subscription-controller changes
- Scheduler-controller changes
- Runtime-state-store changes
- Observer changes
- Transactions
- Batched context updates
- Deferred invalidation
- Domain events
- Public invalidation APIs
- Node-specific observation
- Vue composables
- Query groups
- Polling
- Retry or backoff
- Mutations
- Diagnostics or metrics
- Snapshots
- Devtools
- Cache garbage collection
- Fluent builders
- Dependency-injection containers
- Public controller APIs
- New public exports

Do not turn invalidation into a general event system or transaction manager.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-invalidation.ts
src/core/runtime.ts
tests/core/runtime-context.spec.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/21-runtime-refactor-r7-invalidation-implementation-note.md
docs/implementation/prompts/013-runtime-refactor-r7-extract-invalidation-context.md
```

Change the test file only if missing coverage is identified.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve synchronous context updates.
- Preserve `Object.is` equality behavior.
- Preserve registered-key identity.
- Preserve transitive traversal and diamond deduplication.
- Preserve generation changes exactly.
- Preserve status, freshness, error, data, and successful-value behavior.
- Preserve abort behavior.
- Preserve total-subscriber scheduling semantics.
- Preserve notification timing and ordering.
- Preserve refresh-result ordering.
- Keep refresh operations outside the controller.
- Keep execution policy outside the controller.
- Keep scheduler state outside the controller.
- Keep subscription storage outside the controller.
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
11. Confirm `runtime-invalidation.ts` is not exported from `src/core/index.ts`.
12. Confirm one invalidation controller is created per runtime.
13. Confirm the context-node guard and context validation moved out of `runtime.ts`.
14. Confirm descendant invalidation traversal moved out of `runtime.ts`.
15. Confirm `setContext(...)` implementation moved out of `runtime.ts`.
16. Confirm the traversal begins from graph children and uses key-based visited semantics.
17. Confirm every descendant increments generation exactly once per invalidation call.
18. Confirm stale, status, and error assignments match the validated baseline.
19. Confirm descendant data and `hasSuccessfulValue` are not changed.
20. Confirm active descendant attempts are aborted.
21. Confirm subscriber detection uses total subscription state.
22. Confirm changed context notification occurs after the complete invalidation commit.
23. Confirm context scheduling occurs after notification.
24. Confirm equal context updates are silent.
25. Confirm failed context validation is silent and mutation-free.
26. Confirm changed refresh-result comparison remains in the execution controller.
27. Confirm refresh descendant invalidation delegates to the R7 controller after success notification.
28. Confirm changed refresh-result descendant notification occurs before scheduling.
29. Confirm refresh preparation and `refreshOperations` remain in `runtime.ts`.
30. Confirm final-unsubscribe cancellation remains in `runtime.ts`.
31. Confirm R2 observer source is unchanged.
32. Confirm R3 runtime-state semantics are unchanged.
33. Confirm R4 execution semantics are unchanged except callback wiring.
34. Confirm R5 subscription semantics are unchanged.
35. Confirm R6 scheduler semantics are unchanged.
36. Confirm the semantic total of notification ownership points remains eleven.
37. Confirm no R8 or R9 responsibility was extracted.
38. Confirm R7 is validation pending and R8 through R9 remain incomplete.
39. Create a ZIP containing only R7 files added or changed.
40. Validate ZIP integrity and contents before responding.

Use mechanical source reconstruction or focused diff inspection to prove `runtime.ts` changes are limited to:

- Invalidation-controller import and construction
- Removal of local context guard and context-validation helper
- Removal of local descendant-invalidation and context-update functions
- Execution changed-refresh callback delegation
- Public `setContext` delegation
- Narrow composition-order wiring

These static checks do not prove TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R7 ZIP, run from the repository root:

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

R7 is ready for offline validation when:

- One closure-based invalidation controller exists per runtime.
- Registered context validation belongs to the controller.
- Equal context updates remain silent.
- Changed context commits remain synchronous.
- Context generation increments once.
- Transitive descendants invalidate once by key.
- Descendant data and successful-value state are preserved.
- Descendant status, freshness, error, and generation match the validated behavior.
- Affected attempts are aborted.
- Unrelated state and attempts remain unchanged.
- Context notification occurs after the complete synchronous commit.
- Scheduler requests occur after notification and only for subscribed descendants.
- Changed refresh results reuse the same invalidation capability.
- Refresh success notification precedes descendant-invalidation notification.
- Refresh preparation, operation maps, and public operation wrappers remain outside the controller.
- Public APIs and exports are unchanged.
- R2 observation, R3 storage, R4 execution, R5 subscriptions, and R6 scheduling remain intact.
- Existing behavior-focused tests remain intact.
- R7 is marked prepared with offline validation pending.
- R8 and R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R7 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Context validation, invalidation, races, scheduler follow-up, refresh descendants, observation, and typing remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R7.
2. A ZIP containing only R7 files added or changed.
3. Files added and changed.
4. The internal invalidation-controller contract.
5. The controller dependency contract.
6. Context validation, equality, and commit decisions.
7. Descendant traversal, state transition, deduplication, and abort decisions.
8. Notification and scheduler ordering.
9. Changed refresh-result callback and ordering.
10. Tests added or updated.
11. Confirmation that public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, R6 scheduler, refresh-operation ownership, cancellation policy, and runtime behavior were intentionally preserved.
12. Static checks and results.
13. Project commands marked `Not run in contained environment`.
14. Exact offline validation steps.
15. The next planned task: R8.
