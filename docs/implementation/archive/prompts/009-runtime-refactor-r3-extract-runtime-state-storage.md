# Implementation Prompt 009: Extract Runtime State and Active-Attempt Storage

## Role

You are implementing **R3** of the runtime composition refactor for `vue-dependency-graph`.

R1A through R1D and R2 have been validated offline.

The validated baseline includes:

- Immutable graph definitions and topology
- Per-runtime mutable node state
- Typed frozen state snapshots
- Named fresh-success and ownership invariants
- Standardised registered-node validation
- Extracted runtime observation
- Eleven preserved notification ownership points
- One dependency-aware execution engine
- Runtime-local active attempts and one-shot operation ownership

R3 is a narrow, behavior-preserving extraction. Move runtime node-state storage and active-attempt storage out of `runtime.ts` into one small closure-based internal capability.

R3 extracts **storage and storage access only**.

Do not move:

- Execution policy
- Attempt creation policy
- Origin-sharing policy
- Cancellation decisions
- Generation advancement decisions
- Node state-transition decisions
- Invalidation traversal
- Notification ownership
- Scheduler behavior
- Subscription behavior
- Prefetch or refresh orchestration

Those responsibilities remain in `runtime.ts` until their later dedicated tasks.

Do not start R4 or any later refactor task.

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
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- `MutableNodeRuntimeState`
- `ExecutionOrigin`
- `ActiveAttempt`
- `createInitialState(...)`
- `snapshotState(...)`
- The local `states` map
- The local `activeAttempts` map
- `requireState(...)`
- Attempt lookup, insertion, iteration, token-safe cleanup, and abort usage
- State snapshot typing through `getState(...)`
- Runtime isolation tests
- Attempt deduplication, cancellation, and race tests
- The R2 `runtime-observer.ts` dependency direction

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

1. Apply only the R3 changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve every state transition and active-attempt behavior.
5. Preserve the eleven notification ownership points established by R1D and R2.
6. Return a ZIP containing only files added or changed for R3.
7. Provide exact offline validation commands.
8. Report project commands as `Not run in contained environment`.

No file deletion is expected for R3.

## Objective

Extract two runtime-local storage concerns into one cohesive internal module:

1. Mutable node-state storage and read-only snapshot creation
2. Active-attempt storage and token-safe access

Add:

```text
src/core/runtime-state.ts
```

A reasonable internal direction is:

```ts
interface RuntimeStateStore {
  readonly getMutableState: (
    key: string
  ) => MutableNodeRuntimeState;

  readonly getSnapshot: <TNode extends AnyNodeDefinition>(
    node: TNode
  ) => NodeRuntimeState<RuntimeNodeData<TNode>>;

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

  readonly getActiveAttempts: () =>
    IterableIterator<readonly [string, ActiveAttempt]>;
}
```

The exact internal contract may be smaller if existing call patterns allow it.

Prefer the simplest contract that preserves current behavior and makes ownership explicit.

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

The following public contracts must remain where consumers currently import them:

```ts
NodeStatus
NodeFreshness
RuntimeNodeData<TNode>
NodeRuntimeState<TData>
RuntimeListener
GraphRuntime
```

Do not publicly export:

- `RuntimeStateStore`
- `MutableNodeRuntimeState`
- `ActiveAttempt`
- `ExecutionOrigin`
- Mutable maps
- Attempt-controller access
- State mutation helpers

## Ownership boundary

### R3 storage owns

- Creation of the per-runtime node-state map
- Initial mutable state for every registered node
- Required state lookup by key
- Frozen public state snapshots
- Creation of the per-runtime active-attempt map
- Active-attempt lookup by key
- Active-attempt insertion by key
- Token-safe active-attempt deletion
- Active-attempt iteration needed by existing cancellation logic

### `runtime.ts` continues to own

- When node state changes
- What values are assigned during a transition
- When generations advance
- When freshness changes
- When errors are cleared or stored
- When successful-value state changes
- When attempts are created
- Which origin owns an attempt
- When an origin is added
- When an attempt is aborted
- Whether an attempt is obsolete
- Whether unsubscribe may cancel an attempt
- When refresh supersedes an attempt
- When notifications occur

The state store must not become a state machine or execution controller.

## Required source changes

### 1. Add `runtime-state.ts`

Add one internal module:

```text
src/core/runtime-state.ts
```

Keep it framework-agnostic and focused.

A reasonable structure is:

```ts
import type {
  AnyNodeDefinition,
  DataNodeDefinition,
  Graph,
  NodeValue,
} from "./types";
import type {
  NodeFreshness,
  NodeRuntimeState,
  NodeStatus,
  RuntimeNodeData,
} from "./runtime";

export interface MutableNodeRuntimeState {
  data: unknown;
  status: NodeStatus;
  freshness: NodeFreshness;
  error: Error | null;
  generation: number;
  hasSuccessfulValue: boolean;
}

export type ExecutionOrigin =
  | "explicit"
  | "scheduler"
  | "prefetch"
  | "refresh";

export interface ActiveAttempt {
  readonly generation: number;
  readonly token: symbol;
  readonly controller: AbortController;
  readonly origins: Set<ExecutionOrigin>;
  readonly promise: Promise<void>;
}
```

These exports are internal module exports only. Do not add them to `src/core/index.ts`.

If importing public runtime types from `runtime.ts` creates an undesirable type-only cycle, use the smallest clean alternative:

- Move only shared public state types into `runtime-state.ts`, then re-export them from `runtime.ts`, while keeping `src/core/index.ts` exports unchanged, or
- Keep public types in `runtime.ts` and use type-only imports.

Prefer the solution with:

- No runtime circular dependency
- Minimal public-export churn
- Clear dependency direction
- Smallest diff

Do not duplicate public state type definitions.

### 2. Move mutable state types

Move the private mutable state shape from `runtime.ts` into `runtime-state.ts`:

```ts
interface MutableNodeRuntimeState {
  data: unknown;
  status: NodeStatus;
  freshness: NodeFreshness;
  error: Error | null;
  generation: number;
  hasSuccessfulValue: boolean;
}
```

The shape must remain unchanged.

Do not add setters, methods, revision IDs, timestamps, reasons, metadata, or events.

### 3. Move active-attempt storage types

Move private storage types needed by the state store:

```ts
type ExecutionOrigin =
  | "explicit"
  | "scheduler"
  | "prefetch"
  | "refresh";

interface ActiveAttempt {
  readonly generation: number;
  readonly token: symbol;
  readonly controller: AbortController;
  readonly origins: Set<ExecutionOrigin>;
  readonly promise: Promise<void>;
}
```

Their structure and semantics must remain unchanged.

`ExecutionOrigin` remains a closed internal union in R3.

Do not:

- Change the origin names
- Replace the mutable origin `Set`
- Add reference counts
- Add owner objects
- Add public origin inspection
- Move attempt policy to the store

R4 may later move execution ownership into the execution controller.

### 4. Move initial-state creation

Move `createInitialState(...)` into `runtime-state.ts` as a private helper used by the state-store factory.

Preserve exact initial semantics:

#### Context nodes

```text
data: initialValue
status: success
freshness: fresh
error: null
generation: 0
hasSuccessfulValue: true
```

#### Data nodes

```text
data: initialValue
status: idle
freshness: stale
error: null
generation: 0
hasSuccessfulValue: false
```

#### Derived nodes

```text
data: undefined
status: idle
freshness: stale
error: null
generation: 0
hasSuccessfulValue: false
```

Do not change derived pre-success typing or representation.

### 5. Move state snapshot creation

Move `snapshotState(...)` into `runtime-state.ts`.

Preserve:

- Fresh snapshot object creation
- `Object.freeze(...)`
- All public fields
- Field values and references
- Generic state-data typing
- Error object identity

Do not deep-clone node data or errors.

Do not cache snapshot objects.

A state snapshot must continue to represent state at the time `getState(...)` is called.

### 6. Add a runtime-state store factory

Add a closure-based factory close to:

```ts
export const createRuntimeStateStore = (
  graph: Graph
): RuntimeStateStore => {
  const states = new Map<string, MutableNodeRuntimeState>();
  const activeAttempts = new Map<string, ActiveAttempt>();

  for (const node of graph.getNodes()) {
    states.set(node.key, createInitialState(node));
  }

  // Return a frozen narrow capability.
};
```

Each runtime must create one independent store.

Do not use:

- Global maps
- WeakMaps keyed by graph
- Shared state between runtimes
- Lazy state creation
- A class hierarchy
- A dependency-injection container

Create state for all registered nodes when the runtime is created, as before.

### 7. Preserve required mutable-state lookup

The current `requireState(...)` behavior must remain:

- Lookup by node key
- Return the private mutable record
- Throw if missing
- Include the missing key in the error message

Expose it internally with a clear name such as:

```ts
getMutableState(key)
```

or:

```ts
requireState(key)
```

Prefer `getMutableState(...)` if the thrown behavior is documented in the interface, or retain `requireState(...)` if it more clearly communicates failure.

Do not silently create missing state.

Do not expose this function publicly.

### 8. Preserve typed snapshot access

The store should provide a typed snapshot method close to:

```ts
getSnapshot<TNode extends AnyNodeDefinition>(
  node: TNode
): NodeRuntimeState<RuntimeNodeData<TNode>>
```

`GraphRuntime.getState(...)` must delegate to it.

Required behavior:

- Context state data retains the context value type.
- Data state data retains the declared data value type.
- Derived state data remains `T | undefined` before first success.
- Returned objects remain frozen.
- Mutable state remains inaccessible.

Do not change `GraphRuntime.getState(...)` or its inference.

### 9. Preserve active-attempt lookup and insertion

The store must support the existing behavior used by execution, invalidation, refresh, and unsubscribe:

```ts
getActiveAttempt(key)
setActiveAttempt(key, attempt)
```

Semantics remain:

- At most one active attempt record per node key
- Same-generation callers may add origins to the existing record
- New-generation work replaces or supersedes according to existing runtime policy
- The store does not decide whether sharing or replacement is allowed

The execution logic in `runtime.ts` continues to make those decisions.

### 10. Preserve token-safe attempt cleanup

Current cleanup removes an attempt only when the stored token still matches the completing attempt:

```ts
if (activeAttempts.get(node.key)?.token === token) {
  activeAttempts.delete(node.key);
}
```

Move this map operation into one narrow store method, preferably:

```ts
deleteActiveAttempt(key, token): void
```

Required behavior:

- Delete when the current record has the same token.
- Do nothing when no record exists.
- Do nothing when a newer record has another token.
- Never remove newer work when an obsolete promise settles.

Do not return a success value unless a current caller genuinely needs it.

### 11. Preserve active-attempt iteration

Final unsubscribe currently inspects all active attempts to cancel scheduler-only work that is no longer required.

Provide the smallest iteration API needed, for example:

```ts
getActiveAttempts(): IterableIterator<
  [string, ActiveAttempt]
>
```

or:

```ts
forEachActiveAttempt(callback)
```

Prefer the simplest approach that:

- Does not expose the private map publicly
- Does not allocate unnecessary copies
- Preserves current iteration behavior
- Keeps cancellation policy in `runtime.ts`

If returning an iterator would allow accidental mutation only through the attempt records already required by runtime internals, that is acceptable for the internal capability.

Do not add public active-attempt inspection.

### 12. Rewire `runtime.ts` mechanically

Replace direct state-map and active-attempt-map ownership with one store instance:

```ts
const runtimeState = createRuntimeStateStore(graph);
```

Use destructuring only if it remains clear:

```ts
const {
  getMutableState,
  getSnapshot,
  getActiveAttempt,
  setActiveAttempt,
  deleteActiveAttempt,
  getActiveAttempts,
} = createRuntimeStateStore(graph);
```

Then make the smallest mechanical substitutions.

Typical substitutions:

```ts
requireState(key)
```

becomes:

```ts
getMutableState(key)
```

```ts
activeAttempts.get(key)
```

becomes:

```ts
getActiveAttempt(key)
```

```ts
activeAttempts.set(key, attempt)
```

becomes:

```ts
setActiveAttempt(key, attempt)
```

Token-safe cleanup delegates to the store.

Do not rewrite execution, invalidation, subscription, refresh, or scheduler blocks beyond these storage substitutions.

### 13. Preserve private invariant helpers

The R1B helpers remain semantically unchanged:

```ts
hasFreshSuccessfulValue(...)
isSchedulerOnlyAttempt(...)
createRefreshOperationKey(...)
```

Move `hasFreshSuccessfulValue(...)` to `runtime-state.ts` only if it clearly belongs with the mutable state shape and doing so reduces coupling without changing use sites materially.

The safest R3 choice is to keep policy predicates in `runtime.ts` because:

- Fresh-success reuse is execution/scheduler policy.
- Scheduler-only ownership is cancellation policy.
- Refresh-operation identity belongs to operations.

Do not move these helpers merely because their parameter types moved.

Import the internal types they require.

### 14. Preserve observer wiring

R2's observer capability remains unchanged:

```ts
const { notify, onChange } = createRuntimeObserver();
```

Do not:

- Move observer creation into the state store
- Give the state store a `notify()` dependency
- Notify automatically from state access or mutation
- Add observable stores
- Change any of the eleven notification call sites

Storage is deliberately non-observable.

## Behavior that must remain unchanged

### Initial state

- Context nodes begin successful and fresh.
- Data nodes begin idle and stale with their initial value.
- Derived nodes begin idle and stale with `undefined` data.
- Generations begin at zero.
- Successful-value flags are unchanged.

### Runtime isolation

- Two runtimes created from one graph have independent node state.
- Active attempts are never shared between runtimes.
- Observer listeners are never shared between runtimes.
- Refresh operations, subscriptions, and scheduler state remain runtime-local.

### State snapshots

- `getState(...)` remains strongly typed.
- Every call returns a frozen snapshot.
- Consumer mutation cannot alter internal state.
- Existing data and error references are preserved.

### Execution and attempts

- Same-generation work remains deduplicated.
- Origins are added to shared attempts as before.
- Different runtimes never share work.
- New generations do not reuse obsolete work.
- Token-safe cleanup cannot delete newer attempts.
- Abort controllers remain per attempt.
- Obsolete and aborted attempts remain non-business failures.

### Invalidation and refresh

- Context invalidation aborts affected attempts.
- Descendant generations and stale state remain unchanged.
- Refresh supersession remains unchanged.
- Refresh-operation deduplication remains unchanged.
- Descendant invalidation after changed refresh results remains unchanged.

### Subscription cancellation

- Final unsubscribe still iterates active work.
- Scheduler-only attempts are cancelled only when no subscription remains.
- Explicit, prefetch, and refresh ownership still protects work.
- Cancellation policy remains in `runtime.ts`.

### Notification behavior

- All eleven notification points remain unchanged.
- No state-store method notifies.
- Silent operations remain silent.
- Observer snapshot dispatch remains unchanged.

### Validation and errors

- Registered-node validation remains unchanged.
- Missing-state error wording remains unchanged.
- `GraphExecutionError` behavior remains unchanged.
- Synchronous versus asynchronous validation timing remains unchanged.

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not test the private store directly unless a behavior cannot be protected through `GraphRuntime`. Prefer public behavior throughout.

### 1. Preserve initial-state and snapshot coverage

Existing tests should continue to prove:

- Correct context initial state
- Correct data initial state
- Correct derived initial state
- Frozen state snapshots
- Independent runtime state

Add tests only for clearly missing observable behavior.

### 2. Strengthen snapshot independence if missing

Ensure public tests prove:

- Two calls to `getState(...)` return snapshots representing their respective read times.
- A snapshot captured before a committed update does not mutate afterward.
- The later snapshot reflects the update.

Example behavior:

```ts
const before = runtime.getState(Context);
runtime.setContext(Context, 2);
const after = runtime.getState(Context);

expect(before.data).toBe(1);
expect(after.data).toBe(2);
expect(before).not.toBe(after);
```

Prefer extending:

```text
tests/core/runtime-state.spec.ts
```

### 3. Preserve active-attempt behavior

Existing tests must continue to cover:

- Overlapping explicit executions share one attempt.
- Shared ancestors execute once.
- Different runtimes do not share attempts.
- A new generation does not reuse obsolete work.
- Obsolete completion cannot remove or overwrite newer work.
- Explicit and prefetch work can share an attempt.
- Scheduler and prefetch work can share an attempt.
- Refresh supersedes active normal work.
- Final unsubscribe does not cancel caller-owned work.

Add only the smallest missing test.

### 4. Add token-safe cleanup behavior coverage if missing

Ensure one public behavior test proves this race:

1. Start an attempt for generation 0.
2. Supersede it with generation 1.
3. Allow generation 0 to finish after generation 1 has started.
4. Confirm generation 0 cleanup does not remove generation 1 active work.
5. Confirm generation 1 can complete and commit.

Existing race or refresh-interaction tests may already prove this sufficiently. Do not duplicate coverage if it is already explicit.

If a new test is needed, use deferred promises and `waitForCondition(...)`.

Do not use real-time delays or fixed microtask counts.

### 5. Preserve observer and notification behavior

All R2 observer tests must remain unchanged.

Do not modify observation tests unless an import path requires a purely mechanical update, which should not be necessary.

### 6. Type tests

Existing runtime type tests must continue to prove:

- Context state data typing
- Data state data typing
- Derived `T | undefined` typing
- `setContext(...)` typing
- Public methods require no `any`

Do not add public types for the internal store.

Add no new type-test dependency.

### 7. Test restraint

Do not add tests for:

- Private map sizes
- Private store method names
- Private attempt iteration shape
- Internal object freezing of the store capability
- Source-file placement

Test behavior, not implementation details.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A through R1D remain validated offline.
- R2 is marked validated offline.
- R3 implementation is prepared.
- R3 offline validation remains pending.
- R4 through R9 remain incomplete.
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
[ ] R3 offline validation
[ ] R4: Extract the execution controller
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R2 as validated offline
- R3 as prepared with offline validation pending
- R4 through R9 as planned

Add a brief R3 implementation decision under the R3 section:

- Node-state and active-attempt maps moved into one runtime-local closure store.
- Initial state and frozen snapshot creation belong to the store.
- State-transition, attempt-sharing, cancellation, and notification policy remain outside the store.
- The store has no observer or scheduler dependency.

Do not rewrite the R1D ownership contract or R2 observer decision.

### 3. Add an R3 implementation note

Add:

```text
docs/implementation/17-runtime-refactor-r3-state-storage-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Runtime-state store contract
- Initial-state ownership
- Snapshot behavior
- Active-attempt storage behavior
- Token-safe cleanup behavior
- Iteration decision for unsubscribe cancellation
- Explicit boundary between storage and execution policy
- Notification ownership preservation
- Tests added or updated
- Confirmation that public API and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R4
- Next task: R4

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/009-runtime-refactor-r3-extract-runtime-state-storage.md
```

## Out of scope

Do not implement:

- Execution-controller extraction
- Moving `executeNode(...)`
- Moving `executeInternal(...)`
- Moving execution failure classes
- Moving dependency-value access
- Subscription storage extraction
- Subscription lifecycle extraction
- Scheduler extraction
- Invalidation extraction
- Prefetch or refresh extraction
- Runtime composition-root simplification
- Observer changes
- Notification ownership changes
- Automatic state-store notifications
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
- Public state-store APIs
- New public exports

Do not change the R1B invariant semantics, R1C validation semantics, or R2 observer semantics.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-state.ts
src/core/runtime.ts
tests/core/runtime-state.spec.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/17-runtime-refactor-r3-state-storage-implementation-note.md
docs/implementation/prompts/009-runtime-refactor-r3-extract-runtime-state-storage.md
```

Change fewer test files if existing behavior coverage is sufficient.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve public exports exactly.
- Preserve runtime behavior exactly.
- Keep storage runtime-local.
- Keep mutable state private.
- Keep active attempts private.
- Preserve token-safe cleanup.
- Preserve key-based state lookup.
- Preserve frozen typed snapshots.
- Preserve all eleven notification points.
- Keep the state store free of notification policy.
- Keep the state store free of scheduler policy.
- Keep the state store free of execution policy.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging.
- Do not add global state.
- Do not add dependencies.
- Do not expose mutable maps or controllers publicly.
- Do not create a class hierarchy.
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
11. Confirm `runtime-state.ts` is not exported from `src/core/index.ts`.
12. Confirm the mutable node-state shape is unchanged.
13. Confirm `ExecutionOrigin` values are unchanged.
14. Confirm the `ActiveAttempt` shape is unchanged.
15. Confirm node-state and active-attempt maps exist only inside the runtime-state factory.
16. Confirm no module-level mutable state exists.
17. Confirm all registered nodes receive initial state eagerly.
18. Confirm initial-state values match the validated baseline for all node kinds.
19. Confirm public snapshots remain fresh frozen objects.
20. Confirm missing state still throws with the node key.
21. Confirm token-safe deletion checks the currently stored token.
22. Confirm attempt-sharing and cancellation policy remain in `runtime.ts`.
23. Confirm generation advancement and state-transition assignments remain in `runtime.ts`.
24. Confirm the state store has no observer, scheduler, graph mutation, or notification dependency beyond graph use for initialization.
25. Confirm R2 observer source and semantics are unchanged.
26. Confirm all eleven notification ownership points remain semantically present.
27. Confirm validation timing and error behavior remain unchanged.
28. Confirm no R4 or later responsibility moved out of `runtime.ts`.
29. Confirm R3 is validation pending and R4 through R9 remain incomplete.
30. Create a ZIP containing only R3 files added or changed.
31. Validate ZIP integrity and contents before responding.

Use a mechanical source reconstruction or focused diff inspection to prove that `runtime.ts` changes are limited to:

- Internal type imports
- Store construction
- State lookup substitutions
- Snapshot delegation
- Active-attempt storage substitutions
- Removal of the extracted map and helper definitions

These checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R3 ZIP, run from the repository root:

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

R3 is ready for offline validation when:

- One closure-based runtime-state store exists.
- Node-state storage is private and runtime-local.
- Active-attempt storage is private and runtime-local.
- Initial state is created eagerly for every registered node.
- Context, data, and derived initial semantics are unchanged.
- Typed state snapshots remain fresh and frozen.
- Missing-state behavior is unchanged.
- Active-attempt lookup and insertion preserve existing behavior.
- Token-safe cleanup cannot delete newer work.
- Final-unsubscribe cancellation can inspect active attempts without owning the map.
- Execution, origin-sharing, cancellation, generation, invalidation, and notification policy remain outside the store.
- R1B invariants remain semantically unchanged.
- R1C validation behavior remains unchanged.
- R2 observer behavior remains unchanged.
- All eleven notification ownership points remain unchanged.
- Public APIs and exports are unchanged.
- Behavior-focused tests protect snapshot independence and active-attempt races.
- R3 is marked prepared with offline validation pending.
- R4 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R3 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- State, snapshot, execution-deduplication, cancellation, and race behavior remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R3.
2. A ZIP containing only R3 files added or changed.
3. Files added and changed.
4. The internal runtime-state store contract.
5. Initial-state and snapshot decisions.
6. Active-attempt lookup, iteration, and token-safe cleanup decisions.
7. Confirmation that execution and cancellation policy remain outside the store.
8. Tests added or updated.
9. Confirmation that public APIs, exports, R1B invariants, R1C validation, R2 observation, notification timing, and runtime behavior were intentionally preserved.
10. Static checks and results.
11. Project commands marked `Not run in contained environment`.
12. Exact offline validation steps.
13. The next planned task: R4.
