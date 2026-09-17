# Implementation Prompt 008: Extract Runtime Observation

## Role

You are implementing **R2** of the runtime composition refactor for `vue-dependency-graph`.

R1A, R1B, R1C, and R1D have been validated offline.

The validated baseline includes:

- Accurate Milestone 3 documentation
- Named private runtime invariants
- Standardised private registered-node validation
- A documented notification ownership contract
- Eleven existing notification call sites in `src/core/runtime.ts`

R2 is a narrow, behavior-preserving extraction. Move listener storage, registration, idempotent removal, dispatch, and listener-failure isolation out of `runtime.ts` into one small internal observation capability.

Do not move notification ownership. The capability that commits state must continue to decide when notification occurs.

Do not start R3 or any later refactor task.

## Required reading

Before changing files, read:

- `README.md`
- `CONTRIBUTING.md`
- `docs/api/01-proposed-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/15-runtime-refactor-r1d-notification-ownership-implementation-note.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Pay particular attention to:

- `src/core/runtime.ts`
- Current `RuntimeListener` and `GraphRuntime` contracts
- The existing local `listeners` set
- The existing local `notify()` function
- The existing `onChange(...)` implementation
- Every current `notify()` call site
- Observation tests in runtime, subscription, scheduler, prefetch, and refresh test files

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

1. Apply only the R2 changes described below.
2. Perform dependency-free static inspection.
3. Preserve the public API and runtime behavior.
4. Preserve every existing notification ownership point and timing.
5. Return a ZIP containing only files added or changed for R2.
6. Provide exact offline validation commands.
7. Report project commands as `Not run in contained environment`.

No file deletion is expected for R2.

## Objective

Extract runtime observation into a small closure-based capability with this approximate internal shape:

```ts
interface RuntimeObserver {
  readonly onChange: (
    listener: RuntimeListener
  ) => () => void;

  readonly notify: () => void;
}

const createRuntimeObserver = (): RuntimeObserver => {
  const listeners = new Set<RuntimeListener>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Listener failures remain isolated.
      }
    }
  };

  const onChange = (
    listener: RuntimeListener
  ): (() => void) => {
    listeners.add(listener);

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  };

  return Object.freeze({
    onChange,
    notify,
  });
};
```

Exact naming may vary slightly if existing conventions suggest a clearer name. Prefer:

```ts
createRuntimeObserver
RuntimeObserver
```

Do not use `useRuntimeObserver` in framework-agnostic core code.

## Public API constraint

The public API must remain unchanged:

```ts
const stopObserving = runtime.onChange(listener);
stopObserving();
```

The complete `GraphRuntime` API remains unchanged:

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

Do not add:

- Public observer objects
- Public `notify()`
- Listener payloads
- Node-specific listeners
- Scheduler-specific listeners
- Event-emitter APIs
- Vue refs or composables
- Diagnostic streams
- New overloads or aliases

Do not change public exports from:

```text
src/core/index.ts
src/index.ts
```

`RuntimeListener` must remain publicly exported from `runtime.ts` unless moving only its internal import location is required. Prefer leaving its public definition where it is to avoid export churn.

## Required source changes

### 1. Add one internal observation module

Add:

```text
src/core/runtime-observer.ts
```

The module should contain only the internal observer capability.

Suggested contract:

```ts
import type { RuntimeListener } from "./runtime";

export interface RuntimeObserver {
  readonly onChange: (
    listener: RuntimeListener
  ) => () => void;

  readonly notify: () => void;
}

export const createRuntimeObserver = (): RuntimeObserver => {
  // Closure-owned listener storage.
};
```

If importing `RuntimeListener` from `runtime.ts` creates an undesirable circular type dependency, use the simplest alternative:

- Move only `RuntimeListener` to `runtime-observer.ts` and re-export it from `runtime.ts`, or
- Define the internal listener signature locally and preserve the public alias in `runtime.ts`.

Prefer the option with the smallest diff and clearest dependency direction.

Any internal export from `runtime-observer.ts` is for use within `src/core` only. Do not re-export the observer capability from `src/core/index.ts`.

### 2. Move listener storage

Remove the local listener collection from `createGraphRuntime(...)`:

```ts
const listeners = new Set<RuntimeListener>();
```

The new observer capability must own its listener set privately in its closure.

Each graph runtime must create its own observer instance:

```ts
const observer = createRuntimeObserver();
```

Separate runtimes must continue to have independent listeners.

Do not introduce global or module-level mutable listener state.

### 3. Move notification dispatch

Remove the local dispatch implementation from `runtime.ts`:

```ts
const notify = (): void => {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Listener failures are isolated.
    }
  }
};
```

Delegate the existing call sites through the observer capability.

Preferred minimal style:

```ts
const { onChange, notify } = createRuntimeObserver();
```

or:

```ts
const observer = createRuntimeObserver();
```

with existing calls changed mechanically to:

```ts
observer.notify();
```

Choose one consistent style. Prefer the style that makes ownership explicit without adding wrappers.

### 4. Move listener registration and removal

Replace the inline `onChange(...)` implementation in the returned runtime object with the observer method:

```ts
return Object.freeze({
  // Existing public members.
  onChange: observer.onChange,
});
```

or its destructured equivalent.

Required behavior:

- Listener registration remains synchronous.
- The returned stop function remains idempotent.
- Stopped listeners are not called in later dispatches.
- Removing a listener that is already stopped is a no-op.
- No runtime notification is produced by adding or removing a listener.

### 5. Preserve snapshot-at-dispatch behavior

The current implementation iterates over:

```ts
[...listeners]
```

Preserve this behavior.

Consequences to preserve:

- Listener order follows Set insertion order.
- A listener added during dispatch is not called in that same dispatch.
- Removing a listener during dispatch does not remove it from the already captured dispatch snapshot.
- Later dispatches use the updated listener set.

Do not iterate the live Set directly.

Do not add queueing or deferred dispatch.

### 6. Preserve listener-failure isolation

Retain the existing behavior:

- One listener throwing does not prevent later listeners from running.
- The thrown listener error does not escape `notify()`.
- Listener failure does not roll back committed runtime state.
- Listener failure is not stored in node state or scheduler state.
- Listener failure is not logged by core code.

Do not add an error callback, logging hook, aggregate error, or diagnostics event.

### 7. Preserve all notification ownership call sites

The current validated runtime contains eleven `notify()` call sites.

R2 must preserve them one-for-one semantically.

They currently cover:

- Scheduler request queued
- Subscription counts added
- Subscription counts removed
- Context and descendant invalidation committed
- Node execution attempt started
- Node execution success committed
- Changed refresh result invalidated descendants
- Node execution failure committed
- Refresh preparation committed
- Scheduler flush started
- Scheduler flush completed or failed

Do not:

- Add a notification call
- Remove a notification call
- Merge calls
- Move a call before its state mutation
- Move a call after scheduler triggering if it currently occurs before it
- Notify from inside the observer automatically
- Have the observer inspect runtime state

After extraction, each existing capability location must still explicitly invoke notification after its own committed transition.

### 8. Avoid compatibility wrappers

Do not keep a local wrapper such as:

```ts
const notify = (): void => observer.notify();
```

unless it materially reduces the diff and static inspection confirms all ownership remains clear.

Preferred approach:

```ts
const { notify, onChange } = createRuntimeObserver();
```

This preserves current call-site spelling while moving implementation responsibility cleanly.

Do not introduce a general event bus or publisher abstraction.

### 9. Keep observer construction simple

`createRuntimeObserver()` requires no graph, state map, scheduler, or runtime object.

Do not pass:

- Graph topology
- Runtime state maps
- Scheduler state
- Execution state
- Subscription state
- Notification reasons
- Transaction coordinators

The observer owns listener lifecycle and dispatch only.

### 10. Keep internal API narrow

The observer capability should expose exactly what is needed:

```ts
onChange(listener)
notify()
```

Do not expose:

- Listener count
- Listener collection
- Clear-all method
- Has-listener method
- Notification payload
- Async dispatch
- Pause or resume
- Batching
- Error collection

## Behavior that must remain unchanged

### Listener lifecycle

- `onChange(...)` returns an idempotent stop function.
- Listener invocation order remains registration order.
- Stopped listeners do not receive later transitions.
- Adding or removing listeners remains silent.
- Listener storage remains runtime-local.

### Dispatch behavior

- Dispatch remains synchronous.
- Dispatch uses a listener snapshot.
- Listener exceptions remain isolated.
- Runtime state remains committed when a listener throws.
- No console logging occurs.

### Notification ownership

- Subscription owns count-transition notifications.
- Context and invalidation own their committed-state notification.
- Execution owns attempt start, success, and direct failure notifications.
- Refresh preparation owns its committed-state notification.
- Changed refresh results retain the later descendant-invalidation notification.
- Scheduler owns public scheduler-state notifications.

### Silent paths

The following remain silent when they commit no observable state:

- Equal context update
- Empty subscription
- Repeated unsubscribe
- Empty execution
- Empty prefetch
- Empty refresh
- Validation failure before mutation
- Fresh successful node skipped by execution
- Obsolete result discarded without commit
- Repeated observer stop
- `whenSettled()` resolution without a scheduler-state transition

### Runtime behavior

R2 must not change:

- Runtime state transitions
- Subscription counts or lifecycle
- Context invalidation
- Execution ordering
- Attempt ownership
- Scheduler queueing or settlement
- Prefetch behavior
- Refresh behavior
- Error handling
- Public snapshots
- Validation behavior

## Tests

Use Vitest 3.0.7 and TypeScript.

Retain every existing test and assertion.

Do not broadly rewrite observation tests. Add only focused coverage needed to protect behavior that becomes encapsulated in the new module.

### 1. Preserve public observation behavior

Existing tests must continue to prove:

- Committed context changes notify listeners.
- Equal context updates are silent.
- Stop functions are idempotent.
- Throwing listeners do not prevent other listeners.
- Subscription add and active unsubscribe are observable.
- Scheduler state progression is observable.
- Obsolete results do not produce success or failure notifications.
- Empty prefetch and refresh remain silent.

Do not replace these public-behavior tests with direct private-module tests.

### 2. Add focused listener-snapshot behavior tests

Add behavior-focused tests through `createGraphRuntime(...)` for:

#### Listener added during dispatch

- Register a first listener.
- During its first invocation, register a second listener.
- Confirm the second listener is not invoked in that same dispatch.
- Trigger another committed transition.
- Confirm the second listener runs during the later dispatch.

#### Listener removed during dispatch

- Register two listeners in order.
- During the first listener's invocation, stop the second listener.
- Confirm the second listener still runs in the current copied dispatch snapshot.
- Trigger another committed transition.
- Confirm the second listener no longer runs.

These tests establish the current `[...listeners]` behavior required by R1D.

Prefer extending:

```text
tests/core/runtime-state.spec.ts
```

or add one focused file:

```text
tests/core/runtime-observer.spec.ts
```

Choose the simpler option matching existing conventions.

### 3. Add runtime-local isolation coverage if missing

Ensure a test proves:

- A listener registered on one runtime is not called for transitions in another runtime created from the same graph.

Add this only if existing tests do not prove it clearly.

### 4. Do not test private implementation details

Do not assert:

- The private listener Set
- The observer object's frozen shape
- Internal method identity
- The number of internal helper calls
- The source filename used by runtime

Test observable behavior through `GraphRuntime.onChange(...)`.

### 5. Notification-count restraint

Exact counts are acceptable for narrowly isolated single-transition listener lifecycle tests.

Do not add brittle exact total counts for:

- A full scheduler flush
- A refresh operation
- Multi-node execution
- Multi-stage invalidation and rescheduling

Prefer state progression assertions for multi-stage operations.

## Documentation updates

### 1. Roadmap status

Update:

```text
docs/implementation/01-roadmap.md
```

Required status:

- R1A remains validated offline.
- R1B remains validated offline.
- R1C remains validated offline.
- R1D is marked validated offline.
- R2 implementation is prepared.
- R2 offline validation remains pending.
- R3 through R9 remain incomplete.
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
[ ] R2 offline validation
[ ] R3: Extract runtime state and active-attempt storage
...
```

### 2. Refactor-plan status

Update:

```text
docs/implementation/11-runtime-composition-refactor-plan.md
```

Mark:

- R1A through R1D as validated offline
- R2 as prepared with offline validation pending
- R3 through R9 as planned

Add a brief R2 implementation decision under the R2 section:

- Listener storage and dispatch moved to a closure-based observer.
- Notification ownership and call sites remain in the committing capabilities.
- The observer has no runtime-state knowledge.
- No batching, payloads, or deferred dispatch were introduced.

Do not rewrite the R1D notification contract.

### 3. Add an R2 implementation note

Add:

```text
docs/implementation/16-runtime-refactor-r2-observation-implementation-note.md
```

Include:

- Status: Validation pending
- Objective
- Files changed
- Observer capability contract
- Listener lifecycle behavior
- Snapshot-at-dispatch behavior
- Listener-failure isolation
- Notification ownership preservation
- Eleven call-site preservation decision
- Tests added or updated
- Explicit confirmation that public API and runtime behavior were intentionally preserved
- Static checks performed
- Project commands marked `Not run in contained environment`
- Offline validation commands
- Risks and considerations for R3
- Next task: R3

### 4. Store this prompt

Store this prompt as:

```text
docs/implementation/prompts/008-runtime-refactor-r2-extract-runtime-observation.md
```

## Out of scope

Do not implement:

- Runtime state extraction
- Active-attempt storage extraction
- Execution-controller extraction
- Subscription-controller extraction
- Scheduler extraction
- Invalidation extraction
- Prefetch or refresh extraction
- Runtime assembly restructuring beyond observer creation and wiring
- Notification ownership changes
- Notification batching
- Notification debouncing
- Notification coalescing
- Deferred or asynchronous dispatch
- Notification payloads
- Node-specific listeners
- Scheduler-specific listeners
- Diagnostics or metrics streams
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
- Snapshots
- Devtools
- Cache garbage collection

Do not move mutable node state, scheduler state, subscription state, active attempts, or operation maps out of `runtime.ts` in R2.

## Expected changed files

Likely changed or added files:

```text
src/core/runtime-observer.ts
src/core/runtime.ts
tests/core/runtime-state.spec.ts
docs/implementation/01-roadmap.md
docs/implementation/11-runtime-composition-refactor-plan.md
docs/implementation/16-runtime-refactor-r2-observation-implementation-note.md
docs/implementation/prompts/008-runtime-refactor-r2-extract-runtime-observation.md
```

If a focused test file is clearer, use:

```text
tests/core/runtime-observer.spec.ts
```

instead of changing `runtime-state.spec.ts` broadly.

Do not modify unrelated files merely to match this list.

No file deletion is expected.

## Quality requirements

- Make small, surgical changes only.
- Preserve the public API exactly.
- Preserve runtime behavior exactly.
- Preserve all eleven notification ownership points.
- Preserve synchronous snapshot dispatch.
- Preserve listener registration order.
- Preserve idempotent listener removal.
- Preserve listener-failure isolation.
- Keep the observer runtime-local.
- Keep `src/core` framework-agnostic.
- Do not use `any`.
- Do not add TypeScript suppression outside intentional type tests.
- Do not add console logging.
- Do not add global state.
- Do not add dependencies.
- Do not expose the observer publicly.
- Do not create a general event bus.
- Do not move other runtime responsibilities.
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
11. Confirm `runtime-observer.ts` is not exported from `src/core/index.ts`.
12. Confirm listener storage exists only inside `createRuntimeObserver()`.
13. Confirm no module-level mutable listener state exists.
14. Confirm dispatch iterates a copied listener collection.
15. Confirm listener errors are caught and ignored without logging.
16. Confirm stop functions are explicitly idempotent.
17. Confirm the previous local listener Set and inline `onChange(...)` implementation were removed from `runtime.ts`.
18. Confirm the observer is created once per `createGraphRuntime(...)` call.
19. Confirm all eleven notification ownership call sites remain semantically present.
20. Confirm notification calls remain after the same state mutations as before.
21. Confirm no notification call moved into automatic observer behavior.
22. Confirm no batching, payload, async dispatch, or node-specific observation was introduced.
23. Confirm no mutable runtime state other than listener storage moved out of `runtime.ts`.
24. Confirm no R3 or later extraction occurred.
25. Confirm R2 is validation pending and R3 through R9 remain incomplete.
26. Create a ZIP containing only R2 files added or changed.
27. Validate ZIP integrity and contents before responding.

For call-site verification, use a source comparison rather than relying only on raw text count if calls change from:

```ts
notify();
```

to:

```ts
observer.notify();
```

The semantic count must remain eleven.

These checks do not prove that TypeScript, Vitest, build, or runtime validation succeeds.

## Offline validation

After applying the R2 ZIP, run from the repository root:

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

R2 is ready for offline validation when:

- A small closure-based runtime observer exists.
- Listener storage is private to each observer instance.
- `runtime.ts` no longer owns the listener Set or dispatch loop.
- `GraphRuntime.onChange(...)` delegates to the observer capability.
- Dispatch remains synchronous and snapshot-based.
- Listener registration order is preserved.
- Listener additions during dispatch affect only later dispatches.
- Listener removals during dispatch affect only later dispatches.
- Listener failures remain isolated and unlogged.
- Stop functions remain idempotent.
- All eleven notification ownership points are preserved.
- Silent operations remain silent.
- No notification timing or ownership changed.
- Public APIs and exports are unchanged.
- No observer capability is publicly exported.
- No runtime responsibility other than listener lifecycle and dispatch moved out of `runtime.ts`.
- Behavior-focused tests protect snapshot dispatch and runtime-local listener isolation.
- R2 is marked prepared with offline validation pending.
- R3 through R9 remain incomplete.
- Static checks pass.
- A validated changes-only ZIP is returned.

## Validated acceptance criteria

R2 is complete only after the developer reports:

- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground starts and renders.
- No unhandled promise rejections occur.
- Observation behavior and notification timing remain unchanged.
- Any reported failures are corrected and revalidated.

## Expected completion response

Provide:

1. A concise summary of R2.
2. A ZIP containing only R2 files added or changed.
3. Files added and changed.
4. The internal observer capability contract.
5. Listener lifecycle, snapshot dispatch, and failure-isolation decisions.
6. Confirmation that all eleven notification ownership points were preserved.
7. Tests added or updated.
8. Confirmation that public APIs, exports, notification timing, silent paths, and runtime behavior were intentionally preserved.
9. Static checks and results.
10. Project commands marked `Not run in contained environment`.
11. Exact offline validation steps.
12. The next planned task: R3.
