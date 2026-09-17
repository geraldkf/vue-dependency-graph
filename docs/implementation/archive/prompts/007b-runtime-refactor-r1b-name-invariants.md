# Implementation Prompt 007B: Name Existing Runtime Invariants

## Role

You are implementing **R1B** of the runtime composition refactor for `vue-dependency-graph`.

R1A has been validated offline. The repository documentation and roadmap now accurately record Milestone 3 as complete and define the staged runtime composition refactor.

R1B is a small, behavior-preserving source cleanup. Its purpose is to replace important inline runtime conditions with clearly named private helpers before responsibilities are extracted in later tasks.

Implement only these private invariants:

- Fresh successful value detection
- Scheduler-only attempt ownership detection
- Deterministic refresh-operation key creation

Do not start R1C, R1D, R2, or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/12-runtime-refactor-r1a-cleanup-implementation-note.md`
- `src/core/runtime.ts`
- `src/core/execution.ts`
- `src/core/index.ts`
- `tests/core/execution-order.spec.ts`
- `tests/core/execution-failure.spec.ts`
- `tests/core/node-subscription-registration.spec.ts`
- `tests/core/scheduler-cancellation.spec.ts`
- `tests/core/scheduler-subscription.spec.ts`
- `tests/core/scheduler-failure.spec.ts`
- `tests/core/prefetch-interaction.spec.ts`
- `tests/core/refresh-interaction.spec.ts`
- `tests/core/refresh.spec.ts`
- `tests/core/test-helpers.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

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

1. Apply only the R1B changes described below.
2. Perform dependency-free static inspection.
3. Preserve the public API and runtime behavior.
4. Return a ZIP containing only files added or changed for R1B.
5. Provide exact offline validation commands.
6. Report project commands as `Not run in contained environment`.

No file deletion is expected for R1B. Do not create a deletion manifest unless an unexpected obsolete R1B-specific file must be removed.

## Objective

Make three important runtime rules explicit and reusable without changing behavior:

```ts
hasFreshSuccessfulValue(...)
isSchedulerOnlyAttempt(...)
createRefreshOperationKey(...)
```

These helpers will make later capability extraction safer by giving key invariants stable names and clear ownership.

## Public API constraint

The public API must remain unchanged:

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

Do not change exports from:

```text
src/core/index.ts
src/index.ts
```

## Required source changes

### 1. Add `hasFreshSuccessfulValue(...)`

The runtime currently relies on this exact invariant:

```ts
state.hasSuccessfulValue &&
state.status === "success" &&
state.freshness === "fresh"
```

Add one private helper in `src/core/runtime.ts`:

```ts
const hasFreshSuccessfulValue = (
  state: MutableNodeRuntimeState
): boolean =>
  state.hasSuccessfulValue &&
  state.status === "success" &&
  state.freshness === "fresh";
```

A small naming variation is acceptable only if it is clearer and remains precise.

Use the helper wherever the complete invariant is currently repeated, including at minimum:

- Reusing a fresh node in node execution
- Selecting subscribed scheduler targets that need work

Required semantics:

- A successful fresh value is reusable.
- A stale successful value is not reusable for execution planning.
- An error node is not treated as fresh and successful.
- A node with `hasSuccessfulValue: false` is not reusable even if another field is inconsistent.

Do not replace weaker checks that intentionally use only:

```ts
state.hasSuccessfulValue
```

Examples of weaker checks that should remain conceptually separate include:

- Choosing `loading` versus `refreshing`
- Preserving prior data after failure
- Choosing an initial versus post-success state transition

The helper must remain private to `runtime.ts` in R1B.

Do not export it or move it into a new file.

### 2. Add `isSchedulerOnlyAttempt(...)`

The current unsubscribe cancellation rule identifies scheduler-only attempts by checking the scheduler origin and excluding each caller-owned origin separately.

Add one private helper:

```ts
const isSchedulerOnlyAttempt = (
  attempt: ActiveAttempt
): boolean =>
  attempt.origins.size === 1 &&
  attempt.origins.has("scheduler");
```

Use it in final-unsubscribe cancellation logic.

Required semantics:

- An attempt whose only origin is `scheduler` is scheduler-only.
- An attempt owned by `scheduler` and `explicit` is not scheduler-only.
- An attempt owned by `scheduler` and `prefetch` is not scheduler-only.
- An attempt owned by `scheduler` and `refresh` is not scheduler-only.
- An attempt owned only by a caller origin is not scheduler-only.
- Future execution origins are automatically protected because scheduler-only ownership requires exactly one origin.

Do not change:

- `ExecutionOrigin`
- The active-attempt origin set
- Attempt sharing behavior
- Final-unsubscribe cancellation timing
- Context-invalidation cancellation behavior

The helper must remain private to `runtime.ts` in R1B.

Do not export it or move execution ownership into `execution.ts` yet. That belongs to R4.

### 3. Add `createRefreshOperationKey(...)`

The runtime deduplicates overlapping refresh operations by target-key set.

Add one private helper:

```ts
const createRefreshOperationKey = (
  keys: ReadonlySet<string>
): string => JSON.stringify([...keys].sort());
```

Use it when looking up and storing refresh operations.

Required semantics:

- Target order does not affect the operation key.
- Duplicate requested targets do not affect the key because target validation already deduplicates keys.
- Different target sets do not collide due to a separator appearing inside a node key.
- Empty refresh resolves before a key is created.
- A later refresh after the previous operation settles creates a new operation.

Use an unambiguous representation. Do not retain sentinel-character joining such as:

```ts
[...keys].sort().join("\u0000")
```

The helper must remain private to `runtime.ts` in R1B.

Do not create a generic operation-key utility or new module.

## Behavior that must remain unchanged

### Fresh-value reuse

- Explicit execution skips successful fresh nodes.
- Scheduler execution skips successful fresh subscribed nodes.
- Prefetch skips successful fresh nodes.
- Stale successful nodes remain eligible for execution.
- Failed nodes remain eligible when a new externally triggered attempt occurs.

### Attempt ownership and cancellation

- Final unsubscribe aborts scheduler-only work that is no longer required.
- Work remains active while another subscriber requires it.
- Explicitly owned work survives final unsubscribe.
- Prefetch-owned work survives final unsubscribe.
- Refresh-owned work survives final unsubscribe.
- Context invalidation may still abort obsolete affected work regardless of origin.

### Refresh-operation deduplication

- Overlapping refresh calls for the same target set share one refresh operation.
- Target order does not affect sharing.
- Duplicate targets do not affect sharing.
- Different target sets remain independent.
- A refresh after settlement runs again.

### Public and architectural behavior

- One execution engine remains.
- `whenSettled()` remains scheduler-specific.
- Prefetch and refresh remain caller-owned operations.
- Runtime observation timing remains unchanged.
- Registered-node validation remains unchanged.

## Tests

Use behavior-focused tests through `createGraphRuntime(...)`. Do not directly test private helpers.

Retain all existing tests and assertions.

### 1. Fresh-success behavior

Existing tests should continue to prove:

- Repeated explicit execution does not reload a successful fresh node.
- A later subscription does not reload a successfully prefetched fresh node.
- Automatic scheduler execution does not reload an already fresh subscribed node.
- Context invalidation makes affected subscribed descendants executable again.
- A scheduler failure can be retried after a new external trigger.

Add a new test only if one of these behaviors is not already covered clearly.

Do not add tests merely to mirror the private helper's boolean truth table.

### 2. Scheduler-only cancellation behavior

Confirm tests cover all relevant ownership cases:

- Scheduler-only work is aborted after final unsubscribe.
- Scheduler plus explicit ownership survives unsubscribe.
- Scheduler plus prefetch ownership survives unsubscribe.
- Scheduler plus refresh ownership survives unsubscribe.
- Work remains active while another subscription remains.

Existing tests already cover several of these paths. Add only the smallest missing behavior-focused case.

Prefer extending the most relevant existing files:

```text
tests/core/scheduler-cancellation.spec.ts
tests/core/prefetch-interaction.spec.ts
tests/core/refresh-interaction.spec.ts
```

Do not create a private-origin unit-test file.

### 3. Refresh-operation key behavior

Ensure behavior tests prove:

```ts
runtime.refresh([Left, Right]);
runtime.refresh([Right, Left]);
```

share one overlapping operation.

Also prove:

- Duplicate targets in an overlapping call share the same operation.
- Distinct target sets do not incorrectly share one operation.
- A later refresh after settlement executes again.

Use deferred promises and `waitForCondition(...)`.

Do not use:

- Real-time delays
- Fake timers unless already necessary
- Fixed microtask-count assumptions
- Assertions against the private key string

Prefer updating:

```text
tests/core/refresh-interaction.spec.ts
```

### 4. Test-change restraint

Do not weaken or broadly rewrite existing tests.

Do not change tests unrelated to the three named invariants.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A remains validated offline.
- R1B implementation is prepared.
- R1B offline validation remains pending.
- R1C through R9 remain incomplete.
- The overall runtime composition refactor remains incomplete.
- Milestone 4 remains not started.

A reasonable checklist is:

```text
[x] R1A implementation: Documentation and repository cleanup
[x] R1A offline validation
[x] R1B implementation: Name existing runtime invariants
[ ] R1B offline validation
[ ] R1C: Standardise registered-node validation
[ ] R1D: Document notification ownership
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A as validated offline
- R1B as prepared with offline validation pending
- R1C and later tasks as planned

Do not add notification ownership rules. That belongs to R1D.

Do not add capability extraction design beyond what is already documented.

### 3. Add an R1B implementation note

Add:

```text
docs/implementation/13-runtime-refactor-r1b-invariants-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- `hasFreshSuccessfulValue(...)` semantics
- `isSchedulerOnlyAttempt(...)` semantics
- `createRefreshOperationKey(...)` semantics
- Tests added or updated
- Explicit confirmation that behavior and public API were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Next task: R1C

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/007b-runtime-refactor-r1b-name-invariants.md
```

## Out of scope

Do not implement:

- Registered-node validation refactoring
- Notification ownership documentation
- Notification timing changes
- Runtime observer extraction
- Runtime state extraction
- Active-attempt storage extraction
- Execution-controller extraction
- Subscription-controller extraction
- Scheduler extraction
- Invalidation extraction
- Prefetch or refresh extraction
- Runtime assembly restructuring
- Fluent builders
- Dependency-injection containers
- Public controller APIs
- Public API changes
- New public exports
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

Do not create new implementation modules in R1B.

The only expected source implementation change is:

```text
src/core/runtime.ts
```

## Expected changed files

Likely changed or added files:

```text
src/core/runtime.ts
tests/core/scheduler-cancellation.spec.ts
tests/core/prefetch-interaction.spec.ts
tests/core/refresh-interaction.spec.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/13-runtime-refactor-r1b-invariants-implementation-note.md
docs/implementation/prompts/007b-runtime-refactor-r1b-name-invariants.md
```

Change fewer test files if existing coverage is already sufficient.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve behavior exactly.
- Preserve the public API exactly.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging to core source.
- Do not add global state.
- Do not add dependencies.
- Do not export private helpers.
- Do not move responsibilities between files.
- Keep one execution engine.
- Keep operation ownership private.
- Keep `whenSettled()` scheduler-specific.
- Keep registered-node validation unchanged.
- Keep notification behavior unchanged.
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
11. Confirm `hasFreshSuccessfulValue(...)` is private.
12. Confirm it is used only where the complete fresh-success invariant is intended.
13. Confirm weaker `hasSuccessfulValue` checks remain where needed.
14. Confirm `isSchedulerOnlyAttempt(...)` is private.
15. Confirm final-unsubscribe cancellation no longer enumerates every non-scheduler origin.
16. Confirm `ExecutionOrigin` and `ActiveAttempt` remain private and structurally unchanged except for helper usage.
17. Confirm `createRefreshOperationKey(...)` is private.
18. Confirm refresh-operation keys use deterministic JSON encoding of sorted unique keys.
19. Confirm no registered-node validation code changed.
20. Confirm no notification code or timing changed.
21. Confirm no major runtime responsibility moved to another file.
22. Confirm no later milestone feature was introduced.
23. Confirm R1B is validation pending and later refactor tasks remain incomplete.
24. Create a ZIP containing only R1B files added or changed.
25. Validate ZIP integrity and contents before responding.

These checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R1B ZIP, run from the repository root:

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

R1B is ready for offline validation when:

- `hasFreshSuccessfulValue(...)` names the exact reusable-value invariant.
- Execution and scheduler target selection use that helper.
- Weaker successful-value checks remain unchanged where intentional.
- `isSchedulerOnlyAttempt(...)` identifies exactly one scheduler origin.
- Final-unsubscribe cancellation uses that helper.
- Caller-owned attempts remain protected.
- `createRefreshOperationKey(...)` uses deterministic JSON encoding of sorted target keys.
- Overlapping refreshes are order-independent.
- Duplicate targets do not create separate operations.
- Distinct target sets remain independent.
- A later refresh after settlement runs again.
- Behavior-focused tests cover the relevant invariants.
- The public API and exports are unchanged.
- Registered-node validation is unchanged.
- Notification behavior is unchanged.
- No responsibility extraction occurred.
- R1B is marked prepared with offline validation pending.
- R1C through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R1B is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Runtime behavior remains unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R1B.
2. A ZIP containing only R1B files added or changed.
3. Files added and changed.
4. Named invariants introduced.
5. Behavioral tests added or updated.
6. Confirmation that public API, exports, validation, notification behavior, and runtime behavior were intentionally preserved.
7. Static checks and results.
8. Project commands marked `Not run in contained environment`.
9. Exact offline validation steps.
10. The next planned task: R1C.
