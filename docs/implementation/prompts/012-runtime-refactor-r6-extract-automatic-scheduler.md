# Implementation Prompt 012: Extract the Automatic Scheduler

## Role

You are implementing **R6** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D and R2 through R5 have been validated offline.

The validated baseline includes:

- Immutable typed node definitions and validated graph topology
- Runtime-local node state and active-attempt storage
- A closure-based runtime observer
- One closure-based execution controller used by explicit execution, scheduler execution, prefetch, and refresh
- A closure-based subscription controller with direct and required subscription accounting
- Subscription-driven automatic scheduling
- Coalesced scheduler microtasks
- Active-flush follow-up handling
- Scheduler failure inspection
- Scheduler settlement through `whenSettled()`
- Scheduler-only cancellation after final unsubscribe
- Eleven established notification ownership points

R6 extracts the automatic scheduler from `runtime.ts` into one closure-based internal capability.

R6 is a behavior-preserving extraction. It must not redesign scheduling semantics, alter execution ownership, or move cancellation policy into the scheduler.

Do not start R7 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/19-runtime-refactor-r5-subscription-lifecycle-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `src/core/scheduler.ts`
- `src/core/runtime-execution.ts`
- `src/core/runtime-subscriptions.ts`
- Scheduler state variables
- `isSchedulerSettled(...)`
- `resolveSettlementWaiters(...)`
- `getSchedulerState(...)`
- `schedule(...)`
- `flushScheduler(...)`
- `getSubscribedTargetsNeedingWork(...)`
- Scheduler notification points
- Scheduler error normalization
- Follow-up scheduling
- `whenSettled(...)`
- Subscription registration scheduling callback
- Context and refresh descendant scheduling callbacks
- Final-unsubscribe cancellation and settlement interaction
- Existing scheduler, subscription, execution, cancellation, prefetch, refresh, observer, and type tests

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

1. Apply only the R6 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve scheduler state transitions and notification timing.
5. Preserve scheduler settlement semantics.
6. Preserve the single execution engine.
7. Preserve subscription and cancellation ownership boundaries.
8. Return a ZIP containing only files added or changed for R6.
9. Provide exact offline validation commands.
10. Report project commands as `Not run in contained environment`.

No file deletion is expected for R6.

## Objective

Extract the existing automatic scheduler into:

```text
src/core/runtime-scheduler.ts
```

Use one small closure-based internal controller.

A reasonable internal contract is:

```ts
interface RuntimeSchedulerController {
  readonly schedule: () => void;
  readonly getSchedulerState: () => SchedulerState;
  readonly whenSettled: () => Promise<void>;
  readonly resolveSettlementIfIdle: () => void;
}
```

A reasonable dependency contract is:

```ts
interface RuntimeSchedulerDependencies {
  readonly getTargetsNeedingWork: () =>
    readonly AnyNodeDefinition[];

  readonly execute: (
    targets: readonly AnyNodeDefinition[]
  ) => Promise<void>;

  readonly notify: () => void;
}
```

The exact contract may be smaller or use slightly different names if existing conventions justify it.

Prefer the simplest controller that:

- Owns all scheduler mutable state
- Owns scheduler microtask queueing
- Owns flush and follow-up orchestration
- Owns scheduler error capture
- Owns scheduler snapshots
- Owns settlement waiters
- Delegates node execution to the R4 execution controller
- Selects targets through an injected runtime-owned query or a narrow dependency
- Does not absorb subscriptions, invalidation, cancellation, or one-shot operations

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

The public scheduler contract remains unchanged:

```ts
interface SchedulerState {
  readonly isScheduled: boolean;
  readonly isRunning: boolean;
  readonly error: Error | null;
}
```

Do not add, remove, rename, overload, or export public APIs.

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

Do not publicly export:

- `RuntimeSchedulerController`
- `RuntimeSchedulerDependencies`
- `schedule(...)`
- `flush(...)`
- Mutable scheduler state
- Follow-up flags
- Settlement waiters
- Scheduler target-selection helpers

## Ownership boundary

### R6 scheduler controller owns

- `isScheduled` mutable state
- `isRunning` mutable state
- Follow-up-required mutable state
- Scheduler error mutable state
- Settlement waiter storage
- Scheduler settled-state calculation
- Frozen public scheduler snapshots
- Coalesced microtask queueing
- Active-flush follow-up recording
- Flush lifecycle
- Clearing a prior scheduler error when a new flush begins
- Calling the injected execution function
- Capturing and normalizing scheduler execution failures
- Completion notification
- Follow-up scheduling after active work
- Settlement waiter resolution
- `whenSettled()` behavior
- Scheduler-owned notification points

### `runtime.ts` continues to own

- Runtime composition
- Observer construction
- Subscription-controller construction
- Execution-controller construction
- Context updates
- Descendant invalidation traversal
- Refresh operation preparation and deduplication
- Prefetch and refresh public operations
- Final-unsubscribe cancellation policy
- Active-attempt iteration
- Scheduler-only attempt ownership predicate
- Abort decisions
- Public runtime object assembly

### R4 execution boundary

The scheduler must delegate selected targets to the existing execution controller:

```ts
execution.execute(targets, "scheduler")
```

Do not move execution planning, loaders, derived evaluation, active-attempt sharing, origins, failure aggregation, or token-safe cleanup into the scheduler.

### R5 subscription boundary

The scheduler must use the R5 controller's direct-subscriber query when selecting terminal targets.

Do not move subscription counters, target registration, ancestor contribution accounting, or unsubscribe lifecycle into the scheduler.

### R7 invalidation boundary

Context and refresh descendant invalidation continue to decide whether scheduling should be requested.

The scheduler receives only a request to schedule. It does not traverse descendants or decide whether an invalidation affects subscribed nodes.

### Cancellation boundary

Final-unsubscribe cancellation remains outside the scheduler.

The scheduler controller must not:

- Iterate active attempts
- Inspect attempt origins
- Abort controllers
- Decide whether work remains subscriber-owned

After cancellation, runtime code may call a narrow method such as:

```ts
scheduler.resolveSettlementIfIdle();
```

if current settlement behavior requires an explicit idle re-check.

Prefer a name that communicates that this method does not force settlement while queued, running, or following up.

## Required source changes

### 1. Add `runtime-scheduler.ts`

Add:

```text
src/core/runtime-scheduler.ts
```

Keep this module internal and framework-agnostic.

It may import:

- `SchedulerState`
- Public node-definition types if needed for dependency typing
- `toError(...)` or receive an error-normalization dependency

It must not import:

- Vue
- Pinia
- Devtools
- Playground code
- Runtime subscriptions implementation
- Runtime state implementation
- Active-attempt types
- Runtime observer implementation
- Refresh-operation maps

Prefer injected functions over importing `runtime.ts`.

### 2. Move scheduler mutable state

Move these variables from `runtime.ts` into the scheduler factory:

```ts
let schedulerScheduled = false;
let schedulerRunning = false;
let schedulerFollowUpRequired = false;
let schedulerError: Error | null = null;
```

Preserve their initial values and semantics.

Do not replace them with:

- A general state machine
- An enum
- A reducer
- A class hierarchy
- A queue abstraction
- A task scheduler

Use simple closure-owned variables.

### 3. Move settlement waiters

Move:

```ts
const settlementWaiters = new Set<() => void>();
```

into the scheduler controller.

Preserve:

- Runtime-local waiter storage
- Multiple concurrent waiters
- Resolution together when scheduler quiescence is reached
- Immediate resolution when already settled
- No rejection on scheduler execution failure
- No notification solely because a waiter resolves

Do not expose waiter storage.

Do not broaden settlement to arbitrary explicit, prefetch, or refresh operations.

### 4. Move settled-state calculation

Move the existing scheduler quiescence predicate:

```ts
!schedulerScheduled &&
!schedulerRunning &&
!schedulerFollowUpRequired
```

into the scheduler controller.

Keep one named helper such as:

```ts
isSettled()
```

Do not weaken settlement to only `!isRunning`.

A queued microtask and a required follow-up both prevent settlement.

### 5. Move frozen scheduler snapshots

Move `getSchedulerState(...)` into the scheduler controller.

Preserve:

```ts
Object.freeze({
  isScheduled: schedulerScheduled,
  isRunning: schedulerRunning,
  error: schedulerError,
});
```

Requirements:

- Return a fresh object per call.
- Freeze each snapshot.
- Preserve the current error object reference.
- Do not expose the follow-up flag.
- Do not cache snapshots.

### 6. Move scheduler request handling

Move `schedule(...)` into the controller.

Preserve exact behavior:

#### Request during active flush

If the scheduler is running:

```ts
schedulerFollowUpRequired = true;
return;
```

This private change does not itself notify because no public scheduler state changes.

#### Request while already queued

If already scheduled, return without additional work or notification.

#### New idle request

When idle:

1. Set scheduled state to true.
2. Notify after the public scheduler state commits.
3. Queue one microtask.
4. The microtask invokes the scheduler's private flush.

Do not invoke loaders synchronously from `schedule()`.

Do not queue multiple microtasks for synchronous requests.

Do not use real-time timers.

### 7. Preserve microtask strategy

Retain the existing mechanism:

```ts
queueMicrotask(() => {
  void flush();
});
```

or the exact equivalent already used by the repository.

Do not switch to:

- `setTimeout(...)`
- A configurable scheduler
- A promise chain abstraction
- Browser-specific APIs

Do not add test-only scheduling hooks.

### 8. Move target selection or inject it narrowly

There are two acceptable designs.

#### Preferred design

Keep target selection in `runtime.ts` and inject:

```ts
getTargetsNeedingWork: () =>
  readonly AnyNodeDefinition[]
```

This preserves the boundary that target selection depends on:

- Graph registration order
- R5 direct subscription state
- R4 fresh-success execution policy

The scheduler orchestrates the returned targets but does not know subscription internals.

#### Acceptable design

Move the small target-selection function into the scheduler controller by injecting:

- `graph.getNodes()` access
- `subscriptions.hasDirectSubscribers(...)`
- `execution.needsExecution(...)`

Prefer the first design because it gives the scheduler the narrowest dependency and avoids importing the subscription controller.

Preserve target behavior:

- Context nodes are excluded.
- Only directly subscribed nodes become terminal targets.
- Only nodes needing execution are included.
- Required ancestors are included by execution.
- Registration order remains deterministic.

Do not select required-only nodes as separate terminal targets.

### 9. Move flush lifecycle

Move `flushScheduler(...)` into the controller as a private async function.

Preserve this sequence.

#### Guard

Return immediately unless a flush is scheduled and no flush is running.

#### Start commit

Before execution:

```text
isScheduled: false
isRunning: true
followUpRequired: false
error: null
```

Notify after these public scheduler-state changes are committed.

Clearing the prior error occurs as part of the start commit and not as a separate notification.

#### Target calculation

Calculate targets at flush time, not scheduling-request time.

This preserves:

- Unsubscribe before flush preventing work
- Latest context values
- Latest subscription state
- Latest node generations
- Coalesced synchronous changes

#### Execution

If targets are non-empty, call the injected scheduler execution function.

If targets are empty, complete normally.

#### Failure

Catch execution failure and store:

```ts
schedulerError = toError(error);
```

Do not rethrow from the scheduler microtask.

Do not create an unhandled rejection.

Abort and obsolete work should retain current behavior through the execution controller's aggregate result.

#### Completion commit

In `finally`:

1. Set running state to false.
2. Leave the captured scheduler error in state.
3. Notify after the completion state is committed.

#### Follow-up

If follow-up is required:

1. Clear the private follow-up flag.
2. Request another scheduled microtask using the same `schedule()` method.
3. Do not resolve settlement waiters yet.

Otherwise resolve settlement waiters.

Do not recursively execute the follow-up synchronously.

### 10. Preserve scheduler error semantics

The scheduler error remains:

- Initially `null`
- Cleared when a new flush starts
- Set when automatic execution rejects
- Available from `getSchedulerState()`
- Unchanged by explicit execution, prefetch, or refresh unless scheduler execution independently fails
- Non-retrying without a new external schedule request

Do not add:

- Retry counts
- Retry delays
- Error history
- Separate error callbacks
- Diagnostics events

Do not clear the scheduler error merely because `whenSettled()` is called.

### 11. Preserve notification ownership

The scheduler owns three semantic notification points:

1. Idle scheduler request commits `isScheduled: true`.
2. Flush start commits scheduled/running state and clears prior error.
3. Flush completion commits `isRunning: false` and any captured error.

These notifications move with the scheduler controller.

Do not notify:

- When setting the private follow-up flag
- When a duplicate schedule request is ignored
- When target selection returns empty beyond the normal start and completion transitions
- When settlement waiters resolve
- When `whenSettled()` resolves immediately

Do not batch, defer beyond existing microtask behavior, or add payloads.

The semantic total across capabilities remains eleven:

- Subscription lifecycle: 2
- Execution controller: 3
- Scheduler controller: 3
- Context and invalidation: 1
- Refresh preparation: 1
- Refresh-result descendant invalidation: 1

Exact physical counts may be verified by semantic source inspection rather than raw text alone.

### 12. Move `whenSettled(...)`

Move the public implementation into the scheduler controller.

Preserve:

```ts
if (isSettled()) return Promise.resolve();
return new Promise(resolve =>
  settlementWaiters.add(resolve)
);
```

Required behavior:

- Resolves immediately when idle.
- Waits for queued work.
- Waits for active work.
- Waits for required follow-up work.
- Resolves after success.
- Resolves after failure.
- Resolves after scheduler-owned cancellation when no scheduler work remains.
- Multiple waiters resolve together.
- Never rejects because scheduler execution failed.

Do not broaden it to caller-owned operations.

### 13. Add a narrow settlement re-check method

Current final-unsubscribe cancellation may explicitly call settlement resolution after aborting scheduler-only work.

Expose one narrow internal method if required:

```ts
resolveSettlementIfIdle(): void
```

or:

```ts
checkSettlement(): void
```

Its behavior must be:

- Resolve waiters only when the scheduler is fully settled.
- Do nothing while scheduled, running, or following up.
- Produce no notification.
- Change no scheduler flags.

Do not expose this method publicly.

If static inspection shows the call is unnecessary because the active scheduler flush always resolves waiters, omit it rather than adding redundant API. Preserve existing behavior either way.

### 14. Rewire subscription scheduling

The R5 subscription controller currently receives runtime callbacks.

Wire:

```ts
afterSubscribe: scheduler.schedule
```

Preserve ordering inside the subscription controller:

1. Commit subscription counts.
2. Send subscription notification.
3. Call scheduler request.

Do not move subscription notifications into the scheduler.

### 15. Rewire context invalidation scheduling

Context updates remain in `runtime.ts`.

After context and descendant state commit and the context/invalidation notification:

```ts
if (subscribedDescendantChanged) {
  scheduler.schedule();
}
```

Preserve synchronous context mutation and later microtask loading.

Do not move invalidation traversal into the scheduler.

### 16. Rewire refresh-result descendant scheduling

The R4 execution controller's changed-refresh-result callback remains runtime-owned.

After descendant invalidation and its notification:

```ts
if (subscribedDescendantChanged) {
  scheduler.schedule();
}
```

Preserve ordering:

1. Refreshed node success commit
2. Execution success notification
3. Descendant invalidation commit
4. Descendant invalidation notification
5. Scheduler request

Do not move changed-result comparison or descendant traversal into the scheduler.

### 17. Rewire final-unsubscribe settlement

The R5 `afterUnsubscribe` callback remains runtime-owned because it contains active-attempt cancellation policy.

After the cancellation loop, call the scheduler's narrow idle-settlement re-check if required:

```ts
scheduler.resolveSettlementIfIdle();
```

Do not move cancellation into the scheduler.

Do not call `schedule()` on unsubscribe.

### 18. Rewire public runtime methods

`createGraphRuntime(...)` creates one scheduler controller:

```ts
const scheduler = createRuntimeSchedulerController({
  getTargetsNeedingWork,
  execute: targets =>
    execution.execute(targets, "scheduler"),
  notify,
});
```

Because subscriptions and execution may need scheduler callbacks during composition, handle construction order simply and explicitly.

Acceptable approaches include:

- Define narrow callback closures that reference initialized controller variables only when invoked later.
- Construct execution, then scheduler, then subscriptions where dependencies permit.
- Use one clearly typed deferred local binding only when necessary.

Do not create a dependency-injection container or builder.

The public runtime delegates:

```ts
getSchedulerState: scheduler.getSchedulerState,
whenSettled: scheduler.whenSettled,
```

Do not expose `schedule()` or settlement re-check publicly.

### 19. Keep `scheduler.ts` public-contract-only

The existing:

```text
src/core/scheduler.ts
```

should continue to contain the public `SchedulerState` contract.

Preferred organization:

```text
src/core/scheduler.ts
src/core/runtime-scheduler.ts
```

Do not change public exports from `scheduler.ts`.

Do not place private mutable scheduler implementation in the public contract file unless existing conventions clearly require it.

## Behavior that must remain unchanged

### Scheduling triggers

- Successful non-empty subscription requests scheduling.
- Relevant context invalidation requests scheduling.
- Changed refresh results request scheduling for affected subscribed descendants.
- New requests while running require one follow-up.
- Equal context updates remain silent.
- Empty subscriptions remain silent.
- Unsubscribe does not request new work.

### Coalescing

- Multiple synchronous requests queue one microtask.
- Duplicate requests while queued do nothing.
- Loaders do not run synchronously inside subscription or context mutation.
- Targets are calculated at flush time.

### Follow-up behavior

- Only one flush runs at a time.
- Requests during a flush set one private follow-up requirement.
- Multiple active-flush requests coalesce.
- Follow-up target calculation uses current state.
- Follow-up runs in a later microtask.
- Settlement waits for follow-up completion.

### Target selection

- Context nodes are excluded.
- Directly subscribed nodes are terminal targets.
- Required-only ancestors are included by execution.
- Fresh successful targets are skipped.
- Error, stale, idle, and never-successful targets remain eligible according to R4 execution policy.

### Execution

- Scheduler uses the R4 execution controller.
- All active-attempt sharing and origin semantics remain unchanged.
- Scheduler and explicit execution can share attempts.
- Scheduler and prefetch can share attempts.
- Scheduler and refresh can share work where existing behavior permits.

### Failure

- Scheduler failures are caught.
- No unhandled microtask rejection occurs.
- Scheduler error is inspectable.
- Node errors remain owned by execution.
- Failure does not immediately retry.
- A later external trigger can retry.
- Starting a new flush clears the prior scheduler error.

### Settlement

- Idle settlement resolves immediately.
- Queued work prevents settlement.
- Running work prevents settlement.
- Follow-up work prevents settlement.
- Failure still settles.
- Cancellation still settles.
- Multiple waiters resolve together.
- Explicit execution, prefetch, and refresh are not included solely because they are caller-owned.

### Notifications

- Idle scheduling request is observable.
- Flush start is observable.
- Flush completion is observable.
- Follow-up private state is not independently observable.
- Waiter resolution is not observable.
- Listener failure isolation remains owned by R2.

### Cancellation

- Final unsubscribe still cancels only scheduler-only work with no subscribers.
- Shared or caller-owned work remains active.
- The scheduler does not own cancellation decisions.

### Public API

- Public signatures and exports remain unchanged.
- Public scheduler snapshots remain frozen.
- Scheduler internals remain private.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not test the private scheduler controller directly unless public behavior cannot prove the requirement. Prefer public `GraphRuntime` entry points.

### 1. Existing scheduler subscription coverage must remain

Existing tests must continue to prove:

- Subscribed data loads automatically.
- Required ancestors execute.
- Derived targets execute.
- Context subscriptions settle without loaders.
- Unrelated nodes do not load.

### 2. Existing coalescing coverage must remain

Existing tests must continue to prove:

- Synchronous subscriptions coalesce.
- Shared ancestors load once.
- Latest context value is used.
- Unsubscribe before flush prevents loading.

### 3. Existing context follow-up coverage must remain

Existing tests must continue to prove:

- Context change during execution aborts obsolete work.
- One follow-up uses the latest context.
- Multiple synchronous changes coalesce.
- Unsubscribed descendants do not load.

### 4. Existing scheduler cancellation coverage must remain

Existing tests must continue to prove:

- Final unsubscribe aborts scheduler-only work.
- One remaining subscriber protects work.
- Explicit caller-owned work survives.
- Prefetch caller-owned work survives.
- Refresh caller-owned work survives.
- Cancellation is not a node or scheduler business error.

### 5. Existing scheduler failure coverage must remain

Existing tests must continue to prove:

- Automatic execution failure is stored.
- Scheduler settles after failure.
- Failure does not immediately retry.
- New subscription can retry.
- Context change can retry.
- Successful retry clears scheduler and node errors.

### 6. Existing settlement coverage must remain

Existing tests must continue to prove:

- Immediate idle resolution.
- Frozen scheduler snapshots.
- Waiting for queued and active work.
- Multiple waiters resolving together.
- Final state after completion.
- Scheduler state progression through observation.

### 7. Add follow-up settlement coverage only if missing

Ensure one public behavior test explicitly proves:

1. Scheduler work starts.
2. A schedule-triggering context update occurs during the active flush.
3. `whenSettled()` is called before the first attempt completes.
4. The first attempt becomes obsolete or settles.
5. The follow-up attempt runs.
6. `whenSettled()` resolves only after the follow-up completes.

Existing `scheduler-context.spec.ts` and settlement tests may already prove this together. Add one focused test only if the behavior is not explicit.

Use deferred promises and `waitForCondition(...)`.

Do not assert a fixed number of microtask turns.

### 8. Add scheduler snapshot independence if missing

Ensure public tests prove:

```ts
const before = runtime.getSchedulerState();
runtime.subscribeNodes([node]);
const queued = runtime.getSchedulerState();

expect(before.isScheduled).toBe(false);
expect(queued.isScheduled).toBe(true);
expect(before).not.toBe(queued);
expect(Object.isFrozen(before)).toBe(true);
expect(Object.isFrozen(queued)).toBe(true);
```

Add only if current tests do not sufficiently establish fresh snapshots.

### 9. Type tests

Existing type tests must continue to prove:

- Scheduler state fields are read-only.
- Scheduler error is `Error | null`.
- `whenSettled()` returns `Promise<void>`.
- Existing subscription, execution, prefetch, and refresh typing remains intact.
- Public APIs require no `any`.

Do not expose internal scheduler-controller types.

### 10. Test restraint

Do not add tests for:

- Private flag names
- Private waiter set size
- Private flush method identity
- Exact microtask count
- Internal callback identity
- Source-file placement

Test observable behavior.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R5 remain validated offline.
- R6 implementation is prepared.
- R6 offline validation remains pending.
- R7 through R9 remain incomplete.
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
[ ] R6 offline validation
[ ] R7: Extract invalidation and context updates
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R5 as validated offline
- R6 as prepared with offline validation pending
- R7 through R9 as planned

Add a brief R6 implementation decision under the R6 section:

- Scheduler flags, error state, microtask queueing, follow-up handling, snapshots, and settlement moved into one runtime-local closure controller.
- Scheduler target selection remains a narrow injected runtime query.
- All scheduler work delegates to the R4 execution controller using the scheduler origin.
- Subscription, invalidation, and cancellation policy remain outside the scheduler.
- Scheduler notification ownership and timing remain unchanged.

Do not rewrite earlier refactor decisions.

### 3. Add an R6 implementation note

Add:

```text
docs/implementation/20-runtime-refactor-r6-scheduler-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Scheduler-controller contract
- Dependency contract
- Mutable scheduler state ownership
- Microtask coalescing behavior
- Flush lifecycle
- Follow-up behavior
- Target-selection boundary
- Execution delegation
- Error capture
- Notification ownership
- Settlement and waiters
- Final-unsubscribe settlement boundary
- Tests added or updated
- Confirmation that public APIs and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R7
- Next task: R7

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/012-runtime-refactor-r6-extract-automatic-scheduler.md
```

## Out of scope

Do not implement:

- Subscription storage changes
- Subscription lifecycle changes
- Execution-controller changes
- Runtime-state changes
- Observer changes
- Invalidation extraction
- Context-update extraction
- Prefetch extraction
- Refresh extraction
- Active-attempt cancellation changes
- Attempt-origin changes
- Runtime assembly simplification beyond scheduler construction and delegation
- Public scheduler API changes
- New scheduling priorities
- Configurable concurrency
- Retry or backoff
- Timers or polling
- Transactions
- Domain events
- Vue composables
- Query groups
- Mutations
- Diagnostics or metrics
- Snapshots
- Devtools
- Cache garbage collection
- Fluent builders
- Dependency-injection containers
- Public controller APIs
- New public exports

Do not create a general scheduler framework or task queue abstraction.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-scheduler.ts
src/core/runtime.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/20-runtime-refactor-r6-scheduler-implementation-note.md
docs/implementation/prompts/012-runtime-refactor-r6-extract-automatic-scheduler.md
```

Potential focused test changes only if current coverage is insufficient:

```text
tests/core/scheduler-context.spec.ts
tests/core/scheduler-settlement.spec.ts
```

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve runtime behavior exactly.
- Preserve coalesced microtask scheduling.
- Preserve one active flush per runtime.
- Preserve one follow-up requirement.
- Preserve target calculation at flush time.
- Preserve direct-subscriber terminal selection.
- Preserve execution delegation through R4.
- Preserve scheduler error semantics.
- Preserve scheduler notification timing.
- Preserve scheduler settlement semantics.
- Keep subscriptions outside the scheduler.
- Keep invalidation outside the scheduler.
- Keep cancellation outside the scheduler.
- Keep refresh operations outside the scheduler.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging.
- Do not add global state.
- Do not add dependencies.
- Do not expose internal controller contracts publicly.
- Avoid fixed microtask assumptions in tests.
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
11. Confirm `runtime-scheduler.ts` is not exported from `src/core/index.ts`.
12. Confirm `scheduler.ts` public contracts are unchanged.
13. Confirm one scheduler controller is created per runtime.
14. Confirm all scheduler mutable flags and error state exist only inside the scheduler factory.
15. Confirm settlement waiters exist only inside the scheduler factory.
16. Confirm no module-level mutable scheduler state exists.
17. Confirm scheduler snapshots are fresh and frozen.
18. Confirm the settled predicate includes scheduled, running, and follow-up state.
19. Confirm idle scheduling sets scheduled state before notification.
20. Confirm active-flush requests set only the private follow-up flag.
21. Confirm duplicate queued requests do not notify or queue again.
22. Confirm one microtask is queued for an idle request.
23. Confirm target selection occurs inside flush, not when scheduling is requested.
24. Confirm flush start clears prior scheduler error before notification.
25. Confirm scheduler execution delegates to `execution.execute(targets, "scheduler")` through the injected dependency.
26. Confirm execution rejection is caught and normalized.
27. Confirm the scheduler microtask does not leak a rejected promise.
28. Confirm completion sets running false before notification.
29. Confirm follow-up scheduling occurs after completion and before waiter resolution.
30. Confirm waiter resolution itself does not notify.
31. Confirm `whenSettled()` remains scheduler-only.
32. Confirm subscription registration still notifies before scheduling.
33. Confirm context invalidation still notifies before scheduling.
34. Confirm refresh descendant invalidation still notifies before scheduling.
35. Confirm final-unsubscribe cancellation remains outside the scheduler.
36. Confirm scheduler-only attempt ownership logic remains outside the scheduler.
37. Confirm R2 observer source is unchanged.
38. Confirm R3 runtime-state source is unchanged.
39. Confirm R4 execution-controller semantics are unchanged.
40. Confirm R5 subscription-controller semantics are unchanged except callback wiring required by R6.
41. Confirm the semantic total of notification ownership points remains eleven.
42. Confirm no R7 or later extraction occurred.
43. Confirm R6 is validation pending and R7 through R9 remain incomplete.
44. Create a ZIP containing only R6 files added or changed.
45. Validate ZIP integrity and contents before responding.

Use a mechanical source reconstruction or focused diff review to prove that `runtime.ts` changes are limited to:

- Scheduler-controller import and construction
- Removal of local scheduler state and waiters
- Removal of local scheduling and flush functions
- Delegation of public scheduler APIs
- Replacement of schedule callback references
- Narrow target-selection and execution dependency wiring
- Final-unsubscribe idle-settlement callback wiring where required

These static checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R6 ZIP, run from the repository root:

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

R6 is ready for offline validation when:

- One closure-based scheduler controller exists per runtime.
- Scheduler flags, error state, and waiters are private and runtime-local.
- Scheduler snapshots remain fresh and frozen.
- Synchronous requests coalesce into one microtask.
- Requests during a flush create one follow-up requirement.
- Targets are recalculated at flush time.
- Only directly subscribed non-context targets needing work are selected.
- Scheduler work delegates to the R4 execution controller with the scheduler origin.
- Automatic failures are caught and stored without unhandled rejection.
- Scheduler start clears prior error.
- Completion and failure remain observable through scheduler snapshots.
- `whenSettled()` waits for queued, active, and follow-up work.
- Multiple waiters resolve together.
- Settlement remains scheduler-only.
- Subscription, invalidation, and refresh-result notifications occur before scheduling requests.
- Final-unsubscribe cancellation remains outside the scheduler.
- Public APIs and exports are unchanged.
- R2 observation, R3 storage, R4 execution, and R5 subscription semantics remain intact.
- Existing behavior-focused tests remain intact.
- R6 is marked prepared with offline validation pending.
- R7 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R6 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Automatic execution, coalescing, follow-up, failure, settlement, observation, and cancellation interaction remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R6.
2. A ZIP containing only R6 files added or changed.
3. Files added and changed.
4. The internal scheduler-controller contract.
5. The controller dependency contract.
6. Mutable state, snapshot, and microtask decisions.
7. Flush, follow-up, target-selection, and execution-delegation decisions.
8. Error, notification, and settlement decisions.
9. Subscription, invalidation, refresh-result, and cancellation callback boundaries.
10. Tests added or updated.
11. Confirmation that public APIs, exports, R2 observation, R3 storage, R4 execution, R5 subscriptions, cancellation policy, and runtime behavior were intentionally preserved.
12. Static checks and results.
13. Project commands marked `Not run in contained environment`.
14. Exact offline validation steps.
15. The next planned task: R7.
