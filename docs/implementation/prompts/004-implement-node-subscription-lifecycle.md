> This prompt supersedes the earlier subscription terminology. The implemented lifecycle is now exposed as node subscriptions.

# Implementation Prompt 004: Implement Subscription Registration and Lifecycle

## Role

You are implementing Step 3A of Milestone 3 for `vue-dependency-graph`: framework-agnostic node subscription and lifecycle management.

The repository is a single private pnpm package with logical layers under `src`. All framework implementation in this step belongs in `src/core`.

Milestone 2 established:

- Immutable graph definitions
- Validated graph topology
- Separate runtime state
- Typed context updates
- Explicit dependency-aware execution
- Branch-scoped failures
- Per-attempt cancellation and generation protection
- In-flight deduplication
- Runtime observation

Build on that foundation without duplicating or replacing the existing execution engine.

Implement only:

- Direct node subscription for node handles
- Reference-counted subscription ownership
- Transitive dependency subscription accounting
- Idempotent unsubscribe
- Subscription inspection
- Subscription-change observation through the existing runtime subscription mechanism
- Lifecycle behaviour needed by the later automatic scheduler

Do not implement:

- Automatic execution when a node subscription is added
- Microtask scheduling
- Execution coalescing
- Prefetch
- Manual refresh
- Vue composables or scope disposal
- Transactions
- Domain events
- Polling
- Retry policies
- Query groups
- Mutations
- Metrics
- Snapshots
- Devtools UI

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-proposed-api.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/07-runtime-execution-implementation-note.md`
- `docs/testing/01-test-strategy.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Also read the existing subscription services supplied as reference material if available. Preserve useful lifecycle ideas such as explicit release and idempotent cleanup, but do not copy Vue watchers, effect scopes, callbacks tied to loaded status, string-only node selection, or automatic execution into this step.

If the repository differs from these documents, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not install dependencies, run pnpm commands, execute Vitest, run TypeScript builds, or start Vite.

Your responsibilities are to:

1. Create or update the required source, test, and documentation files.
2. Perform static inspection that does not require installed dependencies.
3. Check exports, import boundaries, subscription accounting, and obvious type-design issues.
4. Return a ZIP containing only files added or changed for Step 3A.
5. Provide exact offline validation commands.
6. Report project command results as `Not run in contained environment`.

The developer will apply the ZIP, run the project offline, and return errors or observations. Do not claim that type checking, tests, builds, or runtime validation succeeded.

## Objective

Allow consumers to declare that one or more graph nodes are currently required while keeping subscription separate from execution.

The intended API should be close to:

```ts
const subscription = runtime.subscribeNodes([Targets, Credits]);

runtime.hasSubscribers(Targets);
runtime.getSubscriptionCount(Targets);
runtime.getDirectSubscriptionCount(Targets);

// No automatic execution in Step 3A.

subscription.unsubscribe();
```

The returned node subscription represents one consumer's ownership. Releasing it removes only that subscription's contribution.

Step 3B will observe subscription and automatically invoke the existing execution engine for subscribed stale nodes.

## Core design constraints

### 1. Subscription belongs to the runtime

Subscription state must be stored in each `GraphRuntime`, not in immutable node definitions or the validated graph.

Two runtimes created from the same graph must have independent subscription counts.

Do not introduce global subscription state.

### 2. Direct and required subscription

Distinguish these concepts:

- **Direct subscription**: a consumer explicitly requested the node.
- **Required subscription**: the node is required because one or more directly subscribed descendants depend on it.
- **Total subscription count**: direct subscription plus required subscription.

Example:

```text
Context -> Parent -> Child
```

Adding subscription for `Child` contributes:

```text
Child:   direct 1, required 0, total 1
Parent:  direct 0, required 1, total 1
Context: direct 0, required 1, total 1
```

If another consumer directly subscriptions `Parent`, the counts become:

```text
Parent: direct 1, required 1, total 2
```

Keep direct and required counts separately so later scheduler and diagnostics behaviour is explainable.

### 3. One dependency contribution per subscription

One node subscription contributes at most one required count to each transitive ancestor, even in a diamond graph.

Example:

```text
      Root
      /  \
   Left  Right
      \  /
      Leaf
```

One subscription for `Leaf` contributes one required subscription to `Root`, not two.

Use a visited set while collecting ancestors for each subscription.

### 4. Multiple targets in one subscription

One subscription may directly subscription multiple targets:

```ts
const subscription = runtime.subscribeNodes([Targets, Credits]);
```

Rules:

- Duplicate target keys in the same subscription must be deduplicated.
- Shared ancestors receive one required contribution from that subscription.
- A node directly included as a target must not also receive a required contribution from the same subscription merely because another target depends on it.
- Separate subscriptions contribute separately.

Example:

```ts
runtime.subscribeNodes([Parent, Child]);
```

For that subscription:

```text
Parent: direct 1, required 0
Child:  direct 1, required 0
```

Ancestors above `Parent` receive one required contribution.

Document this subscription-level set semantics clearly.

### 5. Subscription handle

Return a small subscription handle, such as:

```ts
interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly release: () => void;
}
```

Requirements:

- `nodes` contains the deduplicated directly subscribed node definitions.
- `nodes` is read-only and cannot mutate internal subscription state.
- `release` removes exactly that subscription's contribution.
- `release` is idempotent.
- Releasing one subscription does not affect another.
- A released subscription cannot be reactivated.

Do not expose mutable counter records on the handle.

### 6. Empty node subscription

Choose and document one simple behaviour for:

```ts
runtime.subscribeNodes([]);
```

Recommended behaviour:

- Return a valid no-op subscription.
- Do not notify listeners.
- `release` remains safe and idempotent.

Do not throw for an empty list unless the existing API conventions strongly favour validation errors.

### 7. Registered nodes only

Every target passed to `subscribeNodes` must be registered in the runtime's graph.

If a node key is not registered:

- Reject the complete subscription synchronously.
- Do not apply partial subscription.
- Include the missing key in the error message.

If a different node definition object has the same registered key, resolve subscription through the graph's registered definition, consistent with key-based graph identity.

A dedicated error type is optional. Prefer a clear existing runtime error style unless a small `NodeSubscriptionError` materially improves tests and future diagnostics.

### 8. Subscription counters

Counters must:

- Start at zero.
- Never become negative.
- Change atomically per subscription subscribe or unsubscribe.
- Be internally mutable but externally read-only.
- Exist for every node, including nodes with zero subscription.

Suggested public inspection:

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

runtime.getSubscriptionState(node);
runtime.getDirectSubscriptionCount(node);
runtime.getSubscriptionCount(node);
runtime.hasSubscribers(node);
```

You do not need every convenience method if one small coherent API is sufficient. At minimum, future scheduler code must be able to determine total subscription count efficiently, and tests must be able to distinguish direct from required subscription.

Recommended minimal public surface:

```ts
runtime.subscribeNodes(nodes);
runtime.getSubscriptionState(node);
runtime.hasSubscribers(node);
```

Where:

```ts
hasSubscribers(node) === runtime.getSubscriptionState(node).total > 0
```

Avoid redundant APIs unless they improve consumer clarity.

### 9. Subscription does not execute

This is a strict Step 3A boundary.

Adding subscription must not:

- Invoke a data loader
- Evaluate a derived node
- Call `runtime.execute`
- Change node status
- Change freshness
- Create an abort controller
- Schedule a microtask

Releasing subscription must not cancel active execution in Step 3A. Cancellation based on disappearing subscription belongs to Step 3B, where scheduler ownership is defined.

Add explicit tests proving that node subscription alone does not execute nodes.

### 10. Subscription does not affect runtime values

Adding or releasing subscription must not change:

- Node data
- Status
- Freshness
- Error
- Generation
- Successful-value state

Subscription is lifecycle metadata only.

### 11. Subscription observation

Use the existing graph-level runtime subscription mechanism.

Notify listeners:

- Once after a non-empty subscription is successfully applied.
- Once after an active non-empty subscription is released.

Do not notify:

- For an empty subscription.
- For duplicate nodes removed within one subscription beyond the single effective change.
- For a second or later call to the same subscription's `release`.
- When subscription validation fails before application.

Listeners can inspect subscription through public runtime methods after notification.

Do not add a separate callback parameter to `subscribeNodes`.

### 12. Listener isolation

Retain Milestone 2 behaviour:

- One listener throwing must not prevent other listeners from running.
- Listener errors must not roll back committed subscription state.
- Do not log listener failures from the core.

### 13. Runtime construction

Initialise subscription counters for all graph nodes when the runtime is created.

Do not lazily create missing records in a way that could hide unregistered-node errors.

### 14. Complexity and indexing

Use the validated graph's parent inspection to collect required ancestors.

Avoid scanning all graph nodes for every subscription update. Registration complexity should be proportional to the targets and their ancestors.

Do not add a separate global dependency graph or duplicate topology indexes in the runtime.

### 15. Interaction with context nodes

Context nodes can be directly subscribed and can receive required subscription as ancestors.

Subscription does not change their value or execution state.

Do not special-case context subscription away. Future scheduler logic may use subscribed context state when assessing query readiness.

### 16. Interaction with failures and stale state

Subscription counts are independent of:

- Current node status
- Freshness
- Errors
- Successful values

A failed or stale node may remain subscribed. Step 3B will decide when subscribed nodes should execute.

### 17. Public API typing

`subscribeNodes` accepts readonly node handles:

```ts
runtime.subscribeNodes([Targets, Credits] as const);
```

`getSubscriptionState` and `hasSubscribers` accept node handles.

Avoid string-only consumer APIs. Internal lookup may remain key-based.

Do not use `any`.

## Suggested source organisation

Keep the implementation small and cohesive.

A reasonable approach is:

```text
src/core/
├── subscription.ts
├── execution.ts
├── graph.ts
├── index.ts
├── nodes.ts
├── runtime.ts
└── types.ts
```

`subscription.ts` may contain public subscription contracts and small internal helpers. Runtime-owned maps and subscription application may remain in `runtime.ts` if that is simpler.

Do not create a subscription manager class unless it clearly reduces complexity.

Suggested tests:

```text
tests/core/
├── subscription-subscription.spec.ts
├── subscription-propagation.spec.ts
├── subscription-lifecycle.spec.ts
└── subscription-types.test.ts
```

Retain all Milestone 1 and Milestone 2 tests.

## Public API direction

A reasonable Step 3A surface is:

```ts
const subscription = runtime.subscribeNodes([Targets]);

runtime.getSubscriptionState(Targets);
runtime.hasSubscribers(Targets);

subscription.unsubscribe();
```

Suggested contracts:

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly release: () => void;
}
```

Export public subscription contracts from `src/core/index.ts` and the root entry point.

Do not export:

- Mutable counter records
- Registration IDs
- Internal contribution sets
- Runtime subscription maps
- Ancestor collection helpers
- Test utilities

Exact naming may change if a simpler coherent API emerges. Document deviations.

## Tests

Use Vitest 3.0.7 and TypeScript.

### Initial subscription state

Test:

- Every registered node starts with direct, required, and total subscription count of zero.
- `hasSubscribers` is false.
- Separate runtimes have independent subscription state.
- Returned subscription-state objects are read-only snapshots.

### Direct subscription

Test:

- One subscription increments direct subscription for its target.
- Two subscriptions increment independently.
- Releasing one leaves the other active.
- Releasing both returns counts to zero.
- Direct subscription works for context, data, and derived nodes.

### Ancestor propagation

Test:

- Direct parent receives required subscription.
- Transitive ancestors receive required subscription.
- Unrelated nodes remain at zero.
- A diamond root receives one required contribution per subscription.
- Shared ancestors across multiple targets in one subscription receive one required contribution.
- Shared ancestors across separate subscriptions receive separate contributions.

### Multiple targets and deduplication

Test:

- Duplicate targets in one subscription produce one direct contribution.
- The returned `nodes` collection is deduplicated.
- Directly requested parent plus child does not give the parent both direct and required subscription from the same subscription.
- Multiple target order does not affect resulting counts.

Unless there is a strong reason otherwise, preserve first-occurrence order in `subscription.nodes` for predictable inspection.

### Release lifecycle

Test:

- Release removes all direct and ancestor contributions from that subscription.
- Release is idempotent.
- Empty subscription release is safe.
- Counters never become negative.
- Releasing subscriptions in different orders gives the same final state.

### Validation

Test:

- Unregistered target rejects synchronously.
- Registration failure applies no partial subscription.
- Error identifies the missing key.
- A different handle with the same registered key resolves to the registered definition.

### No execution side effects

Test:

- Adding subscription does not call data loaders.
- Adding subscription does not evaluate derived functions.
- Adding subscription does not change node runtime state.
- Releasing subscription does not change node runtime state.
- Adding subscription does not create execution errors.

### Observation

Test:

- Non-empty subscription produces one notification.
- Active non-empty release produces one notification.
- Empty subscription produces no notifications.
- Idempotent repeated release produces no additional notification.
- Failed subscription produces no notification.
- Listener can inspect committed counts during notification.
- One throwing listener does not prevent another listener from observing subscription.

### Type tests

Add compile-time checks for:

- `subscribeNodes` accepts context, data, and derived handles.
- `subscribeNodes` accepts readonly tuples.
- `getSubscriptionState` accepts node handles.
- `hasSubscribers` accepts node handles.
- Registration `nodes` is read-only.
- Subscription state properties are read-only numbers.
- String keys are rejected if the public API is handle-only.
- No subscription API requires `any`.

Use ordinary TypeScript test files with intentional `@ts-expect-error` assertions. Do not add a new type-test dependency.

## Documentation updates

Update only documentation affected by Step 3A.

At minimum:

- Update `docs/architecture/03-scheduler-transactions-and-concurrency.md` with implemented subscription semantics while keeping automatic scheduling labelled as Step 3B.
- Update `docs/api/01-proposed-api.md` with the implemented subscription API.
- Update `docs/implementation/01-roadmap.md`:
  - Split Milestone 3 into Steps 3A, 3B, and 3C if not already split.
  - Mark generated Step 3A work as prepared.
  - Leave offline validation pending.
  - Do not mark automatic scheduler, prefetch, or refresh work complete.
- Add `docs/implementation/08-subscription-subscription-implementation-note.md` containing:
  - Status
  - Files changed
  - Direct and required subscription semantics
  - Registration-level deduplication rules
  - Observation behaviour
  - Static checks performed
  - Offline validation commands
  - Known risks and questions for Step 3B
- Store this prompt as `docs/implementation/prompts/004-implement-subscription-subscription-and-lifecycle.md`.

Add or update an ADR only if implementation materially changes an accepted architecture decision.

## Out of scope

Do not implement:

- Automatic execution when subscription changes
- Microtask scheduler
- Scheduled-flush state
- Execution coalescing
- Subscription-driven cancellation
- Prefetch
- Manual refresh
- Vue plugin
- `useNode`
- `useNodes`
- Scope-aware cleanup
- Query groups
- Transactions
- Events
- Polling
- Retry policies
- Mutations
- Metrics
- Snapshots
- Devtools visualisation
- Cache garbage collection

If implementation starts invoking `runtime.execute` from subscription code, stop. That belongs to Step 3B.

## Quality requirements

- Prefer one small subscription model over multiple abstractions.
- Keep subscription mutable state separate from immutable definitions.
- Keep `src/core` independent of Vue, Pinia, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Avoid console logging in core source.
- Avoid global state.
- Do not expose mutable maps, sets, or arrays.
- Use subscription-level sets to prevent duplicate ancestor contributions.
- Make release idempotence explicit rather than relying on counters clamping at zero.
- Do not silently clamp incorrect negative counts. Treat such a condition as an internal defect.
- Keep changes within Step 3A.

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
- Confirm no scheduler, scheduled flush, prefetch, refresh, transaction, event, polling, mutation, metric, snapshot, or Vue integration was introduced.
- Search subscription implementation for calls to `execute` and confirm none exist.
- Confirm mutable subscription state was not added to node definitions.
- Confirm all required test categories are represented.
- Confirm documentation marks Step 3A validation as pending.
- Create a ZIP containing only files added or changed for Step 3A.
- Validate ZIP integrity and contents before responding.

These checks are not proof that TypeScript, Vitest, or the build passes.

## Offline validation for the developer

Ask the developer to apply the Step 3A ZIP and run from the repository root:

```bash
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm check:boundaries
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

The development server only needs to run long enough to confirm that the playground still renders.

The developer should return:

- Node.js version
- pnpm version
- Full output for failed commands
- Type errors with file and line number
- Failed test names and assertion output
- Unhandled rejection warnings
- Any dependency warnings
- Confirmation that the playground still renders

## Prepared acceptance criteria

The contained-environment changes are ready for offline validation when:

- Every runtime node has zero initial subscription.
- Direct subscription can be registered for readonly node handles.
- Transitive ancestors receive required subscription.
- Diamond and shared-ancestor contributions are deduplicated per subscription.
- Separate subscriptions contribute independently.
- Parent-plus-child targets follow documented set semantics.
- Release removes exactly one subscription's contributions.
- Release is idempotent.
- Empty subscription is a safe no-op.
- Unregistered targets apply no partial subscription.
- Subscription state is typed and read-only.
- Subscription changes use existing runtime observation.
- Node subscription and release do not execute or mutate node runtime values.
- Required behavioural and type tests are present.
- Public exports are intentional.
- Core remains independent of Vue and other logical layers.
- Documentation marks validation pending.
- A validated ZIP containing only Step 3A changes is returned.
- Step 3B and later behaviour is not implemented.

## Validated acceptance criteria

Step 3A is complete only after the developer reports:

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Direct, required, shared-ancestor, lifecycle, validation, observation, and no-execution tests pass.
- All subscription type tests pass.
- No unhandled promise rejections occur.
- Any reported issues have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of the node subscription lifecycle prepared.
2. A ZIP containing only Step 3A files added or changed.
3. Files added, changed, and removed.
4. The final public subscription API.
5. Direct, required, deduplication, release, and observation decisions.
6. Static checks performed and their results.
7. Project commands not run in the contained environment.
8. Exact offline validation steps.
9. Assumptions, deviations, known limitations, and risks for Step 3B.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
