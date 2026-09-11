# Implementation Prompt 006: Implement Prefetch and Manual Refresh

## Role

You are implementing Step 3C of Milestone 3 for `vue-dependency-graph`: one-shot prefetch and explicit manual refresh.

The repository is a single private pnpm package with logical layers under `src`. All framework implementation in this step belongs in `src/core`.

The validated baseline now includes:

- Immutable typed node definitions
- Order-independent validated graph topology
- Separate runtime state
- Explicit dependency-aware execution
- Context invalidation
- Per-attempt cancellation
- Generation-based obsolete-result protection
- In-flight deduplication
- Branch-scoped failure handling
- Runtime change observation through `onChange(...)`
- Reference-counted node subscriptions
- Direct, required, and total subscription accounting
- Idempotent `NodeSubscription.unsubscribe()`
- Automatic microtask scheduling for subscribed nodes
- Coalesced scheduler flushes
- Active-flush follow-up handling
- Subscription-driven cancellation ownership
- Scheduler failure inspection
- `whenSettled()` for scheduler quiescence

All previous validation has passed offline. Build on the existing runtime, scheduler, and execution engine. Do not create a second execution path.

Use the finalized subscription terminology consistently:

- `subscribeNodes(...)` creates persistent consumer lifecycle ownership.
- `getSubscriptionState(...)` inspects subscription counts.
- `hasSubscribers(...)` indicates whether a node has active subscribers.
- `NodeSubscription.unsubscribe()` releases one consumer's ownership.
- `onChange(...)` observes committed runtime changes.

Implement only:

- One-shot prefetch for nodes without creating persistent subscriptions
- Manual refresh for data and derived nodes
- Typed prefetch and refresh APIs
- Prefetch and refresh interaction with the existing executor and scheduler
- In-flight deduplication across explicit execution, scheduler execution, prefetch, and refresh
- Generation and cancellation behavior required for refresh correctness
- Error behavior for prefetch and refresh
- Focused runtime inspection and tests needed to validate these operations

Do not implement:

- Vue composables
- Vue scope disposal
- Query groups
- Multi-context transactions
- Domain events
- Polling
- Stale-time policies
- Retry or backoff policies
- Refresh intervals
- Browser focus or reconnect refresh
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
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/07-runtime-execution-implementation-note.md`
- `docs/implementation/08-node-subscription-implementation-note.md`
- `docs/implementation/09-automatic-scheduler-implementation-note.md`
- `docs/testing/01-test-strategy.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Also review the original execution and subscription services if available. Preserve useful one-shot loading and refresh behavior, but do not copy manual string-based loading, Vue watchers, component callbacks, or separate execution orchestration into the core.

If the repository differs from these documents, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not install dependencies, run pnpm commands, execute Vitest, run TypeScript builds, or start Vite.

Your responsibilities are to:

1. Create or update the required source, test, and documentation files.
2. Perform static inspection that does not require installed dependencies.
3. Check exports, import boundaries, execution reuse, operation ownership, and obvious asynchronous-state issues.
4. Return a ZIP containing only files added or changed for Step 3C.
5. Provide exact offline validation commands.
6. Report project command results as `Not run in contained environment`.

The developer will apply the ZIP, run the project offline, and return errors or observations. Do not claim that type checking, tests, builds, or runtime validation succeeded.

## Objective

Provide two explicit one-shot operations with distinct behavior:

```ts
await runtime.prefetch([Targets]);
await runtime.refresh([Targets]);
```

### Prefetch

Prefetch means:

> Ensure these nodes have successful fresh values once, without creating persistent subscriber ownership.

### Manual refresh

Manual refresh means:

> Force these data or derived nodes to execute again now, even when their current values are successful and fresh.

Neither operation should require a node subscription.

## Core design constraints

### 1. One execution engine

Both operations must delegate to the existing dependency-aware executor.

Do not duplicate:

- Ancestor collection
- Dependency ordering
- Loader invocation
- Derived evaluation
- Independent concurrency
- Branch-scoped failure handling
- In-flight deduplication
- Generation checks
- Obsolete-result protection

A reasonable internal direction is:

```ts
executeInternal(targets, origin);
```

where operation ownership is tracked internally.

Do not create separate prefetch or refresh executors.

### 2. Public API

Add APIs close to:

```ts
interface GraphRuntime {
  readonly prefetch: (
    nodes: readonly AnyNodeDefinition[]
  ) => Promise<void>;

  readonly refresh: (
    nodes: readonly RefreshableNodeDefinition[]
  ) => Promise<void>;
}
```

The exact refreshable-node type may be named differently, but it must include data and derived node definitions and exclude context nodes at compile time.

Both methods should support readonly arrays and tuples.

Do not add string-based overloads.

### 3. Prefetch semantics

`prefetch(nodes)` must:

- Validate all requested nodes before changing runtime state.
- Include required ancestors through the existing executor.
- Execute nodes that do not already have successful fresh values.
- Skip successful fresh nodes.
- Avoid executing unrelated nodes.
- Avoid creating direct or required subscription counts.
- Avoid changing `hasSubscribers(...)` results.
- Resolve after the requested graph branches settle successfully.
- Reject with the existing `GraphExecutionError` contract on execution failure.
- Preserve per-node runtime errors and partial independent-branch success.
- Share in-flight attempts with scheduler and explicit execution where generations match.
- Work without any active node subscription.

Prefetch is one-shot caller-owned work. It must not remain active after its returned promise settles.

### 4. Prefetch does not create a hidden persistent subscription

Do not implement prefetch by calling `subscribeNodes(...)` and leaving a registration active.

A temporary internal ownership marker is acceptable, but it must:

- Not affect public subscription counts.
- Be cleaned up after success, failure, or cancellation.
- Not cause later context changes to reload the prefetched node automatically.
- Not keep polling or other future refresh policies active.

Prefer direct reuse of the explicit execution path if it already provides the required one-shot ownership semantics.

### 5. Prefetch and scheduler interaction

Required behavior:

- Prefetch and automatic scheduling share the same node attempt when they target the same generation.
- Unsubscribing the final subscriber must not cancel an attempt still owned by a prefetch caller.
- Prefetch failure rejects the prefetch caller.
- Prefetch failure must not populate `SchedulerState.error` unless the scheduler independently owned the same failing orchestration.
- Successful prefetch satisfies later subscriptions while the node remains fresh.
- A later subscription for a successfully prefetched fresh node must not reload it.

Do not create subscription counts merely to protect prefetch work from unsubscribe cancellation. Use operation ownership.

### 6. Manual refresh semantics

`refresh(nodes)` must force requested data and derived nodes to execute again even when they are currently successful and fresh.

For each requested node:

1. Validate that it is registered.
2. Validate that it is refreshable.
3. Mark the requested node stale.
4. Increment its generation when a new refresh attempt is required.
5. Preserve its current data.
6. Clear its previous error when the new attempt starts through the existing state machine.
7. Execute it through the existing dependency-aware executor.
8. Resolve after all executable requested branches succeed.
9. Reject with `GraphExecutionError` after branch-scoped failures settle.

Do not automatically mark ancestors stale. Refreshing a node means recomputing or reloading that node using the current successful fresh values of its dependencies.

### 7. Refreshing data nodes

Refreshing a data node must invoke its loader again.

If it has a previous successful value:

- Preserve that value while refreshing.
- Use `refreshing` status during execution.
- Store the new value on success.
- Retain the previous successful value on refresh failure.
- Leave the node stale with its error on failure.

If it has never succeeded:

- Manual refresh behaves as an initial load.
- Use `loading` status during execution.

### 8. Refreshing derived nodes

Refreshing a derived node must recompute it synchronously after its dependencies are available.

Required behavior:

- Do not reload successful fresh data ancestors merely because a derived node is refreshed.
- Re-run the derive function once for the requested refresh generation.
- Preserve the previous derived value while refreshing when one exists.
- Handle thrown values through the existing error normalization and execution failure model.

### 9. Context nodes are not refreshable

Context nodes already represent current runtime inputs and have no loader or derive function.

`refresh([ContextNode])` must fail at compile time.

Do not create a runtime context-refresh behavior.

If an untyped or externally constructed value reaches runtime validation, reject it with a clear error identifying the node key and explaining that context nodes cannot be refreshed.

### 10. Descendant invalidation after refresh success

When a refreshed node commits a new value, its transitive descendants may now be stale.

Implement this behavior carefully:

- If the refreshed result is `Object.is` equal to the previous successful value, descendants do not need invalidation.
- If the refreshed result differs, mark transitive descendants stale and increment each descendant generation once.
- Preserve descendant data.
- Abort obsolete descendant attempts where appropriate.
- If any affected descendant remains directly subscribed or required by a subscription, request one scheduler follow-up pass.
- Do not re-execute unrelated subscribed branches.

Avoid invalidating the refreshed node itself again after success.

If the existing runtime does not yet compare committed values for descendant invalidation, add the smallest cohesive helper shared by context updates and refresh-result propagation where practical. Do not broadly refactor unrelated execution code.

### 11. Refresh while an attempt is active

Manual refresh must have deterministic in-flight behavior.

Recommended rule:

- If the same node generation is already executing because of scheduler, explicit execution, or prefetch, `refresh` must force one newer generation rather than silently treating the active attempt as the requested refresh.
- Abort the obsolete attempt where possible.
- Start or join the new refresh generation.
- Prevent the old result from committing even when its loader ignores abort.

Multiple refresh calls made while that new refresh generation is already active should share that refresh attempt rather than repeatedly incrementing generations and causing an endless supersession chain.

Use the simplest internal marker needed to distinguish:

- Existing normal execution
- A refresh generation already created for the active manual refresh operation

Do not expose this marker publicly.

### 12. Overlapping refresh calls

Required behavior:

```ts
const first = runtime.refresh([Targets]);
const second = runtime.refresh([Targets]);
await Promise.all([first, second]);
```

The loader should run once for the newly requested refresh generation when both calls overlap before that refresh settles.

After the refresh settles, a later new refresh call must run the loader again.

Do not rely on arbitrary timing. Tests should use deferred promises and observable state.

### 13. Multiple refresh targets

`refresh([A, B])` must:

- Validate the complete target list before invalidating anything.
- Deduplicate repeated target keys.
- Increment each target generation at most once for that refresh operation.
- Execute independent targets concurrently through the existing executor.
- Share ancestors and active attempts where appropriate.
- Preserve branch-scoped failure behavior.

If one requested target is an ancestor of another requested target, avoid double invalidation and duplicate attempts.

### 14. Refresh and scheduler interaction

Manual refresh is caller-owned one-shot work.

Required behavior:

- It works with or without subscribers.
- If the refreshed node is subscribed, do not start a duplicate scheduler attempt for the same refresh generation.
- Scheduler and refresh ownership may share one active attempt.
- Final unsubscribe must not cancel an active caller-owned refresh.
- Context changes may still supersede the refresh when dependencies change.
- Refresh failure rejects the caller and does not populate scheduler error unless scheduler orchestration independently fails.
- `whenSettled()` continues to represent scheduler quiescence only. It does not replace awaiting the returned refresh promise.

Document this distinction clearly.

### 15. Manual refresh and scheduler error recovery

A manual refresh is an explicit recovery action.

At the start of a refresh affecting a node represented in the current scheduler failure:

- Do not require a new subscription or context change.
- Execute the requested node directly.
- On success, clear the node error through the existing state machine.

Do not automatically clear an unrelated `SchedulerState.error` merely because a manual refresh started. Scheduler error represents the most recent automatic orchestration outcome.

A future diagnostics milestone may provide richer error history. Do not introduce it now.

### 16. Error behavior

Both `prefetch` and `refresh` return caller-observable promises.

They must:

- Resolve on complete success.
- Reject with the existing `GraphExecutionError` after independent executable branches settle.
- Preserve direct failure and blocked-node records.
- Avoid unhandled promise rejections when the caller properly awaits or handles the returned promise.
- Normalize non-`Error` throws through the existing helper.
- Not convert caller-visible failures into scheduler-only state.

Do not create new prefetch-specific or refresh-specific aggregate error classes unless a concrete gap in `GraphExecutionError` makes it necessary.

### 17. Cancellation ownership

Extend operation ownership only as much as required.

A reasonable internal concept is:

```ts
type ExecutionOrigin =
  | "explicit"
  | "scheduler"
  | "prefetch"
  | "refresh";
```

Alternatively, prefetch may use explicit ownership if behavior remains correct and understandable.

Required ownership rules:

- Final unsubscribe may cancel scheduler-only work.
- It must not cancel work still owned by explicit execution, prefetch, or refresh.
- Context invalidation may abort any affected obsolete generation regardless of origin.
- Shared attempts remain active while at least one valid owner requires them.

Keep ownership private.

### 18. Runtime observation

Use the existing `onChange(...)` mechanism.

Observers should see committed node-state changes caused by prefetch and refresh through the existing notifications.

Do not add separate prefetch or refresh callback channels.

Do not expose mutable operation maps or promises.

### 19. Scheduler settlement remains narrow

Do not broaden `whenSettled()` to await arbitrary caller-owned operations.

Required distinction:

```ts
await runtime.whenSettled(); // automatic scheduler only
await runtime.prefetch([Targets]); // this prefetch operation
await runtime.refresh([Targets]); // this refresh operation
```

If prefetch or refresh shares an attempt with the scheduler, each promise should still settle correctly according to the shared attempt.

### 20. Empty operations

Choose and document simple behavior:

```ts
await runtime.prefetch([]);
await runtime.refresh([]);
```

Recommended behavior:

- Resolve immediately.
- Do not notify listeners.
- Do not change scheduler state.
- Do not alter generations or node state.

### 21. Registered nodes only

Validation must use key-based graph identity consistently.

For prefetch and refresh:

- Resolve equivalent handles to registered definitions by key.
- Reject the complete operation synchronously or through the returned rejected promise before applying partial state.
- Include the missing key in the error message.

Prefer returning a rejected promise from async public APIs rather than throwing after partial asynchronous work begins. The important requirement is atomic validation before state mutation.

### 22. Public typing

Add or export the narrow refreshable-node type if useful:

```ts
type RefreshableNodeDefinition =
  | DataNodeDefinition<unknown, readonly AnyNodeDefinition[]>
  | DerivedNodeDefinition<unknown, readonly AnyNodeDefinition[]>;
```

Preserve useful generic typing where possible. Do not expose mutable internal state.

Type tests must confirm:

- Context, data, and derived nodes are accepted by `prefetch`.
- Data and derived nodes are accepted by `refresh`.
- Context nodes are rejected by `refresh`.
- Readonly tuples are accepted.
- String keys are rejected.
- Both methods return `Promise<void>`.
- No public operation requires `any`.

## Suggested source organization

Keep changes small and cohesive.

A reasonable structure is:

```text
src/core/
├── execution.ts
├── graph.ts
├── index.ts
├── nodes.ts
├── operations.ts
├── runtime.ts
├── scheduler.ts
├── subscription.ts
└── types.ts
```

`operations.ts` is optional. Use it only if public operation types or small helpers would otherwise clutter `runtime.ts`.

Do not create prefetch-manager or refresh-manager classes unless clearly necessary.

Suggested tests:

```text
tests/core/
├── prefetch.spec.ts
├── prefetch-interaction.spec.ts
├── refresh.spec.ts
├── refresh-descendants.spec.ts
├── refresh-interaction.spec.ts
├── refresh-failure.spec.ts
└── operation-types.test.ts
```

Retain all existing tests. Continue using deferred promises and `waitForCondition`. Avoid real-time delays and fixed microtask-count assumptions.

## Tests

Use Vitest 3.0.7 and TypeScript.

### Prefetch

Test:

- Prefetch loads a data node without subscribers.
- Prefetch loads required ancestors for a derived target.
- Prefetch skips successful fresh nodes.
- Prefetch avoids unrelated nodes.
- Prefetch does not change subscription counts.
- Prefetch accepts equivalent handles by registered key.
- Empty prefetch resolves without changes.
- Missing target validation applies no partial work.

### Prefetch interaction

Test:

- Prefetch and scheduler share one loader invocation.
- Prefetch and explicit execution share one loader invocation.
- Final unsubscribe does not cancel caller-owned prefetch.
- Successful prefetch prevents unnecessary load on later subscription.
- Failed prefetch rejects the caller.
- Failed prefetch does not populate scheduler error when the scheduler did not own it.

### Manual refresh

Test:

- Refresh reloads a successful fresh data node.
- Refresh recomputes a successful fresh derived node.
- Refresh works without subscribers.
- Refresh preserves data while status is `refreshing`.
- Refresh of a never-successful node uses initial-load behavior.
- Refresh does not reload fresh ancestors unnecessarily.
- Empty refresh resolves without changes.
- Duplicate refresh targets are deduplicated.
- Complete validation occurs before generation changes.

### Refresh descendants

Test:

- Changed refresh result marks direct descendants stale.
- Changed refresh result marks transitive descendants stale.
- Each descendant generation increments once.
- Descendant data is preserved.
- Equal refresh result does not invalidate descendants.
- Subscribed stale descendants schedule one follow-up pass.
- Unsubscribed stale descendants do not execute.
- Unrelated subscribed branches are not restarted.

### Refresh interaction and races

Test:

- Refresh supersedes an active normal execution generation.
- Old result cannot commit even if the loader ignores abort.
- Overlapping refresh calls share one refresh attempt.
- A later refresh after settlement runs again.
- Final unsubscribe does not cancel caller-owned refresh.
- Context change can supersede an affected refresh.
- Refresh and scheduler do not duplicate the same generation attempt.
- Multiple independent targets refresh concurrently.

### Refresh failures

Test:

- Refresh failure rejects with `GraphExecutionError`.
- Previous successful data is retained.
- Node remains stale with its error.
- Independent refresh branch can succeed.
- Derived refresh throw is normalized.
- Later successful refresh clears the node error.
- Refresh failure does not overwrite unrelated scheduler error state.

### Observation

Test:

- Existing `onChange(...)` listeners observe prefetch state changes.
- Existing listeners observe refresh state changes.
- Listener failures remain isolated.
- Empty operations do not notify.
- Obsolete discarded results do not notify.

### Existing behavior

Confirm existing tests continue to cover:

- Explicit execution
- Node subscriptions
- Automatic scheduler
- Scheduler settlement
- Subscription-driven cancellation
- Branch-scoped failures
- Context invalidation

Do not weaken existing tests to accommodate the new APIs.

## Documentation updates

Update only documentation affected by Step 3C.

At minimum:

- Update `docs/architecture/03-scheduler-transactions-and-concurrency.md` with prefetch, refresh, operation ownership, and settlement distinctions.
- Update `docs/architecture/04-events-refresh-and-polling.md` to distinguish implemented manual refresh from future policy-driven refresh and polling.
- Update `docs/architecture/05-mutations-failures-and-cache.md` with prefetch and refresh failure semantics.
- Update `docs/api/01-proposed-api.md` with implemented `prefetch(...)` and `refresh(...)` APIs.
- Update `docs/implementation/01-roadmap.md`:
  - Mark Step 3B validated offline based on the developer's report.
  - Mark generated Step 3C work as prepared.
  - Leave Step 3C offline validation pending.
  - Do not mark Milestone 4 or later work complete.
- Add `docs/implementation/10-prefetch-and-refresh-implementation-note.md` containing:
  - Status
  - Files changed
  - Prefetch semantics
  - Refresh semantics
  - Descendant invalidation behavior
  - Operation ownership
  - Scheduler interaction
  - Failure behavior
  - Static checks performed
  - Offline validation commands
  - Known risks and questions for Milestone 4
- Store this prompt as `docs/implementation/prompts/006-implement-prefetch-and-manual-refresh.md`.

Add or update an ADR only if implementation materially changes an accepted architecture decision.

## Out of scope

Do not implement:

- Vue plugin
- `useNode`
- `useNodes`
- Vue scope cleanup
- Query groups
- Transactions
- Domain events
- Polling
- Fixed-interval refresh
- Stale-time refresh
- Focus refresh
- Reconnect refresh
- Retry counts or delays
- Backoff or jitter
- Optimistic mutations
- Metrics
- Snapshot export
- Devtools visualization
- Cache garbage collection
- Configurable concurrency limits

Step 3C completes Milestone 3's core one-shot loading controls. Policy-driven refresh remains a later milestone.

## Quality requirements

- Reuse the existing execution engine and scheduler primitives.
- Keep operations runtime-owned and framework agnostic.
- Keep `src/core` independent of Vue, Pinia, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Avoid console logging in core source.
- Avoid global state.
- Avoid unhandled promise rejections.
- Avoid fixed real-time delays in tests.
- Avoid fixed microtask-count assumptions in tests.
- Validate complete target lists before state mutation.
- Preserve branch-scoped failures.
- Preserve explicit, scheduler, prefetch, and refresh ownership correctly.
- Do not turn prefetch into a hidden persistent subscription.
- Do not broaden `whenSettled()` beyond scheduler work.
- Keep changes within Step 3C.

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
- Confirm no transaction, event, polling, retry policy, mutation, metric, snapshot, or Vue integration was introduced.
- Confirm prefetch and refresh delegate to the existing execution engine.
- Confirm prefetch does not call `subscribeNodes(...)` or change subscription counts.
- Confirm refresh rejects context nodes through typing and runtime validation.
- Confirm `whenSettled()` remains scheduler-only.
- Confirm operation ownership prevents final unsubscribe from cancelling caller-owned work.
- Confirm mutable operation state was not added to node definitions.
- Confirm all required test categories are represented.
- Confirm documentation marks Step 3C validation as pending.
- Create a ZIP containing only files added or changed for Step 3C.
- Validate ZIP integrity and contents before responding.

These checks are not proof that TypeScript, Vitest, or the build passes.

## Offline validation for the developer

Ask the developer to apply the Step 3C ZIP and run from the repository root:

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

- Prefetch loads requested stale or never-successful nodes without subscribers.
- Prefetch skips successful fresh nodes.
- Prefetch does not alter subscription counts.
- Prefetch shares existing attempts and is protected from final-unsubscribe cancellation.
- Manual refresh forces registered data and derived nodes to execute again.
- Context nodes are rejected by refresh typing and runtime validation.
- Refresh preserves previous successful values while running and after failure.
- Changed refresh results invalidate transitive descendants once.
- Equal refresh results do not invalidate descendants.
- Subscribed stale descendants receive one scheduler follow-up.
- Overlapping refresh calls share one refresh generation.
- Later refresh calls execute again.
- Old generations cannot commit after refresh supersession.
- Caller-owned operation failures reject through `GraphExecutionError`.
- Scheduler error behavior remains separate.
- `whenSettled()` remains scheduler-only.
- Existing explicit execution, subscription, and scheduler behavior remains represented.
- Required behavioral and type tests are present.
- Public exports are intentional.
- Core remains independent of Vue and other logical layers.
- Documentation marks Step 3C validation pending.
- A validated ZIP containing only Step 3C changes is returned.
- Milestone 4 and later behavior is not implemented.

## Validated acceptance criteria

Step 3C is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Prefetch, refresh, descendant invalidation, ownership, race, failure, observation, and typing tests pass.
- Existing scheduler and execution tests continue to pass.
- No unhandled promise rejections occur.
- Any reported issues have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of prefetch and manual refresh prepared.
2. A ZIP containing only Step 3C files added or changed.
3. Files added, changed, and removed.
4. The final public operation APIs.
5. Prefetch, refresh, invalidation, ownership, scheduler interaction, failure, and settlement decisions.
6. Static checks performed and their results.
7. Project commands not run in the contained environment.
8. Exact offline validation steps.
9. Assumptions, deviations, known limitations, and risks for Milestone 4.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
