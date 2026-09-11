# Implementation Prompt 005: Implement the Automatic Node Subscription Scheduler

## Role

You are implementing Step 3B of Milestone 3 for `vue-dependency-graph`: automatic scheduling and execution for subscribed nodes.

The repository is a single private pnpm package with logical layers under `src`. All framework implementation in this step belongs in `src/core`.

The validated baseline now includes:

- Immutable typed node definitions
- Order-independent validated topology
- Separate runtime state
- Explicit dependency-aware execution
- Context invalidation
- Per-attempt cancellation
- Generation-based obsolete-result protection
- In-flight deduplication
- Branch-scoped failure handling
- Runtime observation
- Direct and required node subscription
- Reference-counted unsubscribe
- Subscription inspection

All previous validation has passed offline. Build on the existing runtime and execution engine. Do not replace them with a second execution path.

Implement only:

- Automatic scheduling when non-empty a node subscription is added
- Automatic scheduling when subscribed nodes become stale
- One queued microtask flush per synchronous change group
- Coalescing of repeated schedule requests
- Selection of subscribed nodes that currently need execution
- Use of the existing `runtime.execute(...)` engine
- Scheduler state needed to prevent overlapping flushes
- A follow-up flush when relevant changes occur during active execution
- Subscription-driven cancellation when total subscription count disappears
- Scheduler error observation without unhandled promise rejections
- A small readiness API needed to validate scheduler completion

Do not implement:

- Prefetch
- Manual refresh
- Vue composables
- Vue scope disposal
- Query groups
- Multi-context transactions
- Domain events
- Polling
- Retry or backoff policies
- Optimistic mutations
- Metrics
- Snapshots
- Devtools UI
- Cache garbage collection

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/07-runtime-execution-implementation-note.md`
- `docs/implementation/08-subscription-subscription-implementation-note.md`
- `docs/testing/01-test-strategy.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Also review the original execution and subscription services if they are available. Preserve the proven idea that subscribed data should load automatically, but do not copy Vue watchers, effect scopes, status callbacks, manual `loadData()` calls, or string-only node selection into the core scheduler.

If the repository differs from these documents, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not install dependencies, run pnpm commands, execute Vitest, run TypeScript builds, or start Vite.

Your responsibilities are to:

1. Create or update the required source, test, and documentation files.
2. Perform static inspection that does not require installed dependencies.
3. Check exports, import boundaries, scheduler ownership, and obvious async-state issues.
4. Return a ZIP containing only files added or changed for Step 3B.
5. Provide exact offline validation commands.
6. Report project command results as `Not run in contained environment`.

The developer will apply the ZIP, run the project offline, and return errors or observations. Do not claim that type checking, tests, builds, or runtime validation succeeded.

## Objective

Make a node subscription sufficient to load data automatically.

The intended consumer behaviour should be close to:

```ts
const subscription = runtime.subscribeNodes([Targets]);

await runtime.whenSettled();

const state = runtime.getState(Targets);
```

No consumer should need to call:

```ts
runtime.execute([Targets]);
```

for normal subscription-driven loading.

The explicit `execute(...)` API remains public and supported for low-level use and tests. Step 3B adds scheduler orchestration on top of it.

## Core design constraints

### 1. One execution engine

The scheduler must call the existing explicit execution engine. It must not duplicate:

- Ancestor collection
- Dependency ordering
- Loader invocation
- Derived evaluation
- In-flight deduplication
- Generations
- Cancellation checks
- Branch-scoped failure handling

A scheduler flush determines which subscribed targets need work, then delegates to:

```ts
runtime.execute(targets);
```

If the existing implementation makes this difficult because `execute` is only available on the frozen public object, perform the smallest internal extraction needed to share the same function. Do not create a parallel executor.

### 2. Scheduler ownership

Scheduler state belongs to each runtime instance.

Separate runtimes created from the same graph must have independent:

- Queued-flush state
- Active-flush state
- Follow-up request state
- Scheduler error state
- Settlement waiters
- Subscription-driven cancellation decisions

Do not introduce global scheduler state.

### 3. Schedule triggers

Request a scheduler flush when:

- A non-empty node a node subscription is added.
- A context update makes subscribed descendants stale.
- A subscribed node remains stale after a recoverable scheduler execution failure and a later state change explicitly requests another pass.
- A node a node subscription is added while another scheduler flush or execution is active.

Do not request a scheduler flush when:

- An empty node a node subscription is added.
- Subscription is released and no new work is required.
- A runtime notification is emitted only because a node changed to `loading`, `refreshing`, or `success` during the scheduler's own execution.
- An obsolete result is discarded.
- A context is set to an `Object.is` equal value.

The scheduler should be invoked explicitly from relevant mutation points rather than subscribing to every runtime notification. This avoids recursive schedule loops.

### 4. Microtask scheduling

Coalesce synchronous schedule requests into one queued microtask.

Recommended mechanism:

```ts
queueMicrotask(flush);
```

or an equivalent resolved-promise mechanism if required by project compatibility.

Required behaviour:

```ts
runtime.subscribeNodes([A]);
runtime.subscribeNodes([B]);
runtime.setContext(Context, nextValue);
```

within the same synchronous turn should queue one scheduler flush.

Do not execute loaders synchronously inside `subscribeNodes` or `setContext`.

This separation matters because consumers must finish related synchronous state changes before execution planning begins.

### 5. Subscription target selection

At flush time, inspect current graph and runtime state.

Select nodes where:

- Total subscription count is greater than zero.
- The node needs work.

A node needs work when it is not currently represented by a successful fresh value. This generally includes:

- Initial `idle` data or derived node
- Stale successful node
- Error node

Do not select context nodes for loading. Context nodes may remain subscribed and are already successful and fresh.

The scheduler may pass all directly subscribed nodes that need work to `execute`, or all subscribed nodes that need work, provided behaviour remains correct and duplicate execution is avoided by the existing engine. Prefer selecting directly subscribed terminal targets if the runtime can do so without exposing internal subscription records.

Important: required ancestors should be included by the existing execution engine, not manually executed by the scheduler.

### 6. Required-only subscription

A node with required subscription but no direct subscription should load when it is an ancestor of a directly subscribed target.

Do not schedule required-only nodes as independent terminal targets unless necessary for correctness. The execution engine naturally includes them as ancestors.

If a node has only required subscription because of existing subscriptions, but all directly subscribed descendants have been released, the subscription accounting should already return it to zero.

### 7. Active flush and follow-up flush

Only one scheduler flush may be active per runtime.

If a schedule request occurs while a flush is active:

- Do not start another overlapping scheduler flush.
- Set a follow-up-required flag.
- After the active flush settles, recalculate subscription and runtime state from scratch.
- Queue or run one follow-up flush if work is still needed.

Do not reuse a stale target list across context or subscription changes.

The existing node-level in-flight deduplication remains a safety net, but the scheduler should still avoid unnecessary overlapping orchestration.

### 8. No-progress and loop protection

The scheduler must not create an infinite microtask loop when subscribed nodes are in error.

After an automatic execution fails:

- Record the scheduler error.
- Notify runtime observers once for the committed scheduler-error change if a public error state is exposed.
- Consider that automatic attempt settled.
- Do not immediately reschedule the same stale errored nodes without a new external trigger.

Valid new triggers include:

- Context change
- New node subscription
- Step 3C manual refresh in the future
- Retry policy in a later milestone

A failed subscribed node may remain subscribed and stale without continuously retrying.

### 9. Scheduler error model

Automatic execution cannot return a rejected promise directly to the consumer who added subscription because `subscribeNodes` is synchronous.

Expose a small read-only scheduler error state or runtime inspection API.

Recommended shape:

```ts
interface SchedulerState {
  readonly isScheduled: boolean;
  readonly isRunning: boolean;
  readonly error: GraphExecutionError | Error | null;
}

runtime.getSchedulerState();
```

Alternative naming is acceptable if simpler.

Required behaviour:

- Initial error is `null`.
- Starting a new externally triggered scheduler attempt clears the previous scheduler error.
- Execution failure stores the error after branches settle.
- Abort or obsolete execution caused by a context change is not stored as a scheduler business error.
- Returned state is read-only.
- No automatic scheduler promise rejection becomes unhandled.

Do not implement the full diagnostics event stream.

### 10. Settlement API

Provide a deterministic way for framework adapters and tests to await scheduler quiescence.

Recommended API:

```ts
await runtime.whenSettled();
```

Semantics:

- Resolve when no scheduler microtask is queued and no scheduler flush is running.
- Include a required follow-up flush before resolving.
- Resolve after successful automatic execution.
- Resolve after failed automatic execution, with the error available through scheduler state.
- Resolve immediately when already settled.
- Multiple waiters resolve together.
- Do not reject because a node execution failed.

This API represents scheduler settlement, not successful data readiness.

Do not call it `whenReady`, because a settled runtime can contain failed or stale subscribed nodes.

### 11. Automatic loading on subscription

Adding the first effective non-empty subscription should schedule subscribed work.

Examples:

```ts
runtime.subscribeNodes([DataNode]);
await runtime.whenSettled();
```

should execute `DataNode`.

```ts
runtime.subscribeNodes([DerivedNode]);
await runtime.whenSettled();
```

should execute required data ancestors and then derive the target.

Adding subscription for an already fresh successful node should still coalesce through scheduler logic if simpler, but it must not invoke the loader again.

Adding a second subscription for a node already loading must not invoke another loader.

### 12. Context changes with active subscription

When a context changes:

- Existing Milestone 2 logic marks descendants stale and aborts affected attempts.
- If any affected descendant remains subscribed, request a scheduler flush.
- The follow-up execution must use the new context value.
- Obsolete old results must not commit.
- Unrelated subscribed branches must not be restarted merely because another context branch changed.

When no affected descendant is subscribed, do not schedule execution.

A context update itself remains synchronous. Reload begins in a later microtask.

### 13. Subscription-driven cancellation

When a node subscription is unsubscribed and a node's total subscription count reaches zero:

- Abort scheduler-owned in-flight work that is no longer required by any subscribed target.
- Do not abort a shared ancestor that is still required by another subscribed target or subscription.
- Do not treat this cancellation as a business error.
- Do not automatically clear data or errors.

This requires identifying whether an active node is still in the required closure of current direct subscription.

Use the current graph and subscription state. Do not rely only on the node's own total count if the implementation's semantics make active shared work ambiguous.

Keep explicit low-level `runtime.execute(...)` ownership distinct:

- Recommended rule: scheduler release cancellation should abort only attempts started or retained by scheduler subscription.
- An explicit caller-started execution should not unexpectedly be cancelled solely because a node node subscription is unsubscribed.

If the current active-attempt structure cannot identify ownership, add the smallest internal attempt-origin marker such as:

```ts
type ExecutionOrigin = "explicit" | "scheduler";
```

Document the final rule and test it.

Do not expose attempt ownership publicly.

### 14. Releasing subscription before the microtask runs

Example:

```ts
const subscription = runtime.subscribeNodes([Targets]);
subscription.unsubscribe();
await runtime.whenSettled();
```

The loader must not run because there is no subscription when the flush evaluates current state.

Do not preserve stale target lists captured at subscription time.

### 15. Multiple subscriptions

If two consumers subscription the same target:

- One automatic execution is scheduled.
- The loader runs once.
- Releasing one subscription does not cancel work while the other remains.
- Releasing the final subscription cancels scheduler-owned work if still in flight.

### 16. Error recovery trigger

After automatic execution fails, the scheduler must remain settled and must not spin.

When a new context value is set or a new a node subscription is added:

- Clear the previous scheduler error at the start of the new scheduled attempt.
- Attempt subscribed stale work again.
- Success clears node error and leaves scheduler error `null`.

Adding a duplicate subscription counts as a valid external trigger because a new consumer may reasonably expect subscribed work to be attempted. Document this choice.

Do not add retry counts or delay policies.

### 17. Runtime observation

Use the existing runtime subscription mechanism.

Observers should be notified for committed scheduler-state changes when those changes are publicly inspectable, including:

- Scheduler queued, if `isScheduled` is exposed
- Scheduler started
- Scheduler completed
- Scheduler error stored or cleared

Avoid excessive duplicate notifications where one atomic scheduler-state update is sufficient.

Existing node-state notifications remain unchanged.

Listener failures remain isolated.

### 18. Interaction with explicit execution

The explicit API remains valid:

```ts
await runtime.execute([Targets]);
```

Required interactions:

- Scheduler and explicit calls share node-level in-flight deduplication.
- Explicit execution does not create subscription.
- Explicit execution success can satisfy later subscribed work because the node is fresh.
- Explicit execution failure is returned to the explicit caller as before.
- Scheduler errors are recorded only for scheduler-triggered orchestration.

Do not change the public explicit execution failure contract.

### 19. Public API typing

Suggested additions:

```ts
runtime.getSchedulerState();
runtime.whenSettled();
```

Existing APIs remain:

```ts
runtime.subscribeNodes(nodes);
runtime.getSubscriptionState(node);
runtime.hasSubscribers(node);
runtime.execute(nodes);
```

The scheduler does not require string keys in public APIs.

Do not use `any`.

## Suggested source organisation

Keep the scheduler small and runtime-owned.

A reasonable structure is:

```text
src/core/
├── subscription.ts
├── execution.ts
├── graph.ts
├── index.ts
├── nodes.ts
├── runtime.ts
├── scheduler.ts
└── types.ts
```

`scheduler.ts` may contain public scheduler contracts and focused helper functions. Runtime-owned scheduling state may remain in `runtime.ts` if this avoids a class or broad callback interface.

Do not create a general task scheduler abstraction.

Suggested tests:

```text
tests/core/
├── scheduler-subscription.spec.ts
├── scheduler-coalescing.spec.ts
├── scheduler-context.spec.ts
├── scheduler-cancellation.spec.ts
├── scheduler-failure.spec.ts
├── scheduler-settlement.spec.ts
└── scheduler-types.test.ts
```

Retain all existing tests. Continue using deterministic deferred promises and `waitForCondition`. Avoid real-time delays.

## Public API direction

A reasonable Step 3B surface is:

```ts
const subscription = runtime.subscribeNodes([Targets]);

await runtime.whenSettled();

const scheduler = runtime.getSchedulerState();
const targets = runtime.getState(Targets);

subscription.unsubscribe();
```

Suggested contract:

```ts
interface SchedulerState {
  readonly isScheduled: boolean;
  readonly isRunning: boolean;
  readonly error: Error | null;
}
```

Export public scheduler contracts from `src/core/index.ts` and the root entry point.

Do not export:

- Mutable scheduler state
- Queued microtask handles
- Follow-up flags
- Settlement resolver collections
- Attempt-origin maps
- Internal target-selection helpers
- Test utilities

Exact naming may change if a simpler coherent API emerges. Document deviations.

## Tests

Use Vitest 3.0.7 and TypeScript.

### Automatic subscription execution

Test:

- Data node loads after subscription is registered.
- Derived target loads required data ancestors and evaluates afterward.
- Context target requires no loader and settles.
- Unrelated nodes do not load.
- Already fresh node does not reload.
- Node subscription does not invoke the loader synchronously.

### Microtask coalescing

Test:

- Multiple synchronous node subscriptions queue one flush.
- Duplicate subscriptions for the same node produce one loader call.
- Multiple targets sharing ancestors load each ancestor once.
- A context update and node subscription in one synchronous turn use the latest context value.
- Release before the queued flush prevents loading.

Do not assert a fixed number of microtask turns. Use `runtime.whenSettled()`, deferred promises, or observable conditions.

### Active-flush follow-up

Test:

- Context change during active execution requests one follow-up pass.
- New subscription during active execution is included in the follow-up pass.
- Multiple changes during an active flush coalesce into one follow-up flush.
- Follow-up planning reads current subscription and current generations.
- Obsolete first-pass results do not commit.

### Subscription-driven cancellation

Test:

- Releasing final subscription aborts scheduler-owned in-flight work.
- Releasing one of two subscriptions does not abort shared work.
- Releasing one target does not abort an ancestor still required by another target.
- Cancellation is not stored as node or scheduler business error.
- Explicit execution is not cancelled solely by unsubscribe.
- Runtime settles after cancellation.

### Context invalidation

Test:

- Subscribed stale descendants reload automatically after context change.
- The new loader sees the new context value.
- Unsubscribed stale descendants do not load.
- Unrelated subscribed branches are not restarted.
- Equal context value does not schedule work.

### Scheduler failures

Test:

- Automatic execution failure is stored in scheduler state.
- Failure does not produce an unhandled rejection.
- Runtime settles after failure.
- Failed subscribed node does not immediately retry in a loop.
- Independent branch success is preserved.
- New context change retries subscribed stale work.
- New node subscription retries subscribed stale work.
- Successful retry clears scheduler and node errors.

### Settlement

Test:

- `whenSettled` resolves immediately when idle.
- It waits for a queued flush.
- It waits for active execution.
- It waits for one required follow-up flush.
- Multiple waiters resolve together.
- It resolves after failure.
- It resolves after subscription-driven cancellation.

### Observation

Test:

- Scheduler state is observable after committed changes.
- Returned scheduler state is read-only.
- Throwing listeners do not break scheduling or other listeners.
- Scheduler does not recursively schedule because of its own notifications.
- Notification volume is deterministic enough for behaviour tests without asserting incidental internal transitions.

Prefer assertions on observed state progression over exact listener call counts unless the count is part of the documented contract.

### Explicit execution compatibility

Test:

- Existing explicit execution tests continue to pass.
- Explicit and scheduler execution share one node attempt.
- Explicit execution does not add subscription.
- A fresh result from explicit execution prevents unnecessary automatic reload.
- Explicit failures still reject the caller independently of scheduler error state.

### Type tests

Add compile-time checks for:

- `getSchedulerState` returns read-only booleans and `Error | null`.
- `whenSettled` returns `Promise<void>`.
- Existing subscription and execution typing remains intact.
- Scheduler public APIs require no `any`.

Use ordinary TypeScript test files with intentional `@ts-expect-error` assertions. Do not add a new type-test dependency.

## Documentation updates

Update only documentation affected by Step 3B.

At minimum:

- Update `docs/architecture/03-scheduler-transactions-and-concurrency.md` with implemented scheduling, coalescing, follow-up, failure, and cancellation semantics.
- Update `docs/architecture/05-mutations-failures-and-cache.md` with scheduler failure and retry-trigger behaviour.
- Update `docs/api/01-proposed-api.md` with automatic loading, scheduler state, and settlement APIs.
- Update `docs/implementation/01-roadmap.md`:
  - Mark generated Step 3B work as prepared.
  - Leave offline validation pending.
  - Keep Step 3C incomplete.
- Add `docs/implementation/09-automatic-scheduler-implementation-note.md` containing:
  - Status
  - Files changed
  - Schedule triggers
  - Coalescing semantics
  - Follow-up flush semantics
  - Cancellation ownership
  - Scheduler error model
  - Settlement semantics
  - Static checks performed
  - Offline validation commands
  - Known risks and questions for Step 3C
- Store this prompt as `docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md`.

Add or update an ADR only if implementation materially changes an accepted architecture decision.

## Out of scope

Do not implement:

- Prefetch
- Manual refresh
- Vue plugin
- `useNode`
- `useNodes`
- Vue scope cleanup
- Query groups
- Transactions
- Domain events
- Polling
- Stale-time policies
- Retry counts or delays
- Backoff or jitter
- Optimistic mutations
- Metrics
- Snapshot export
- Devtools visualisation
- Cache garbage collection
- Configurable concurrency limits

Step 3B completes normal automatic loading from persistent node subscriptions. Step 3C will add temporary prefetch subscription ownership and explicit manual refresh.

## Quality requirements

- Reuse the existing execution engine.
- Keep the scheduler runtime-owned and framework agnostic.
- Keep `src/core` independent of Vue, Pinia, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Avoid console logging in core source.
- Avoid global state.
- Avoid unhandled promise rejections.
- Avoid fixed real-time delays in tests.
- Avoid fixed microtask-count assumptions in tests.
- Recalculate current subscription and state at flush time.
- Do not automatically retry failures without a new external trigger.
- Do not cancel explicit caller-owned work solely because the final subscriber unsubscribes.
- Keep changes within Step 3B.

## Static inspection in the contained environment

Perform checks that do not require installed project dependencies:

- List changed and added files.
- Parse JSON configuration files.
- Inspect public exports.
- Confirm no workspace files or nested package manifests were introduced.
- Run the dependency-free core boundary check if available.
- Search `src/core` for Vue, Pinia, devtools, and playground imports.
- Search implementation and tests for explicit `any` usage.
- Confirm TypeScript suppression comments exist only in intentional type tests.
- Search core source for console logging.
- Confirm no prefetch, manual refresh, transaction, event, polling, mutation, metric, snapshot, or Vue integration was introduced.
- Confirm scheduler code delegates to the existing execution engine.
- Confirm node subscription creation does not directly invoke loaders synchronously.
- Confirm no automatic retry loop is structurally possible after failure.
- Confirm scheduler-owned cancellation does not indiscriminately abort explicit work.
- Confirm mutable scheduler state was not added to node definitions.
- Confirm all required test categories are represented.
- Confirm documentation marks Step 3B validation as pending.
- Create a ZIP containing only files added or changed for Step 3B.
- Validate ZIP integrity and contents before responding.

These checks are not proof that TypeScript, Vitest, or the build passes.

## Offline validation for the developer

Ask the developer to apply the Step 3B ZIP and run from the repository root:

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

If tests fail, capture output with:

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

The contained-environment changes are ready for offline validation when:

- Adding non-empty subscription queues one automatic scheduler microtask.
- Synchronous schedule requests coalesce.
- Loaders are not invoked synchronously by node subscription.
- Current subscription and state are recalculated at flush time.
- Subscribed data and derived targets load automatically.
- Required ancestors use the existing execution engine.
- Unsubscribed nodes do not load.
- Active scheduler flushes do not overlap.
- Changes during an active flush produce at most one follow-up flush.
- Context changes automatically reload subscribed stale descendants.
- Final unsubscribe cancels scheduler-owned unnecessary work.
- Shared subscribed work remains active.
- Explicit caller-owned work is not cancelled solely by unsubscribe.
- Automatic failures are captured without unhandled rejections or retry loops.
- `whenSettled` reliably represents scheduler quiescence.
- Scheduler state is typed and read-only.
- Existing explicit execution and subscription tests remain represented.
- Required scheduler behavioural and type tests are present.
- Public exports are intentional.
- Core remains independent of Vue and other logical layers.
- Documentation marks validation pending.
- A validated ZIP containing only Step 3B changes is returned.
- Step 3C and later behaviour is not implemented.

## Validated acceptance criteria

Step 3B is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Automatic execution, coalescing, follow-up, cancellation, failure, settlement, observation, and compatibility tests pass.
- All scheduler type tests pass.
- No unhandled promise rejections occur.
- No automatic retry loop occurs.
- Any reported issues have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of the automatic scheduler prepared.
2. A ZIP containing only Step 3B files added or changed.
3. Files added, changed, and removed.
4. The final public scheduler API.
5. Scheduling, coalescing, follow-up, cancellation, failure, and settlement decisions.
6. Static checks performed and their results.
7. Project commands not run in the contained environment.
8. Exact offline validation steps.
9. Assumptions, deviations, known limitations, and risks for Step 3C.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
