# Implementation Prompt 007D: Document Notification Ownership

## Role

You are implementing **R1D** of the runtime composition refactor for `vue-dependency-graph`.

R1A, R1B, and R1C have been validated offline.

The repository now has:

- Accurate Milestone 3 documentation
- A staged runtime composition refactor plan
- Named private runtime invariants
- Standardised private registered-node validation

R1D is a **documentation-only contract task**. Its purpose is to document the runtime's existing notification ownership and observable transition rules before runtime observation is extracted in R2.

R1D must not change notification behavior, runtime implementation, tests, public APIs, or exports.

Do not start R2 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/14-runtime-refactor-r1c-validation-implementation-note.md`
- `src/core/runtime.ts`
- `src/core/scheduler.ts`
- `src/core/subscription.ts`
- `tests/core/runtime-state.spec.ts`
- `tests/core/runtime-context.spec.ts`
- `tests/core/runtime-races.spec.ts`
- `tests/core/node-subscription-lifecycle.spec.ts`
- `tests/core/scheduler-settlement.spec.ts`
- `tests/core/scheduler-failure.spec.ts`
- `tests/core/prefetch.spec.ts`
- `tests/core/refresh.spec.ts`
- `tests/core/refresh-descendants.spec.ts`
- `tests/core/refresh-interaction.spec.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

If the repository differs from this prompt, document the discrepancy and make the smallest reasonable adjustment. Do not infer behavior that is not supported by source or tests.

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

1. Apply only the R1D documentation changes described below.
2. Perform dependency-free static inspection.
3. Preserve all source and test files byte-for-byte.
4. Preserve public APIs and exports.
5. Return a ZIP containing only files added or changed for R1D.
6. Provide exact offline validation commands.
7. Report project commands as `Not run in contained environment`.

No file deletion is expected for R1D.

## Objective

Document this internal ownership rule:

> A capability notifies after it commits an externally observable runtime transition. Its caller does not notify again for the same transition.

The documentation must describe the current behavior precisely enough that R2 can extract runtime observation without changing externally observable semantics.

R1D documents existing behavior only. It does not define new notification behavior.

## Public API constraint

The public API remains unchanged:

```ts
const stopObserving = runtime.onChange(() => {
  const state = runtime.getState(Targets);
});

stopObserving();
```

Do not add:

- Node-specific listeners
- Scheduler-specific listeners
- Prefetch callbacks
- Refresh callbacks
- Event-emitter APIs
- Vue reactive APIs
- Diagnostic streams
- Notification payloads
- Public observer types beyond existing contracts

Do not change exports from:

```text
src/core/index.ts
src/index.ts
```

## Source and test constraint

Do not modify any file under:

```text
src/
tests/
```

R1D is documentation-only.

If the documentation review discovers a source/test inconsistency, report it in the implementation note as a risk for R2. Do not fix it in R1D.

## Required documentation changes

### 1. Add notification ownership to the refactor plan

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Add a focused section titled close to:

```text
Notification ownership contract
```

Document the primary rule:

> A capability notifies after it commits an externally observable runtime transition. Its caller does not notify again for the same transition.

Document why this rule matters:

- It prevents duplicate notifications when capabilities are extracted.
- It keeps notification timing owned by the capability that commits state.
- It avoids callers needing knowledge of another capability's internal transitions.
- It provides a stable contract for R2 observation extraction.
- It does not imply one notification per public API call.

### 2. Document listener lifecycle

Document the current `onChange(...)` contract:

- `onChange(listener)` registers a graph-runtime listener.
- The returned stop function is idempotent.
- An active listener is called after committed observable transitions.
- A stopped listener is not called again.
- One listener throwing does not prevent other listeners from running.
- Listener failures do not roll back committed runtime state.
- Listener failures are not logged by core code.
- Listeners receive no mutable internal state.
- Listeners inspect current state through public runtime methods.

Use an example close to:

```ts
const stopObserving = runtime.onChange(() => {
  const node = runtime.getState(Targets);
  const scheduler = runtime.getSchedulerState();
});

stopObserving();
```

Do not imply that listeners receive a transition payload.

### 3. Document subscription notification ownership

Document the current subscription behavior:

- A successful non-empty subscription notifies after direct and required counts are committed.
- An active non-empty unsubscribe notifies after its counts are removed.
- Empty subscription is silent.
- Repeated idempotent unsubscribe is silent.
- Failed subscription validation is silent because no state was committed.
- Schedule requests caused by subscription are separate from the subscription-count notification.
- Subscription code owns notification for subscription-count transitions.

Do not specify a brittle exact total listener-call count for the entire subsequent scheduler lifecycle.

### 4. Document context and invalidation notification ownership

Document the current context-update behavior:

- `Object.is` equal context updates are silent.
- A changed context value is committed synchronously.
- Descendant invalidation is committed before the context-update notification.
- The notification exposes the committed context and invalidated descendant state together.
- Affected attempts may be aborted as part of invalidation.
- A scheduler request for affected subscribed descendants is separate from the context-state notification.
- Invalid context validation is silent because no state was committed.
- Context/invalidation code owns notification for its committed state transition.

Do not describe transaction batching. Transactions remain Milestone 4.

### 5. Document execution notification ownership

Document execution notifications:

- Attempt start notifies after status changes to `loading` or `refreshing` and the previous error is cleared.
- Successful execution notifies after data, status, freshness, error, and successful-value state are committed.
- Direct execution failure notifies after error state is committed.
- Obsolete, aborted, or superseded results do not commit business state and do not notify as success or failure.
- Blocked descendants do not receive a node-state transition merely because they are reported in `GraphExecutionError`.
- The execution capability owns notifications for attempt start, committed success, and committed failure.

Do not document exact internal promise ordering unless source and tests explicitly make it contractual.

### 6. Document refresh and descendant invalidation notifications

Document current refresh behavior carefully:

- Refresh preparation marks targets stale and advances applicable generations before execution starts.
- The existing runtime emits a notification after refresh preparation is committed.
- Execution then owns its normal attempt-start, success, and failure notifications.
- A changed successful refresh result may cause a later committed descendant-invalidation notification.
- An `Object.is` equal refresh result does not invalidate descendants and therefore does not produce a descendant-invalidation notification.
- Failed refresh validation is silent because no generation or state was committed.
- Empty refresh is silent.

State explicitly:

> One refresh operation may produce multiple notifications because it commits multiple externally observable transitions.

Do not promise one notification per refresh call.

### 7. Document prefetch notifications

Document:

- Prefetch uses the existing execution transitions.
- Prefetch has no separate callback or notification channel.
- Empty prefetch is silent.
- Missing-target validation is silent because no execution state is committed.
- A successful fresh target skipped by prefetch produces no execution transition.
- Actual prefetch execution uses normal attempt-start, success, and failure notifications.

### 8. Document scheduler notification ownership

Document public scheduler-state transitions:

- Requesting an idle scheduler flush commits `isScheduled: true` and notifies.
- Starting a flush commits scheduled/running state and notifies.
- A new scheduler attempt clears the previous scheduler error as part of its committed start state.
- Successful completion commits `isRunning: false` and notifies.
- Failed automatic execution commits scheduler error and stopped state before completion notification.
- A schedule request during an active flush records a follow-up requirement; document only observable scheduler-state transitions, not incidental private flag changes.
- Scheduler notifications do not recursively request scheduler work.
- `whenSettled()` resolving does not itself require a separate runtime notification.
- The scheduler owns notifications for public `SchedulerState` transitions.

Avoid documenting exact listener-call counts for a full flush. Tests should assert observable state progression rather than incidental counts.

### 9. Document silent operations and discarded results

Include a concise list of operations that are intentionally silent when no state is committed:

- Equal context update
- Empty subscription
- Repeated unsubscribe
- Empty execution
- Empty prefetch
- Empty refresh
- Validation failure before mutation
- Fresh successful node skipped by execution
- Obsolete result discarded without commit
- Calling an idempotent `onChange(...)` stop function again
- `whenSettled()` resolving without a scheduler-state transition

Only include an item when it matches current source behavior.

### 10. Document non-contractual details

State that the following are not guaranteed public contracts:

- Exact total listener-call count for a multi-stage public operation
- Internal ordering between unrelated branches
- Internal microtask count
- Private scheduler follow-up flag transitions
- Private attempt tokens or origins
- Mutable state-map structure
- Which internal helper calls `notify()` after future extraction

The stable contract is committed observable state, not the current physical location of the call.

### 11. Update roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A remains validated offline.
- R1B remains validated offline.
- R1C is marked validated offline.
- R1D implementation is prepared.
- R1D offline validation remains pending.
- R2 through R9 remain incomplete.
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
[ ] R1D offline validation
[ ] R2: Extract runtime observation
...
```

### 12. Update refactor-plan status

In:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A as validated offline
- R1B as validated offline
- R1C as validated offline
- R1D as prepared with offline validation pending
- R2 and later tasks as planned

### 13. Add an R1D implementation note

Add:

```text
docs/implementation/15-runtime-refactor-r1d-notification-ownership-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Primary notification ownership rule
- Listener lifecycle contract
- Capability ownership summary
- Silent-operation summary
- Non-contractual details
- Explicit confirmation that source, tests, public APIs, exports, and behavior were unchanged
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and requirements for R2
- Next task: R2

### 14. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/007d-runtime-refactor-r1d-notification-ownership.md
```

## Capability ownership summary

The documentation should provide a concise ownership map:

### Subscription lifecycle

Owns notification after subscription counts are committed.

### Context and invalidation

Owns notification after context and descendant invalidation state are committed.

### Execution

Owns notification after attempt start, committed success, and committed failure.

### Refresh preparation

Owns notification after target generations and stale state are committed.

### Scheduler

Owns notification after public scheduler state changes.

### Runtime observer

Owns listener registration, idempotent removal, dispatch, and listener-failure isolation.

The observer does not decide when domain/runtime state is ready to notify. The capability committing the state decides when to call it.

## R2 requirements established by R1D

Document these requirements for R2:

- Extract listener storage and dispatch only.
- Preserve all current call sites initially.
- Preserve listener registration order.
- Preserve snapshot-at-dispatch behavior if listeners are copied before iteration.
- Preserve listener failure isolation.
- Preserve idempotent listener removal.
- Preserve silence for discarded or no-op operations.
- Do not batch, debounce, coalesce, or defer notifications.
- Do not introduce payloads.
- Do not add node-specific observation.
- Do not change scheduler triggering.
- Do not move notification ownership between capabilities as part of R2.

If source inspection shows a requirement differs, document the actual current behavior rather than inventing a desired one.

## Out of scope

Do not implement:

- Runtime observer extraction
- Runtime state extraction
- Active-attempt storage extraction
- Execution-controller extraction
- Subscription-controller extraction
- Scheduler extraction
- Invalidation extraction
- Operations extraction
- Runtime assembly restructuring
- Notification batching
- Notification debouncing
- Notification coalescing
- Notification payloads
- Node-specific listeners
- Scheduler-specific listeners
- Diagnostic streams
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
- Metrics
- Snapshots
- Devtools
- Cache garbage collection

Do not modify files under:

```text
src/
tests/
```

## Expected changed files

Expected changed or added files:

```text
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/15-runtime-refactor-r1d-notification-ownership-implementation-note.md
docs/implementation/prompts/007d-runtime-refactor-r1d-notification-ownership.md
```

Optionally update one directly relevant active architecture document if the notification contract would otherwise be difficult to discover. Prefer keeping internal refactor-specific details in the refactor plan.

Do not modify unrelated documentation merely to increase coverage.

No file deletion is expected.

## Quality requirements

- Documentation must match current source and tests.
- Do not invent desired future behavior.
- Clearly separate stable observable contracts from incidental implementation details.
- Keep the wording framework-agnostic.
- Use `onChange(...)`, not obsolete listener terminology.
- Use node-subscription terminology consistently.
- Do not promise one notification per public API call.
- Do not specify brittle exact counts for multi-stage operations.
- Keep R2 scope explicit and narrow.
- Preserve all source and tests byte-for-byte.
- Preserve public APIs and exports.
- Do not add dependencies.

## Static inspection

Perform these dependency-free checks:

1. List all changed and added files.
2. Confirm no files were deleted.
3. Hash all files under `src/` before and after; they must be identical.
4. Hash all files under `tests/` before and after; they must be identical.
5. Parse available JSON configuration files.
6. Run the dependency-free core boundary script if available.
7. Confirm the public `GraphRuntime` interface is unchanged.
8. Confirm public exports are unchanged.
9. Count and inspect current `notify()` call sites in `src/core/runtime.ts` without modifying them.
10. Confirm the documentation covers subscription, context/invalidation, execution, refresh, prefetch, scheduler, and silent operations.
11. Confirm documentation does not promise one notification per public method call.
12. Confirm documentation distinguishes committed state from incidental implementation details.
13. Confirm R1C is marked validated offline.
14. Confirm R1D is prepared with offline validation pending.
15. Confirm R2 through R9 remain incomplete.
16. Confirm Milestone 4 remains not started.
17. Confirm no extraction, batching, new listener API, or later feature was introduced.
18. Create a ZIP containing only R1D files added or changed.
19. Validate ZIP integrity and contents before responding.

These checks do not prove that type checking, tests, build, or runtime validation succeeds.

## Offline validation

After applying the R1D ZIP, run from the repository root:

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

Although R1D is documentation-only, run the complete validation sequence to confirm the applied change set did not include unintended files.

If tests fail, capture complete output:

```powershell
pnpm test:run --reporter verbose --no-color 2>&1 |
    Tee-Object -FilePath ".\unit-test-output.log"
```

The developer should return:

- Full output for failed commands
- Type errors with file and line number
- Failed test names and assertion output
- Confirmation that the playground still renders

## Prepared acceptance criteria

R1D is ready for offline validation when:

- The primary notification ownership rule is documented.
- Listener lifecycle and failure isolation are documented.
- Subscription notification ownership is documented.
- Context and invalidation notification ownership is documented.
- Execution start, success, failure, and obsolete-result behavior is documented.
- Refresh preparation and changed-result invalidation notifications are documented.
- Prefetch notification behavior is documented.
- Scheduler-state notification ownership is documented.
- Silent no-op and validation paths are documented.
- Stable observable contracts are distinguished from incidental implementation details.
- R2 preservation requirements are explicit.
- Source and tests are byte-for-byte unchanged.
- Public APIs and exports are unchanged.
- R1D is marked prepared with offline validation pending.
- R2 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R1D is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No source or test behavior changed.
- Any reported issues are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R1D.
2. A ZIP containing only R1D files added or changed.
3. Files added and changed.
4. The documented notification ownership rule.
5. Capability ownership and silent-operation summaries.
6. R2 preservation requirements.
7. Confirmation that source, tests, public APIs, exports, and behavior were unchanged.
8. Static checks and results.
9. Project commands marked `Not run in contained environment`.
10. Exact offline validation steps.
11. The next planned task: R2.
