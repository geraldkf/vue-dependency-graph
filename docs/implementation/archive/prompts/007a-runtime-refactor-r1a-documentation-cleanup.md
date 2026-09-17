# Implementation Prompt 007A: Documentation and Repository Cleanup

## Role

You are implementing **R1A** of the runtime composition refactor for `vue-dependency-graph`.

Milestone 3, including Step 3C, has been validated offline. This task establishes an accurate documentation and repository baseline before any runtime implementation refactoring begins.

R1A is intentionally limited to:

- Documentation status updates
- Active documentation corrections
- Test-description wording corrections
- Refactor roadmap and plan documentation
- Removal of one obsolete duplicate prompt

Do not modify runtime implementation logic in this task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/10-prefetch-and-refresh-implementation-note.md`
- All files under `docs/implementation/prompts` whose names begin with `005-`
- `tests/core/node-subscription-lifecycle.spec.ts`
- `tests/core/node-subscription-propagation.spec.ts`

If the repository differs from this prompt, state the discrepancy and make the smallest reasonable adjustment.

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

1. Apply only the R1A changes described below.
2. Perform dependency-free static inspection.
3. Return a ZIP containing only files added or changed for R1A.
4. Include `refactor-deletions.txt` for the obsolete file.
5. Validate ZIP integrity and contents.
6. Provide exact offline validation commands.
7. Report project commands as `Not run in contained environment`.

## Public API and behavior constraint

R1A must not change runtime behavior or public APIs.

Do not modify files under:

```text
src/
```

The only test-file changes permitted are description-string corrections. Do not change test setup, actions, assertions, mocks, timing, or helper usage.

The following public API remains unchanged:

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

## Objective

Create an accurate documentation baseline and record the staged runtime composition refactor before beginning runtime source changes.

## Required changes

### 1. Mark Step 3C as validated

Update:

```text
docs/implementation/01-roadmap.md
```

Required changes:

- Change Step 3C status to `Validated offline`.
- Mark successful Step 3C offline validation feedback complete.
- Record Milestone 3 as complete.
- Keep Milestone 4 incomplete and not started.

Do not alter completed Step 3A or Step 3B behavior descriptions.

### 2. Update the Step 3C implementation note

Update:

```text
docs/implementation/10-prefetch-and-refresh-implementation-note.md
```

Required changes:

- Set status to `Validated offline`.
- Replace statements claiming type checking, tests, build, or playground startup were not run.
- State that boundary checks, type checking, tests, build, and playground startup were reported successful.

Do not rewrite the technical implementation decisions.

### 3. Add the runtime composition refactor plan

Add:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

The plan must record this sequence:

```text
R1A  Documentation and repository cleanup
R1B  Name existing runtime invariants
R1C  Standardise registered-node validation
R1D  Document notification ownership
R2   Extract runtime observation
R3   Extract runtime state and active-attempt storage
R4   Extract the execution controller
R5   Extract subscription storage and lifecycle
R6   Extract the automatic scheduler
R7   Extract invalidation and context updates
R8   Extract prefetch and refresh operations
R9   Simplify runtime assembly and document internal boundaries
```

Document these decisions:

- Preserve the public `GraphRuntime` API.
- Preserve behavior throughout the refactor.
- Use closure-based `createX(...)` factories.
- Use narrow structural interfaces between internal capabilities.
- Keep `createGraphRuntime(...)` as the explicit composition root.
- Keep one private execution engine.
- Do not introduce fluent internal builders.
- Do not introduce a dependency-injection container.
- Do not expose internal controllers publicly.
- Validate every refactor task independently before continuing.

Do not include implementation code for future tasks beyond small illustrative signatures where helpful.

### 4. Add the refactor sequence to the roadmap

In:

```text
docs/implementation/01-roadmap.md
```

Add a new section before Milestone 4:

```text
Runtime composition refactor
```

Required status:

```text
R1A prepared; offline validation pending
```

Checklist:

```text
[x] R1A implementation: Documentation and repository cleanup
[ ] R1A offline validation
[ ] R1B: Name existing runtime invariants
[ ] R1C: Standardise registered-node validation
[ ] R1D: Document notification ownership
[ ] R2: Extract runtime observation
[ ] R3: Extract runtime state and active-attempt storage
[ ] R4: Extract the execution controller
[ ] R5: Extract subscription storage and lifecycle
[ ] R6: Extract the automatic scheduler
[ ] R7: Extract invalidation and context updates
[ ] R8: Extract prefetch and refresh operations
[ ] R9: Simplify runtime assembly and document internal boundaries
```

State explicitly that:

- The refactor is behavior-preserving.
- The public API remains unchanged.
- Milestone 4 has not started.

### 5. Correct malformed test descriptions

Update description strings only in:

```text
tests/core/node-subscription-lifecycle.spec.ts
tests/core/node-subscription-propagation.spec.ts
```

Replace:

```text
node node subscription lifecycle
node node subscription propagation
```

with:

```text
node subscription lifecycle
node subscription propagation
```

Do not modify executable test behavior.

### 6. Correct active documentation drift

Review active documentation only. Do not rewrite historical implementation prompts.

At minimum, correct these outdated statements where present:

#### Old terminology

```text
demand based loading
```

Use:

```text
subscription-driven loading
```

#### Context update behavior

Do not state that context updates never cause later automatic execution.

Use the current behavior:

- Context updates synchronously invalidate descendants.
- Affected subscribed descendants request automatic scheduler work.
- Affected unsubscribed descendants remain stale without loading.

#### Node subscription behavior

Do not state that node subscription never schedules work.

Use the current behavior:

- `subscribeNodes(...)` does not invoke loaders synchronously.
- A non-empty subscription requests a coalesced scheduler microtask.
- The scheduler automatically executes subscribed stale nodes and required ancestors.

#### Prefetch and refresh

Do not list prefetch and refresh as unimplemented.

Use:

```ts
await runtime.prefetch([Targets]);
await runtime.refresh([Targets]);
```

State that both APIs are implemented on `GraphRuntime`.

#### Scheduler settlement

Document that:

```ts
await runtime.whenSettled();
```

represents scheduler quiescence only. Callers await `prefetch(...)` and `refresh(...)` directly.

Likely active documentation files include:

```text
docs/ARCHITECTURE.md
docs/api/01-proposed-api.md
docs/architecture/01-system-overview.md
docs/architecture/03-scheduler-transactions-and-concurrency.md
```

Change only files containing inaccurate current behavior.

### 7. Remove the obsolete duplicate Step 3B prompt

The repository contains:

```text
docs/implementation/prompts/005-implement-automatic-node-subscription-scheduler.md
docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md
```

Keep the canonical file:

```text
docs/implementation/prompts/005-implement-automatic-node-subscription-scheduler.md
```

Delete the obsolete duplicate:

```text
docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md
```

Because ZIP extraction does not delete local files, add:

```text
refactor-deletions.txt
```

with exactly this repository-relative entry:

```text
docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md
```

Do not delete other historical prompts.

### 8. Add an R1A implementation note

Add:

```text
docs/implementation/12-runtime-refactor-r1a-cleanup-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- File deleted
- Documentation corrections
- Explicit confirmation that no runtime source or public API changed
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Next task: R1B

### 9. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/007a-runtime-refactor-r1a-documentation-cleanup.md
```

## Out of scope

Do not implement:

- Private runtime helper predicates
- Registered-node validation changes
- Notification ownership rules
- Runtime observation extraction
- Runtime state extraction
- Execution extraction
- Subscription extraction
- Scheduler extraction
- Invalidation extraction
- Operations extraction
- Runtime assembly restructuring
- Fluent builders
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

Do not modify any file under `src/`.

## Expected changed files

Likely changed or added files:

```text
tests/core/node-subscription-lifecycle.spec.ts
tests/core/node-subscription-propagation.spec.ts
docs/ARCHITECTURE.md
docs/api/01-proposed-api.md
docs/architecture/01-system-overview.md
docs/architecture/03-scheduler-transactions-and-concurrency.md
docs/implementation/01-roadmap.md
docs/implementation/10-prefetch-and-refresh-implementation-note.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/12-runtime-refactor-r1a-cleanup-implementation-note.md
docs/implementation/prompts/007a-runtime-refactor-r1a-documentation-cleanup.md
refactor-deletions.txt
```

Change fewer files if some are already accurate. Do not modify unrelated files just to match this list.

Expected deletion:

```text
docs/implementation/prompts/005-implement-automatic-subscription-scheduler.md
```

## Static inspection

Perform these dependency-free checks:

1. List all changed, added, and deleted files.
2. Confirm no files under `src/` changed.
3. Confirm test-file changes affect description strings only.
4. Parse available JSON configuration files.
5. Run the dependency-free core boundary check if available.
6. Search active source, tests, and documentation outside historical prompts for:

```text
node node subscription
demand based loading
```

7. Confirm active API documentation does not list runtime prefetch or refresh as unimplemented.
8. Confirm Step 3C is marked validated offline.
9. Confirm Milestone 3 is marked complete.
10. Confirm R1A is prepared with offline validation pending.
11. Confirm R1B through R9 remain incomplete.
12. Confirm the canonical Step 3B prompt remains present.
13. Confirm the obsolete Step 3B prompt is listed in `refactor-deletions.txt`.
14. Confirm no runtime implementation prompt was rewritten unnecessarily.
15. Create a ZIP containing only R1A files added or changed plus `refactor-deletions.txt`.
16. Validate ZIP integrity and contents.

These checks do not prove that type checking, tests, build, or runtime validation succeeds.

## Offline validation

After applying the R1A ZIP, delete each path listed in:

```text
refactor-deletions.txt
```

Then run:

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

Verify the obsolete prompt is absent:

```powershell
Test-Path -LiteralPath `
    ".\docs\implementation\prompts\005-implement-automatic-subscription-scheduler.md"
```

Expected output:

```text
False
```

If tests fail, capture the complete output:

```powershell
pnpm test:run --reporter verbose --no-color 2>&1 |
    Tee-Object -FilePath ".\unit-test-output.log"
```

## Prepared acceptance criteria

R1A is ready for offline validation when:

- Step 3C is marked validated offline.
- Milestone 3 is marked complete.
- The refactor sequence is documented before Milestone 4.
- R1A is prepared with offline validation pending.
- R1B through R9 remain incomplete.
- Malformed node-subscription test descriptions are corrected.
- Active documentation accurately describes current subscription scheduling, context invalidation, prefetch, refresh, and scheduler settlement behavior.
- The obsolete duplicate Step 3B prompt is listed for deletion.
- The canonical Step 3B prompt remains.
- No file under `src/` changed.
- Test behavior is unchanged.
- No public API changed.
- Static checks pass.
- A validated changes-only ZIP and deletion manifest are returned.

## Validated acceptance criteria

R1A is complete only after the developer reports:

- The obsolete prompt was deleted.
- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No runtime behavior changed.

## Expected completion response

Provide:

1. A concise summary of R1A.
2. A ZIP containing only R1A files added or changed.
3. `refactor-deletions.txt` and explicit deletion instructions.
4. Files added, changed, and deleted.
5. Documentation and wording corrections.
6. Confirmation that no runtime source, test behavior, or public API changed.
7. Static checks and results.
8. Project commands marked `Not run in contained environment`.
9. Exact offline validation steps.
10. The next planned task: R1B.
