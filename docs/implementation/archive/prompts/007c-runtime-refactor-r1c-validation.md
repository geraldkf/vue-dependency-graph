# Implementation Prompt 007C: Standardise Registered-Node Validation

## Role

You are implementing **R1C** of the runtime composition refactor for `vue-dependency-graph`.

R1A and R1B have been validated offline.

The repository now has:

- Accurate Milestone 3 documentation
- A staged runtime composition refactor plan
- Named private invariants for fresh-success reuse
- Named private scheduler-only ownership detection
- Deterministic refresh-operation identity

R1C is a small, behavior-preserving cleanup of registered-node validation inside the current runtime implementation.

The purpose is to make validation intent clearer and more consistent before runtime responsibilities are extracted in later tasks.

Do not start R1D, R2, or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/13-runtime-refactor-r1b-invariants-implementation-note.md`
- `src/core/runtime.ts`
- `src/core/execution.ts`
- `src/core/index.ts`
- `src/core/types.ts`
- `tests/core/runtime-context.spec.ts`
- `tests/core/runtime-types.test.ts`
- `tests/core/runtime-state.spec.ts`
- `tests/core/execution-order.spec.ts`
- `tests/core/execution-failure.spec.ts`
- `tests/core/node-subscription-lifecycle.spec.ts`
- `tests/core/node-subscription-registration.spec.ts`
- `tests/core/prefetch.spec.ts`
- `tests/core/refresh.spec.ts`
- `tests/core/refresh-interaction.spec.ts`
- `tests/core/operation-types.test.ts`
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

1. Apply only the R1C changes described below.
2. Perform dependency-free static inspection.
3. Preserve public APIs and runtime behavior.
4. Preserve synchronous versus asynchronous failure behavior.
5. Preserve complete-list validation before mutation.
6. Return a ZIP containing only files added or changed for R1C.
7. Provide exact offline validation commands.
8. Report project commands as `Not run in contained environment`.

No file deletion is expected for R1C.

## Objective

Make registered-node validation easier to understand and reuse without introducing a validation subsystem.

The intended result is a small set of private helpers in `src/core/runtime.ts`, close to:

```ts
const requireRegisteredNode = (
  node: AnyNodeDefinition,
  purpose: string
): AnyNodeDefinition => { ... };

const requireRegisteredContextNode = <TValue>(
  node: ContextNodeDefinition<TValue>
): ContextNodeDefinition<TValue> => { ... };

const requireRegisteredRefreshableNode = (
  node: RefreshableNodeDefinition
): RefreshableNodeDefinition => { ... };
```

Exact names may differ if a simpler naming scheme fits existing conventions.

Do not force every validation path through one helper when that would change observable behavior.

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

## Validation semantics that must remain unchanged

### Key-based graph identity

Validation must continue to resolve node handles by key.

If a different node-definition object has the same key as a registered node:

- Subscription uses the registered definition.
- Prefetch executes the registered definition.
- Refresh executes the registered definition when it is refreshable.
- State and subscription inspection use the registered key.

Do not require object-reference equality.

### Unknown nodes

An unknown key must still produce a clear error containing the key.

Do not silently ignore unknown nodes.

### Complete-list validation before mutation

Operations accepting multiple targets must validate the whole effective target list before applying partial state changes where that is already the contract.

This is mandatory for:

- `subscribeNodes(...)`
- `refresh(...)`

A failure in a later target must not leave changes from earlier targets.

### Failure timing

Preserve current caller-visible failure timing.

Important distinctions:

- `subscribeNodes(...)` is synchronous and must continue to throw synchronously for an unknown target.
- `setContext(...)` is synchronous and must continue to throw synchronously for an invalid context handle.
- `execute(...)` and `prefetch(...)` return promises. Preserve their current promise rejection behavior for unknown targets.
- `refresh(...)` returns a promise. Preserve current behavior for missing targets and defensive context-node rejection.

Do not make a synchronous API asynchronous.

Do not convert a promise rejection into an unrelated synchronous throw unless that is already the current behavior before a promise is returned.

### Error contracts

Do not introduce a new public validation error type.

Do not change `GraphExecutionError` behavior.

Unknown target validation is not a node-execution failure and must not be converted into a `GraphExecutionError` unless the current implementation already does so.

Error messages must continue to include the relevant node key.

## Required source changes

### 1. Retain and clarify `requireRegisteredNode(...)`

Keep one private general helper for key-based lookup:

```ts
const requireRegisteredNode = (
  node: AnyNodeDefinition,
  purpose: string
): AnyNodeDefinition => {
  const registered = graph.getNode(node.key);

  if (!registered) {
    throw new Error(
      `Node "${node.key}" is not registered for ${purpose}.`
    );
  }

  return registered;
};
```

The exact message may preserve the existing repository wording.

Requirements:

- Resolve by key.
- Return the graph's registered node definition.
- Include the supplied key when missing.
- Remain private to `createGraphRuntime(...)` or `runtime.ts`.
- Do not export it.

Use it where doing so does not alter failure timing or error contracts.

### 2. Add a focused context-node helper

Context updates currently require both:

- A registered key
- A registered definition whose kind is `context`

Add a focused private helper, close to:

```ts
const requireRegisteredContextNode = <TValue>(
  node: ContextNodeDefinition<TValue>
): ContextNodeDefinition<TValue> => {
  const registered = requireRegisteredNode(
    node,
    "context update"
  );

  if (!isContextNode(registered)) {
    throw new Error(
      `Context node "${node.key}" is not registered in this graph.`
    );
  }

  return registered as ContextNodeDefinition<TValue>;
};
```

Required behavior:

- Equivalent context handles resolve through the registered key.
- Missing context key throws synchronously.
- A key registered as a data or derived node is rejected.
- `setContext(...)` updates state using the registered node key.
- Equal-value behavior remains unchanged.
- Invalidation and scheduling behavior remains unchanged.

Keep the helper private.

Do not change the public `setContext(...)` type signature.

### 3. Add a focused refreshable-node helper if useful

Refresh requires a registered data or derived node.

A reasonable helper is:

```ts
const requireRegisteredRefreshableNode = (
  node: RefreshableNodeDefinition
): RefreshableNodeDefinition => {
  const registered = requireRegisteredNode(
    node,
    "manual refresh"
  );

  if (isContextNode(registered)) {
    throw new Error(
      `Context node "${registered.key}" cannot be refreshed.`
    );
  }

  return registered as RefreshableNodeDefinition;
};
```

Use this helper only if it keeps complete-list validation clear.

Required behavior:

- Equivalent data or derived handles resolve to the registered definition.
- Missing keys are rejected before generation changes.
- Context-node refresh remains rejected defensively at runtime.
- Duplicate targets remain deduplicated by key.
- No target generation changes until all requested targets are validated and deduplicated.
- Empty refresh still resolves immediately.

Do not rely only on public TypeScript typing for runtime safety.

### 4. Standardise execution and prefetch target validation cautiously

`execute(...)` and `prefetch(...)` share the existing execution engine.

Their target validation currently occurs inside the execution orchestration path.

You may reuse a small private target-resolution helper such as:

```ts
const resolveRegisteredTargets = (
  targets: readonly AnyNodeDefinition[],
  purpose: string
): readonly AnyNodeDefinition[] =>
  targets.map(target =>
    requireRegisteredNode(target, purpose)
  );
```

However, only do this if it preserves:

- Promise rejection behavior
- Complete target validation before execution starts
- Key-based equivalent-handle resolution
- Existing execution and prefetch error semantics
- Empty target behavior

The safest acceptable implementation may keep execution validation inside `executeInternal(...)` while reusing `requireRegisteredNode(...)` there.

Do not move target validation outside the async execution boundary if doing so changes an unknown target from a rejected promise into a synchronous throw before the method returns a promise.

Document the decision in the R1C implementation note.

### 5. Keep subscription validation atomic

`subscribeNodes(...)` must continue to:

1. Resolve every requested handle through the graph.
2. Deduplicate by key.
3. Reject synchronously if any target is unknown.
4. Apply no direct or required count changes until validation succeeds.

Using `requireRegisteredNode(...)` is appropriate.

Do not change ancestor collection, counter behavior, notification behavior, automatic scheduling, or unsubscribe behavior.

### 6. Avoid over-abstraction

Do not add:

- A validation class
- A validator controller
- A validation service
- A generic schema system
- A new error hierarchy
- A public validation API
- A new source module

The only expected implementation file change is:

```text
src/core/runtime.ts
```

## Behavior that must remain unchanged

### Context updates

- Correct context value type remains enforced by TypeScript.
- Equal values remain no-ops.
- Changed values increment the context generation.
- Descendants become stale.
- Affected attempts are cancelled.
- Subscribed descendants request scheduler work.
- Unrelated branches remain unchanged.

### Subscription registration

- Unknown targets throw synchronously.
- Failed registration applies no partial subscription counts.
- Equivalent handles resolve to registered definitions.
- Duplicate targets remain deduplicated.
- Subscription notifications and scheduling remain unchanged.

### Explicit execution and prefetch

- Empty targets resolve.
- Unknown targets remain caller-visible through the same promise behavior.
- Equivalent handles execute registered definitions.
- Required ancestors remain included.
- Fresh nodes remain reused.
- Branch-scoped execution failures remain `GraphExecutionError`.

### Refresh

- Empty refresh resolves.
- Unknown targets apply no partial generation changes.
- Context nodes remain defensively rejected.
- Equivalent handles resolve to registered refreshable definitions.
- Duplicate targets are deduplicated.
- Refresh-operation key behavior from R1B remains unchanged.
- Overlapping refresh behavior remains unchanged.

### Observation

- Notification timing remains unchanged.
- Failed validation produces no partial committed state notification.
- Listener behavior remains unchanged.

## Tests

Use behavior-focused tests through `createGraphRuntime(...)`.

Do not test private helpers directly.

Retain all existing tests and assertions.

### 1. Context validation

Ensure tests cover:

- Registered context updates successfully.
- Equivalent context handle with the same key updates the registered context state.
- Missing context key throws synchronously and includes the key.
- A context-shaped handle whose key belongs to a registered data or derived node is rejected at runtime.
- Failed context validation does not change runtime state or notify listeners.

Type tests already reject data and derived handles passed directly to `setContext(...)`. Keep those tests unchanged.

For runtime defensive tests, a narrow test-only cast may be required to simulate malformed external input. Avoid `any`; use `unknown` and the narrowest explicit public type cast necessary.

### 2. Subscription atomic validation

Ensure tests cover:

- Equivalent handles resolve through the registered key.
- A list containing a valid target followed by a missing target throws synchronously.
- The valid target retains zero direct and required subscription counts.
- No subscription notification occurs.
- No scheduler work is queued.

Prefer extending:

```text
tests/core/node-subscription-lifecycle.spec.ts
```

or the existing most relevant subscription-validation test file.

### 3. Execution and prefetch validation

Ensure tests cover:

- Equivalent handles execute the registered node definition.
- Missing explicit execution target rejects through the same promise behavior as before.
- Missing prefetch target rejects through the same promise behavior as before.
- A target list containing a valid target followed by a missing target starts no loader work.
- Missing target errors include the key.

Do not convert these into `GraphExecutionError` assertions unless that is already current behavior.

Prefer extending:

```text
tests/core/execution-order.spec.ts
tests/core/prefetch.spec.ts
```

### 4. Refresh atomic validation

Ensure tests cover:

- Equivalent data handle refreshes the registered data definition.
- Equivalent derived handle refreshes the registered derived definition.
- A valid target followed by a missing target rejects before changing any generation.
- Defensive context-node refresh rejects and includes the key.
- Empty refresh remains a no-op.
- Duplicate refresh targets remain deduplicated.

Prefer extending:

```text
tests/core/refresh.spec.ts
```

or a focused existing validation test file.

### 5. Notification restraint

Do not add brittle exact notification counts beyond established contracts.

For failed validation, assert that no committed state notification occurs where practical.

Do not change scheduler observation tests.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A remains validated offline.
- R1B is marked validated offline.
- R1C implementation is prepared.
- R1C offline validation remains pending.
- R1D through R9 remain incomplete.
- The overall runtime composition refactor remains incomplete.
- Milestone 4 remains not started.

A reasonable checklist is:

```text
[x] R1A implementation: Documentation and repository cleanup
[x] R1A offline validation
[x] R1B implementation: Name existing runtime invariants
[x] R1B offline validation
[x] R1C implementation: Standardise registered-node validation
[ ] R1C offline validation
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
- R1B as validated offline
- R1C as prepared with offline validation pending
- R1D and later tasks as planned

Do not add notification ownership rules. That belongs to R1D.

### 3. Add an R1C implementation note

Add:

```text
docs/implementation/14-runtime-refactor-r1c-validation-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- General registered-node helper behavior
- Context validation behavior
- Refreshable-node validation behavior
- Execution and prefetch validation decision
- Atomic validation guarantees
- Error timing guarantees
- Tests added or updated
- Confirmation that public API and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Next task: R1D

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/007c-runtime-refactor-r1c-validation.md
```

## Out of scope

Do not implement:

- Notification ownership documentation
- Notification behavior changes
- Runtime observer extraction
- Runtime state extraction
- Active-attempt storage extraction
- Execution-controller extraction
- Subscription-controller extraction
- Scheduler extraction
- Invalidation extraction
- Operations extraction
- Runtime assembly restructuring
- Fluent builders
- Dependency-injection containers
- Public controller APIs
- Public API changes
- New public exports
- New validation modules
- New public error types
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

Do not change the R1B invariant helpers except where a minimal placement adjustment is required for compilation. Their semantics must stay unchanged.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime.ts
tests/core/runtime-context.spec.ts
tests/core/node-subscription-lifecycle.spec.ts
tests/core/execution-order.spec.ts
tests/core/prefetch.spec.ts
tests/core/refresh.spec.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/14-runtime-refactor-r1c-validation-implementation-note.md
docs/implementation/prompts/007c-runtime-refactor-r1c-validation.md
```

Change fewer test files when current coverage already proves the contract.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve public APIs exactly.
- Preserve runtime behavior exactly.
- Preserve key-based graph identity.
- Preserve synchronous versus asynchronous failure timing.
- Preserve complete-list validation before mutation.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging.
- Do not add global state.
- Do not add dependencies.
- Do not export private helpers.
- Do not create a validation subsystem.
- Do not move responsibilities between files.
- Keep one execution engine.
- Keep R1B helper semantics unchanged.
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
11. Confirm no new source module was added.
12. Confirm registered-node helpers remain private.
13. Confirm key-based lookup uses `graph.getNode(node.key)`.
14. Confirm subscription validates all requested targets before counter mutation.
15. Confirm refresh validates all requested targets before generation mutation.
16. Confirm missing execution and prefetch targets preserve promise rejection behavior.
17. Confirm context validation remains synchronous.
18. Confirm error messages include relevant keys.
19. Confirm `GraphExecutionError` behavior is unchanged.
20. Confirm R1B helper definitions and semantics are unchanged.
21. Confirm notification calls and timing are unchanged.
22. Confirm no responsibility extraction occurred.
23. Confirm no later milestone feature was introduced.
24. Confirm R1C is validation pending and R1D through R9 remain incomplete.
25. Create a ZIP containing only R1C files added or changed.
26. Validate ZIP integrity and contents before responding.

These checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R1C ZIP, run from the repository root:

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

R1C is ready for offline validation when:

- General registered-node lookup is expressed through one small private helper.
- Context validation is expressed through one focused private helper.
- Refreshable-node validation is clear and atomic.
- Key-equivalent handles resolve to registered definitions.
- Missing subscription targets apply no partial counts.
- Missing refresh targets apply no generation changes.
- Invalid context handles are rejected synchronously.
- Missing execution and prefetch targets preserve existing rejected-promise behavior.
- Error messages include relevant keys.
- `GraphExecutionError` behavior is unchanged.
- Public APIs and exports are unchanged.
- R1B helper semantics are unchanged.
- Notification behavior is unchanged.
- No validation subsystem or new source module was introduced.
- Behavior-focused tests cover validation contracts.
- R1C is marked prepared with offline validation pending.
- R1D through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R1C is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Runtime validation behavior remains unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R1C.
2. A ZIP containing only R1C files added or changed.
3. Files added and changed.
4. Registered-node validation helpers introduced or reused.
5. Atomic-validation and failure-timing decisions.
6. Behavioral tests added or updated.
7. Confirmation that public API, exports, R1B invariants, notification behavior, and runtime behavior were intentionally preserved.
8. Static checks and results.
9. Project commands marked `Not run in contained environment`.
10. Exact offline validation steps.
11. The next planned task: R1D.
