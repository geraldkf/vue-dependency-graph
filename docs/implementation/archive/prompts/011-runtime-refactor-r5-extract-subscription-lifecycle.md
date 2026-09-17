# Implementation Prompt 011: Extract Subscription Storage and Lifecycle

## Role

You are implementing **R5** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D and R2 through R4 have been validated offline.

The validated baseline includes:

- Immutable typed node definitions and validated graph topology
- Runtime-local node state and active-attempt storage
- A closure-based runtime observer
- One closure-based execution controller used by explicit execution, scheduler execution, prefetch, and refresh
- Direct, required, and total subscription accounting
- Subscription-level target and ancestor deduplication
- Key-based registered-node identity
- Idempotent subscription release
- Subscription-driven automatic scheduling
- Scheduler-only cancellation after final unsubscribe
- Eleven established notification ownership points

R5 extracts subscription storage and subscription lifecycle into one closure-based internal capability.

R5 is a behavior-preserving extraction. It must not redesign subscription semantics or move scheduler and cancellation policy into the subscription controller.

Do not start R6 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/18-runtime-refactor-r4-execution-controller-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `src/core/subscription.ts`
- `src/core/runtime-state.ts`
- `src/core/runtime-execution.ts`
- `MutableNodeSubscriptionState`
- The local `subscriptionStates` map
- `requireSubscriptionState(...)`
- `getSubscriptionState(...)`
- `collectAncestors(...)`
- `subscribeNodes(...)`
- Subscription-level direct and required key sets
- Idempotent `unsubscribe()`
- Subscription notifications
- Scheduler requests after successful registration
- Active-attempt iteration after unsubscribe
- Scheduler-only cancellation
- Existing subscription registration, propagation, lifecycle, scheduler, cancellation, and type tests

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

1. Apply only the R5 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve subscription accounting and validation atomically.
5. Preserve scheduler triggering and cancellation ownership.
6. Preserve notification ownership and timing.
7. Return a ZIP containing only files added or changed for R5.
8. Provide exact offline validation commands.
9. Report project commands as `Not run in contained environment`.

No file deletion is expected for R5.

## Objective

Extract the existing subscription state and lifecycle into:

```text
src/core/runtime-subscriptions.ts
```

Use one small closure-based internal controller.

A reasonable internal contract is:

```ts
interface RuntimeSubscriptionController {
  readonly subscribeNodes: (
    nodes: readonly AnyNodeDefinition[]
  ) => NodeSubscription;

  readonly getSubscriptionState: (
    node: AnyNodeDefinition
  ) => NodeSubscriptionState;

  readonly hasSubscribers: (
    node: AnyNodeDefinition
  ) => boolean;

  readonly hasDirectSubscribers: (
    node: AnyNodeDefinition
  ) => boolean;
}
```

The controller may need lifecycle callbacks supplied by `runtime.ts`:

```ts
interface RuntimeSubscriptionDependencies {
  readonly graph: Graph;

  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;

  readonly notify: () => void;

  readonly onSubscribed: () => void;

  readonly onUnsubscribed: () => void;
}
```

However, prefer a more precise callback contract that prevents duplicate notification or unrelated policy leakage.

A suitable direction is:

```ts
interface RuntimeSubscriptionDependencies {
  readonly graph: Graph;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;

  readonly onSubscriptionCommitted: (
    change: "added" | "removed"
  ) => void;
}
```

`runtime.ts` can then preserve the current order of notification, scheduling, and cancellation work.

Use the simplest contract that keeps storage and accounting inside the controller while leaving external policy outside it.

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

The public subscription contracts remain unchanged:

```ts
interface NodeSubscriptionState {
  readonly direct: number;
  readonly required: number;
  readonly total: number;
}

interface NodeSubscription {
  readonly nodes: readonly AnyNodeDefinition[];
  readonly unsubscribe: () => void;
}
```

Do not add, remove, rename, or overload public APIs.

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

Do not publicly export:

- `RuntimeSubscriptionController`
- `RuntimeSubscriptionDependencies`
- `MutableNodeSubscriptionState`
- Subscription maps
- Contribution key sets
- Ancestor collection helpers
- Subscription lifecycle callbacks

## Ownership boundary

### R5 subscription controller owns

- Creation of runtime-local subscription state for every registered node
- Required subscription-state lookup by key
- Frozen public subscription snapshots
- `hasSubscribers(...)`
- Direct-subscriber inspection needed by the scheduler
- Complete target validation before mutation
- Equivalent-handle resolution through the registered key
- Target deduplication by key
- Preservation of first-occurrence target order
- Transitive ancestor collection
- Shared-ancestor deduplication per subscription
- Excluding directly selected nodes from required contributions
- Applying direct and required count increments
- Capturing each subscription's direct and required contribution sets
- Applying direct and required count decrements
- Explicit idempotent unsubscribe state
- Returning the frozen registered-node target list

### `runtime.ts` continues to own

- Observer composition
- Actual runtime `notify()` invocation unless a narrowly injected callback preserves ownership clearly
- Scheduler request policy after registration
- Scheduler state and microtask queueing
- Final-unsubscribe active-attempt inspection
- Scheduler-only cancellation decisions
- Abort decisions
- Execution-origin policy
- Context invalidation
- Runtime composition and public object assembly

### R6 scheduler boundary

R5 must not move:

- `schedule()`
- `flushScheduler(...)`
- Scheduler flags
- Scheduler errors
- Follow-up handling
- Settlement waiters
- Scheduler target selection

The subscription controller may expose `hasDirectSubscribers(...)` so `runtime.ts` can preserve current scheduler target selection without reading mutable subscription records.

### Cancellation boundary

R5 must not make the subscription controller iterate active attempts or abort controllers.

After an active non-empty unsubscribe is committed, `runtime.ts` remains responsible for:

- Inspecting current active attempts
- Checking current total subscription state
- Applying `isSchedulerOnlyAttempt(...)`
- Aborting only scheduler-only work that is no longer subscribed

The controller may invoke a narrow post-commit callback after counts are removed. It must not own active-attempt storage or cancellation policy.

## Required source changes

### 1. Add `runtime-subscriptions.ts`

Add:

```text
src/core/runtime-subscriptions.ts
```

Keep this internal module framework-agnostic.

It may import:

- `NodeSubscription`
- `NodeSubscriptionState`
- Public graph and node types

It must not import:

- Vue
- Pinia
- Devtools
- Playground code
- Runtime execution controller
- Runtime state store
- Scheduler implementation
- Runtime observer implementation
- Active-attempt types unless unavoidable, which should not be necessary

Prefer explicit injected callbacks rather than importing `runtime.ts`.

### 2. Move mutable subscription state

Move the private shape from `runtime.ts`:

```ts
interface MutableNodeSubscriptionState {
  direct: number;
  required: number;
}
```

into `runtime-subscriptions.ts`.

Keep it private to that module unless an internal exported type is genuinely needed.

Do not add:

- Total as mutable stored state
- Registration IDs
- Subscriber object references
- Timestamps
- Reasons
- Scheduler flags
- Attempt ownership

`total` remains derived as:

```ts
state.direct + state.required
```

### 3. Move subscription-state initialization

Move creation of:

```ts
const subscriptionStates =
  new Map<string, MutableNodeSubscriptionState>();
```

and eager initialization for every graph node into the controller factory.

Each runtime creates one independent subscription controller.

Requirements:

- Every registered node starts with direct `0` and required `0`.
- State is created eagerly.
- No lazy creation hides unknown-node defects.
- No module-level or global mutable state.
- Runtimes created from one graph remain independent.

### 4. Move required subscription-state lookup

Move `requireSubscriptionState(...)` into the controller.

Preserve behavior:

- Lookup by key
- Throw when state is unexpectedly absent
- Include the node key in the error message
- Never create missing state silently

Keep the helper private unless one narrow internal use requires exposure.

### 5. Move frozen public snapshots

Move `getSubscriptionState(...)` into the controller.

Preserve:

- Lookup by node key
- Fresh snapshot object per call
- `Object.freeze(...)`
- Read-only direct, required, and total values
- Equivalent-handle inspection by key

The public result remains:

```ts
Object.freeze({
  direct: state.direct,
  required: state.required,
  total: state.direct + state.required,
});
```

Do not cache snapshot objects.

Do not expose mutable records.

### 6. Add direct-subscriber inspection

The scheduler currently selects directly subscribed terminal targets.

Expose one internal query:

```ts
hasDirectSubscribers(node): boolean
```

or:

```ts
getDirectSubscriptionCount(node): number
```

Prefer the boolean query because the scheduler needs only a predicate.

This query is internal and must not be added to `GraphRuntime`.

Do not change scheduler selection to total subscribers.

Required-only ancestors remain executed through the execution engine, not scheduled as independent terminal targets.

### 7. Move ancestor collection

Move `collectAncestors(...)` into the subscription controller.

Preserve exact semantics:

- Traverse through `graph.getParents(...)`.
- Include every transitive ancestor.
- Deduplicate by key.
- Handle diamond graphs with one contribution per subscription.
- Avoid recursion into a key already visited.
- Use registered graph topology.

Do not scan all graph nodes.

Do not move invalidation descendant traversal. That is a separate responsibility and belongs to R7.

### 8. Move complete target validation

`subscribeNodes(...)` remains synchronous.

Before changing any counter:

1. Resolve every requested handle through registered-node validation.
2. Deduplicate by key.
3. Preserve first-occurrence target order.
4. Reject immediately if any requested target is unknown.
5. Apply no partial count changes or notifications on failure.

Use an injected resolver close to:

```ts
resolveRegisteredNode(node)
```

The resolver may delegate to the existing R1C helper with purpose `"node subscription"`.

Do not weaken key-based identity to object-reference identity.

### 9. Preserve subscription-level set semantics

For each successful subscription:

- `directKeys` contains each registered direct target key once.
- `requiredKeys` contains transitive ancestor keys.
- Remove every `directKey` from `requiredKeys`.
- Increment direct counts once for each direct key.
- Increment required counts once for each required key.

This preserves behavior such as:

```text
subscribeNodes([Parent, Child])

Parent: direct +1, required +0
Child:  direct +1, required +0
Ancestors above Parent: required +1
```

Do not change this to edge-count semantics.

Do not add required contributions for duplicate traversal paths.

### 10. Preserve empty subscription behavior

For:

```ts
runtime.subscribeNodes([])
```

preserve:

- Return a valid `NodeSubscription`.
- Return a frozen empty `nodes` list.
- Do not mutate counters.
- Do not notify.
- Do not request scheduling.
- `unsubscribe()` remains safe and idempotent.

Avoid special public types for empty subscriptions.

### 11. Preserve subscription result

The returned subscription must expose:

```ts
Object.freeze({
  nodes,
  unsubscribe,
});
```

Preserve:

- `nodes` contains registered definitions, not equivalent request handles.
- `nodes` is deduplicated.
- First-occurrence input order is retained.
- `nodes` is frozen.
- The subscription object remains frozen if that is current behavior.
- `unsubscribe()` is explicitly idempotent.

Do not expose contribution sets publicly.

### 12. Preserve idempotent unsubscribe

The controller owns one private active flag per returned subscription:

```ts
let active = true;
```

On unsubscribe:

1. Return immediately when already inactive.
2. Mark the subscription inactive.
3. Decrement direct contributions exactly once.
4. Decrement required contributions exactly once.
5. Call the post-commit lifecycle callback once for a non-empty active subscription.

Do not rely on counter clamping for idempotence.

Do not allow counters to become negative silently.

If the current implementation assumes correct contribution accounting and does not add defensive negative-count checks, preserve that behavior. Do not introduce unrelated error semantics in R5.

### 13. Preserve notification ownership

The established rule remains:

> Subscription lifecycle owns notification after subscription counts are committed.

There are two acceptable designs.

#### Preferred design

Inject `notify` into the subscription controller and let it notify directly after:

- Successful non-empty count addition
- Active non-empty count removal

Then invoke separate runtime callbacks for scheduling or cancellation after the subscription notification.

Suggested dependency shape:

```ts
interface RuntimeSubscriptionDependencies {
  readonly graph: Graph;
  readonly resolveRegisteredNode: (
    node: AnyNodeDefinition
  ) => AnyNodeDefinition;
  readonly notify: () => void;
  readonly afterSubscribe: () => void;
  readonly afterUnsubscribe: () => void;
}
```

#### Acceptable design

Expose one private commit callback that is implemented in `runtime.ts` and performs notification first, then the appropriate external policy.

Whichever design is chosen, preserve order exactly:

##### Registration

1. Validate complete target list.
2. Commit counts.
3. Notify.
4. Request scheduler work.

##### Active unsubscribe

1. Commit count removal.
2. Notify.
3. Evaluate active-attempt cancellation.

Do not notify:

- Empty subscription
- Failed validation
- Repeated unsubscribe

Do not notify from snapshot reads or subscriber predicates.

### 14. Preserve scheduler requests

After a successful non-empty subscription is committed and notified, `runtime.ts` must request scheduler work exactly as before.

The subscription controller must not:

- Queue microtasks directly
- Know scheduler state
- Select scheduler targets
- Execute nodes

Use a narrow callback such as:

```ts
afterSubscribe: schedule
```

or an equivalent runtime-owned function.

Do not schedule on unsubscribe.

### 15. Preserve final-unsubscribe cancellation

After counts are removed and notification is sent, `runtime.ts` must retain the existing loop over active attempts.

For each active attempt:

- Read the current subscription total through the controller.
- Continue when the node is still subscribed.
- Abort only when `isSchedulerOnlyAttempt(attempt)` is true.
- Preserve caller-owned explicit, prefetch, and refresh work.

Do not move `isSchedulerOnlyAttempt(...)` into the subscription controller.

Do not move active-attempt iteration into the subscription controller.

### 16. Rewire scheduler target selection

Replace direct access such as:

```ts
requireSubscriptionState(node.key).direct === 0
```

with the controller query:

```ts
!subscriptions.hasDirectSubscribers(node)
```

Preserve:

- Context nodes are excluded.
- Only directly subscribed nodes become scheduler terminal targets.
- Required ancestors are included by execution.
- Fresh-success reuse continues through the R4 controller query.

Do not alter scheduler target selection otherwise.

### 17. Rewire invalidation subscription checks

Context and refresh descendant invalidation currently determine whether affected descendants remain subscribed.

Replace direct subscription-state access with:

```ts
subscriptions.hasSubscribers(node)
```

or equivalent internal query.

Preserve:

- Total subscription semantics
- Required-only descendants where applicable
- Existing scheduling decision
- Existing traversal and generation behavior

Do not move invalidation traversal into the subscription controller.

### 18. Rewire public runtime methods

`createGraphRuntime(...)` creates one controller:

```ts
const subscriptions =
  createRuntimeSubscriptionController({ ... });
```

The frozen public runtime delegates:

```ts
subscribeNodes: subscriptions.subscribeNodes,
getSubscriptionState:
  subscriptions.getSubscriptionState,
hasSubscribers: subscriptions.hasSubscribers,
```

Do not expose `hasDirectSubscribers(...)` publicly.

Do not move the rest of public runtime assembly.

### 19. Keep `subscription.ts` public-contract-only

The existing:

```text
src/core/subscription.ts
```

should continue to contain the public `NodeSubscription` and `NodeSubscriptionState` contracts.

Do not move the runtime controller into that file unless repository conventions clearly favor it and doing so does not mix public contracts with private mutable implementation.

Preferred organization:

```text
src/core/subscription.ts
src/core/runtime-subscriptions.ts
```

Do not change public exports from `subscription.ts`.

## Behavior that must remain unchanged

### Initial state

- Every registered node starts with direct `0` and required `0`.
- Total begins at `0`.
- `hasSubscribers(...)` returns false.
- Separate runtimes have independent counts.

### Direct subscriptions

- Context, data, and derived nodes can be direct targets.
- Separate subscriptions contribute independently.
- Duplicate targets within one subscription contribute once.
- Returned nodes use registered definitions.

### Required subscriptions

- Transitive ancestors receive required contributions.
- Diamond ancestors receive one contribution per subscription.
- Shared ancestors across targets receive one contribution per subscription.
- Separate subscriptions contribute separately.
- A directly targeted parent does not also receive a required contribution from that subscription.

### Lifecycle

- Unsubscribe removes exactly one subscription's contributions.
- Unsubscribe is idempotent.
- One subscription cannot remove another's contribution.
- Empty subscription remains a no-op.
- Subscription objects cannot be reactivated.

### Validation

- Unknown targets throw synchronously.
- Errors include the missing key.
- Complete validation occurs before mutation.
- Failed validation causes no count changes.
- Failed validation causes no notification or scheduling.
- Equivalent handles resolve through registered keys.

### Observation

- Successful non-empty subscription notifies after counts commit.
- Active non-empty unsubscribe notifies after counts are removed.
- Empty subscription is silent.
- Repeated unsubscribe is silent.
- Failed validation is silent.
- Listener failure isolation remains owned by the R2 observer.

### Scheduling

- Successful non-empty subscription requests scheduler work after notification.
- Loaders are not invoked synchronously inside `subscribeNodes(...)`.
- Unsubscribe before the queued flush prevents loading.
- Directly subscribed stale terminal targets are selected.
- Required ancestors execute through the R4 controller.

### Cancellation

- Final unsubscribe may cancel scheduler-only work that has no remaining subscribers.
- Work remains active while another subscription requires it.
- Explicit, prefetch, and refresh ownership protect shared work.
- Cancellation is not stored as a node or scheduler business error.

### Public snapshots

- Subscription snapshots are frozen.
- Each call returns a fresh snapshot.
- Public mutation cannot change internal counters.

### Public API

- Public signatures and exports remain unchanged.
- No new convenience API is added.
- No internal controller is exported.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not test the private controller directly unless public behavior cannot prove the requirement. Prefer public `GraphRuntime` entry points.

### 1. Existing registration coverage must remain

Existing tests must continue to prove:

- Zero initial counts
- Runtime independence
- Direct subscriptions for every node kind
- Separate subscription contributions
- No synchronous loader execution
- Frozen snapshots

### 2. Existing propagation coverage must remain

Existing tests must continue to prove:

- Transitive required propagation
- Unrelated nodes remain unchanged
- Diamond deduplication
- Shared-ancestor deduplication
- Parent-plus-child target set semantics
- Frozen deduplicated target list

### 3. Existing lifecycle coverage must remain

Existing tests must continue to prove:

- Exact single-subscription release
- Idempotent unsubscribe
- Empty no-op subscription
- Atomic validation
- Equivalent-handle resolution
- Observation and listener-failure isolation

### 4. Existing scheduler and cancellation coverage must remain

Existing tests must continue to prove:

- Subscription queues automatic work without synchronous loading
- Unsubscribe before flush prevents work
- Multiple subscriptions share work
- Releasing one subscription preserves work required by another
- Final unsubscribe aborts scheduler-only work
- Explicit caller-owned work survives
- Prefetch caller-owned work survives
- Refresh caller-owned work survives

### 5. Add snapshot independence coverage if missing

Ensure one public test proves:

```ts
const before = runtime.getSubscriptionState(node);
const subscription = runtime.subscribeNodes([node]);
const after = runtime.getSubscriptionState(node);

expect(before.total).toBe(0);
expect(after.total).toBe(1);
expect(before).not.toBe(after);
expect(Object.isFrozen(before)).toBe(true);
expect(Object.isFrozen(after)).toBe(true);
```

Add this only if existing tests do not clearly establish snapshot independence.

Prefer extending:

```text
tests/core/node-subscription-registration.spec.ts
```

### 6. Add notification ordering coverage only if missing

If current tests do not prove committed counts are visible during notification, add a focused behavior test:

- Register an observer.
- Subscribe a node.
- Read subscription state inside the listener.
- Confirm the listener sees committed counts.
- Unsubscribe.
- Confirm the listener sees removed counts.

Do not assert scheduler lifecycle notification totals.

### 7. Type tests

Existing type tests must continue to prove:

- `subscribeNodes(...)` accepts readonly node handles.
- Returned nodes are read-only.
- Subscription-state fields are read-only numbers.
- `getSubscriptionState(...)` and `hasSubscribers(...)` reject string keys.
- Old lifecycle terminology remains absent.
- Public APIs require no `any`.

Do not expose internal direct-subscriber queries in type tests.

### 8. Test restraint

Do not add tests for:

- Private controller shape
- Private map size
- Private mutable record identity
- Contribution-set implementation
- Ancestor helper call count
- Source-file placement

Test observable behavior.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R4 remain validated offline.
- R5 implementation is prepared.
- R5 offline validation remains pending.
- R6 through R9 remain incomplete.
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
[ ] R5 offline validation
[ ] R6: Extract the automatic scheduler
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R4 as validated offline
- R5 as prepared with offline validation pending
- R6 through R9 as planned

Add a brief R5 implementation decision under the R5 section:

- Subscription counters and contribution accounting moved into one runtime-local closure controller.
- Complete validation, target deduplication, ancestor collection, snapshots, and idempotent unsubscribe belong to that controller.
- Scheduler triggering, active-attempt cancellation, and execution-origin policy remain outside it.
- Subscription notification ownership and ordering remain unchanged.

Do not rewrite earlier refactor decisions.

### 3. Add an R5 implementation note

Add:

```text
docs/implementation/19-runtime-refactor-r5-subscription-lifecycle-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Subscription-controller contract
- Mutable state and initialization
- Snapshot behavior
- Key-based validation and atomicity
- Direct and required contribution semantics
- Ancestor deduplication
- Idempotent unsubscribe
- Notification ordering
- Scheduler callback boundary
- Cancellation callback boundary
- Scheduler target-selection query
- Tests added or updated
- Confirmation that public APIs and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R6
- Next task: R6

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/011-runtime-refactor-r5-extract-subscription-lifecycle.md
```

## Out of scope

Do not implement:

- Scheduler extraction
- Scheduler-state movement
- Microtask scheduling changes
- Follow-up-flush changes
- Settlement changes
- Scheduler error changes
- Execution-controller changes
- Runtime-state changes
- Observer changes
- Invalidation extraction
- Context-update extraction
- Prefetch or refresh extraction
- Runtime assembly simplification beyond subscription-controller creation and delegation
- Public subscription API changes
- New subscription concepts
- Subscription reasons
- Per-listener subscription events
- Node-specific observation
- Transactions
- Domain events
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

Do not turn the subscription controller into a scheduler or cancellation manager.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-subscriptions.ts
src/core/runtime.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/19-runtime-refactor-r5-subscription-lifecycle-implementation-note.md
docs/implementation/prompts/011-runtime-refactor-r5-extract-subscription-lifecycle.md
```

Potential focused test change only if current coverage is insufficient:

```text
tests/core/node-subscription-registration.spec.ts
tests/core/node-subscription-lifecycle.spec.ts
```

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve runtime behavior exactly.
- Preserve direct, required, and total semantics.
- Preserve subscription-level set semantics.
- Preserve key-based equivalent-handle resolution.
- Preserve complete validation before mutation.
- Preserve synchronous error timing.
- Preserve first-occurrence target order.
- Preserve frozen fresh snapshots.
- Preserve explicit idempotent unsubscribe.
- Preserve notification timing and ordering.
- Keep scheduling policy outside the controller.
- Keep cancellation policy outside the controller.
- Keep active attempts outside the controller.
- Keep execution policy outside the controller.
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
11. Confirm `runtime-subscriptions.ts` is not exported from `src/core/index.ts`.
12. Confirm `subscription.ts` public contracts are unchanged.
13. Confirm one subscription controller is created per runtime.
14. Confirm the subscription-state map exists only inside the controller factory.
15. Confirm no module-level mutable subscription state exists.
16. Confirm all graph nodes receive subscription state eagerly.
17. Confirm mutable state contains only direct and required counts.
18. Confirm total remains derived.
19. Confirm public snapshots are fresh and frozen.
20. Confirm complete registered-target validation occurs before counter mutation.
21. Confirm target deduplication preserves first-occurrence order.
22. Confirm ancestor collection uses graph parents and key-based visited semantics.
23. Confirm direct targets are removed from required contributions.
24. Confirm unsubscribe uses an explicit active flag.
25. Confirm empty registration and repeated unsubscribe remain silent.
26. Confirm registration notification occurs after count addition and before scheduling.
27. Confirm unsubscribe notification occurs after count removal and before cancellation evaluation.
28. Confirm scheduler microtask logic remains outside the controller.
29. Confirm final-unsubscribe active-attempt iteration and abort policy remain outside the controller.
30. Confirm scheduler-only ownership logic remains outside the controller.
31. Confirm scheduler target selection uses the controller's direct-subscriber query.
32. Confirm invalidation uses total-subscriber inspection without moving traversal.
33. Confirm R2 observer source is unchanged.
34. Confirm R3 runtime-state semantics are unchanged.
35. Confirm R4 execution-controller semantics are unchanged.
36. Confirm the semantic total of notification ownership points remains eleven.
37. Confirm no R6 or later extraction occurred.
38. Confirm R5 is validation pending and R6 through R9 remain incomplete.
39. Create a ZIP containing only R5 files added or changed.
40. Validate ZIP integrity and contents before responding.

Use a mechanical source reconstruction or focused diff review to prove that `runtime.ts` changes are limited to:

- Subscription-controller import and construction
- Removal of the local subscription map and helpers
- Delegation of public subscription APIs
- Replacement of direct/total subscription reads with narrow controller queries
- Post-subscribe scheduling callback wiring
- Post-unsubscribe cancellation callback wiring

These static checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R5 ZIP, run from the repository root:

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

R5 is ready for offline validation when:

- One closure-based subscription controller exists per runtime.
- Subscription state is private and runtime-local.
- Every graph node receives eager zero-count state.
- Public subscription snapshots remain fresh and frozen.
- Complete target validation occurs before mutation.
- Equivalent handles resolve to registered definitions.
- Duplicate targets are deduplicated while preserving order.
- Direct and required contribution semantics remain unchanged.
- Diamond and shared ancestors contribute once per subscription.
- Direct targets do not also receive required contributions.
- Empty subscription remains a silent no-op.
- Unsubscribe remains explicitly idempotent.
- Registration notification occurs after count commit and before scheduling.
- Unsubscribe notification occurs after count removal and before cancellation evaluation.
- Scheduler triggering remains outside the controller.
- Active-attempt iteration and cancellation remain outside the controller.
- Scheduler target selection still uses direct subscriptions.
- Invalidation scheduling still uses total subscription state.
- Public APIs and exports are unchanged.
- R2 observation, R3 storage, and R4 execution semantics remain unchanged.
- Existing behavior-focused tests remain intact.
- R5 is marked prepared with offline validation pending.
- R6 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R5 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Registration, propagation, lifecycle, observation, scheduler triggering, and cancellation behavior remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R5.
2. A ZIP containing only R5 files added or changed.
3. Files added and changed.
4. The internal subscription-controller contract.
5. State initialization and snapshot decisions.
6. Validation, target deduplication, and ancestor-contribution decisions.
7. Idempotent unsubscribe decision.
8. Notification, scheduler, and cancellation callback ordering.
9. Scheduler direct-subscriber and invalidation total-subscriber query decisions.
10. Tests added or updated.
11. Confirmation that public APIs, exports, R2 observation, R3 storage, R4 execution, scheduler behavior, cancellation policy, and runtime behavior were intentionally preserved.
12. Static checks and results.
13. Project commands marked `Not run in contained environment`.
14. Exact offline validation steps.
15. The next planned task: R6.
