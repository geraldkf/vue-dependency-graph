# Implementation Prompt 003: Implement Runtime State and Dependency-Aware Execution

## Role

You are implementing Milestone 2 of `vue-dependency-graph`: runtime node state and deterministic dependency-aware execution.

The repository is a single private pnpm package with logical layers under `src`. All framework implementation in this milestone belongs in `src/core`.

Milestone 1 established immutable typed node definitions, order-independent graph registration, topology validation, and read-only graph inspection. Build on that foundation without moving mutable runtime state into node definitions.

Implement only:

- Runtime state stored separately from immutable node definitions
- Explicit execution of requested nodes and their required ancestors
- Dependency-aware execution planning
- Concurrent execution of independent ready nodes
- Data-node loader execution
- Derived-node evaluation
- Context-node runtime values
- Per-execution cancellation
- Execution generations and obsolete-result protection
- In-flight deduplication within one graph runtime
- Initial-load and refresh error distinction
- Branch-scoped failure handling
- Runtime state inspection and observation needed to test execution

Do not implement automatic subscription-driven scheduling, Vue composables, subscriptions, transactions, domain events, polling, retry policies, optimistic mutations, query groups, metrics, snapshots, or devtools UI.

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
- `docs/implementation/06-graph-registry-implementation-note.md`
- `docs/testing/01-test-strategy.md`
- All files under `src/core`
- All files under `tests/core`
- `src/index.ts`
- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`

Also review the original `useExecutionService` and `useDataDependencyService` reference implementation if available. Preserve useful behaviours such as dependency ordering and parallel independent branches, but do not copy:

- Vue refs into the core
- A graph-lifetime `AbortController`
- Global stop-on-first-error behaviour
- Mutable runtime state on node definitions
- Creation-order assumptions
- Manual subscription or loading APIs

If the repository differs from the documentation, state the discrepancy and make the smallest reasonable adjustment.

## Environment constraint

You are working in a contained environment. Do not install dependencies, run pnpm commands, execute Vitest, run TypeScript builds, or start Vite.

Your responsibilities are to:

1. Create or update the required source, test, and documentation files.
2. Perform static inspection that does not require installed dependencies.
3. Check exports, import boundaries, runtime-state separation, and obvious type-design issues.
4. Provide exact offline validation commands.
5. Report project command results as `Not run in contained environment`.

The developer will run the project offline and return errors or observations. Do not claim that type checking, tests, builds, or the development server succeeded.

## Objective

Create a graph runtime that explicitly executes selected nodes and their required ancestors while preserving immutable definitions and deterministic topology.

The intended API should be close to:

```ts
const graph = createGraph({
  nodes: [CurrentPointPeriod, PointPeriods, JobSeekerId],
});

const runtime = createGraphRuntime(graph);

runtime.setContext(JobSeekerId, 123);

await runtime.execute([CurrentPointPeriod]);

const state = runtime.getState(CurrentPointPeriod);
```

`execute` is intentionally explicit in Milestone 2. Automatic scheduling based on consumer subscription belongs to Milestone 3.

## Core design constraints

### 1. Immutable definitions and separate runtime state

Do not add mutable data, status, errors, abort controllers, promises, generations, or observers to node definitions.

Store runtime information in a graph-runtime instance keyed by node key.

The same graph definitions must support multiple independent runtime instances:

```ts
const firstRuntime = createGraphRuntime(graph);
const secondRuntime = createGraphRuntime(graph);
```

Updating or executing one runtime must not affect the other.

### 2. Runtime node state

Use execution status and freshness as separate concepts.

Suggested public shape:

```ts
type NodeStatus =
  | "idle"
  | "loading"
  | "success"
  | "refreshing"
  | "error";

type NodeFreshness = "fresh" | "stale";

interface NodeRuntimeState<T> {
  readonly data: T;
  readonly status: NodeStatus;
  readonly freshness: NodeFreshness;
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}
```

Exact naming may be adjusted if a simpler consistent model emerges.

Required semantics:

- A new context node starts with its initial value, `success`, and `fresh`.
- A new data or derived node starts with its initial value where one exists, but it has not completed a successful execution.
- Initial execution with no previous successful result uses `loading`.
- Re-execution with usable previous successful data uses `refreshing` and retains that data.
- Success stores the new value, clears the error, marks `success`, and marks `fresh`.
- Initial-load failure stores the error and uses `error` without claiming a successful value.
- Refresh failure retains previous successful data, stores the error, and remains stale.
- Abort or superseded execution must not be exposed as a business error.

Derived nodes currently have no explicit initial value. Choose and document one narrow representation for their pre-success data, such as `undefined`, and reflect it accurately in state typing. Do not hide this with `any` or unsafe non-null assertions.

### 3. Strongly typed state access

Runtime APIs accepting a node handle must infer that node's value type.

Example intent:

```ts
const state = runtime.getState(PointPeriods);
// state.data is PointPeriod[] or the documented pre-success representation
```

Context updates must accept only the context node's declared value type:

```ts
runtime.setContext(JobSeekerId, 123);

// Must fail type checking
runtime.setContext(JobSeekerId, "123");
```

`setContext` must reject data and derived nodes at compile time.

### 4. Context updates

Implement synchronous context updates.

```ts
runtime.setContext(JobSeekerId, 123);
```

Required behaviour:

1. If the new value is `Object.is` equal to the existing value, do nothing.
2. Otherwise update the context value.
3. Increment the context generation.
4. Mark all transitive descendants stale.
5. Preserve descendant data.
6. Abort in-flight executions for affected descendants where possible.
7. Prevent obsolete results from committing even if a loader ignores abort.

Do not automatically execute stale descendants. Automatic subscription-driven work belongs to Milestone 3.

Multiple context updates are not atomic yet. Transactions belong to Milestone 4.

### 5. Explicit execution API

Provide an API close to:

```ts
await runtime.execute([Targets, Credits]);
```

The API must:

- Accept readonly node handles.
- Treat the supplied nodes as execution targets.
- Include all transitive ancestors required by those targets.
- Skip fresh successful nodes.
- Execute stale or never-successful required nodes.
- Return when all executable requested branches finish.
- Avoid executing unrelated nodes.
- Support one node or multiple targets without requiring duplicate APIs unless overloads improve usability.

Define and document what the promise does on partial failure. Recommended behaviour:

- Complete all independent branches that can still run.
- Reject with one execution-level error containing failures after the execution plan settles.
- Preserve per-node errors in runtime state.

Do not reject immediately on the first independent branch failure.

### 6. Execution planning

Build an execution plan from the graph's validated parent and child indexes.

The planner must:

1. Start from requested targets.
2. Include all transitive ancestors.
3. Exclude nodes already fresh and successful.
4. Identify ready nodes whose required parents are successful and fresh.
5. Execute independent ready nodes concurrently.
6. Block descendants when a required parent fails.
7. Continue unrelated branches.
8. Detect an unexpected no-progress condition defensively.

The validated graph should make cycles and missing parents impossible. A no-progress error still provides protection against runtime-state bugs.

Do not add a configurable concurrency limit in this milestone unless needed for correctness. Unbounded concurrency across the current ready wave is acceptable and matches the proven implementation.

### 7. Context-node execution

Context nodes are already successful after runtime creation or `setContext`.

Execution should not run a loader for a context node.

If a context node is explicitly requested, execution should resolve when its current value is available.

### 8. Data-node execution

Invoke the retained data-node loader with:

```ts
{
  get,
  signal,
}
```

Required `get` behaviour:

- Accept only the node's declared dependencies at compile time.
- Return the current successful value for a declared dependency.
- Throw a clear internal/runtime error if execution attempts to read a dependency without a successful value. This indicates a planner defect or invalid direct internal use.

Each actual loader attempt receives an execution-scoped `AbortSignal`.

Do not expose private mutable runtime maps to loaders.

### 9. Derived-node execution

After all declared dependencies are successful and fresh, evaluate the synchronous derive function with typed `get`.

Required behaviour:

- Treat a thrown value like loader failure.
- Convert non-`Error` thrown values to `Error` consistently.
- Record execution state in the same model as data nodes.
- Never execute a derived node before its parents are ready.

Do not make derived functions asynchronous.

### 10. Per-node generations and obsolete-result protection

Each node runtime state has a generation counter.

Increment the generation when the node becomes stale because a dependency or context changed.

An execution attempt captures the generation at start. Commit its success or failure only if:

- The node runtime still exists.
- The captured generation equals the current generation.
- The attempt is still the active attempt for that node.

If not, discard the result without replacing newer data or error state.

This protection is mandatory even when an API supports abort signals because APIs may ignore cancellation.

### 11. Cancellation

Use an `AbortController` per active node execution or per execution attempt. Do not create one permanent controller for the graph runtime.

Required behaviour:

- Setting an ancestor context aborts affected in-flight descendants.
- A superseded attempt may be aborted.
- Aborted attempts do not store `AbortError` as a business error.
- The next execution can create a fresh controller and run successfully.
- One branch cancellation must not abort unrelated branches.

A public method such as `runtime.cancel(node)` is out of scope unless required by the internal design. Prefer only the cancellation behaviour needed by context invalidation and obsolete work.

### 12. In-flight deduplication

If overlapping explicit execution calls require the same node generation, invoke its loader or derive function once and share the active promise.

Example:

```ts
const first = runtime.execute([Targets]);
const second = runtime.execute([Targets]);
await Promise.all([first, second]);
```

The `Targets` loader should run once for that generation.

If a dependency changes between calls, the new generation must not share the obsolete promise.

Deduplication is per runtime instance.

### 13. Branch-scoped failure handling

Do not reproduce global fail-fast behaviour.

Example:

```text
RootA -> ChildA
RootB -> ChildB
```

If `RootA` fails:

- `ChildA` does not execute.
- The `RootB -> ChildB` branch continues.
- The execution result reports the failed and blocked branch.

Add a small execution error model. A suggested shape is:

```ts
class GraphExecutionError extends Error {
  readonly failures: readonly NodeExecutionFailure[];
}
```

A failure record should minimally identify:

- Node key
- Whether it directly failed or was blocked by a dependency
- Error where applicable

Keep this narrow. Do not build the full diagnostics system yet.

### 14. Error normalisation

Normalise unknown thrown values:

```ts
const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
```

Abort detection should not depend only on `instanceof DOMException`, because runtime environments vary. Add one small helper with documented semantics.

Avoid logging from the core. Consumers and future diagnostics decide how errors are presented.

### 15. Runtime observation

Provide the minimum framework-agnostic observation mechanism needed by future Vue integration and current behavioural tests.

Suggested shape:

```ts
type RuntimeListener = () => void;

const unsubscribe = runtime.onChange(listener);
```

Requirements:

- Notify after committed runtime-state changes.
- Do not notify for discarded obsolete results.
- Return an idempotent unsubscribe function.
- Do not expose mutable state through notifications.

Keep this generic. Do not import Vue or implement node-specific composables.

If observation can be deferred without compromising Milestone 3 or tests, document that decision. However, adding a small graph-level subscription now is preferable to exposing internal maps later.

### 16. Runtime-state inspection

Provide typed read-only state access:

```ts
runtime.getState(NodeHandle);
```

Optionally provide:

```ts
runtime.getStates();
```

only if required for tests or future integration.

Returned objects must not permit mutation of internal runtime state. Return frozen snapshots or fresh readonly objects.

Do not expose active promises or abort controllers publicly.

## Suggested source organisation

Keep the implementation cohesive. A reasonable structure is:

```text
src/core/
├── errors.ts
├── execution.ts
├── graph.ts
├── index.ts
├── nodes.ts
├── runtime.ts
└── types.ts
```

Do not split the planner, state machine, and executor into many abstractions unless the implementation becomes unclear without it.

Suggested tests:

```text
tests/core/
├── execution-order.spec.ts
├── execution-failure.spec.ts
├── runtime-context.spec.ts
├── runtime-deduplication.spec.ts
├── runtime-races.spec.ts
├── runtime-state.spec.ts
└── runtime-types.test.ts
```

Retain and update existing Milestone 1 tests.

## Public API direction

A reasonable Milestone 2 public surface is:

```ts
createGraph(...)
createGraphRuntime(graph)

runtime.getState(node)
runtime.setContext(contextNode, value)
runtime.execute(nodes)
runtime.onChange(listener)
```

Export public runtime state and execution error types from `src/core/index.ts` and the root entry point.

Do not export:

- Mutable state records
- Internal maps or sets
- Planner internals
- Active execution records
- Abort controllers
- Generation mutation helpers
- Test utilities

Exact naming may change if the implementation reveals a simpler coherent API. Document deviations.

## Tests

Use Vitest 3.0.7 and TypeScript.

### Runtime initial state

Test:

- Context nodes begin with their initial value and successful fresh state.
- Data nodes begin without a successful load.
- Derived nodes begin without a successful value.
- Two runtimes created from the same graph have independent state.
- Returned state cannot mutate internal state.

### Context updates

Test:

- Typed value update.
- Equal value causes no generation change or notification.
- Changed value increments generation.
- Direct descendants become stale.
- Transitive descendants become stale.
- Unrelated nodes remain unchanged.
- Existing descendant data is preserved.
- Updates do not automatically execute stale nodes.

### Dependency execution

Test:

- Empty target list resolves without execution.
- A root data node executes.
- Parent executes before child.
- Multi-level ordering is correct.
- Independent branches execute concurrently.
- Multiple parents complete before a child executes.
- Only requested targets and their ancestors execute.
- Fresh successful nodes are skipped.
- Stale nodes execute again.
- Context nodes are never loaded.
- Derived nodes execute after dependencies.
- Loaders and derived functions receive correctly typed dependency values.

Avoid fragile timing tests. Use deferred promises or explicit barriers to prove concurrency and ordering.

### Errors and branch isolation

Test:

- Initial data load failure.
- Non-`Error` throw normalisation.
- Derived-function failure.
- Failed parent blocks child.
- One failed branch does not prevent an independent branch from succeeding.
- Execution rejects only after executable independent branches settle.
- Failure result identifies failed and blocked nodes.
- Refresh failure retains previous successful data.
- A later successful execution clears the error.

### Cancellation and races

Test:

- Context change aborts affected in-flight work.
- Context change does not abort unrelated work.
- Abort is not stored as a business error.
- Loader ignoring abort cannot commit an obsolete result.
- New generation result wins over older result.
- Runtime can execute successfully after cancellation.

Use deferred promises. Do not use arbitrary real-time delays.

### In-flight deduplication

Test:

- Overlapping execution calls share one loader invocation.
- Overlapping targets sharing an ancestor load the ancestor once.
- Different runtimes do not share work.
- A new generation does not reuse an obsolete in-flight attempt.

### Observation

Test:

- Subscribers receive committed state changes.
- Unsubscribe stops notifications.
- Unsubscribe is idempotent.
- Discarded obsolete results do not notify.
- One listener throwing does not break runtime state or other listeners. Recommended behaviour is to isolate listener errors without logging from the core.

### Type tests

Add compile-time checks for:

- `getState` infers each node value type.
- `setContext` accepts the context value type.
- `setContext` rejects a wrong value type.
- `setContext` rejects data and derived nodes.
- `execute` accepts node handles.
- Loader `get` remains limited to declared dependencies.
- Derived `get` remains limited to declared dependencies.
- Runtime public APIs do not require `any`.

Use ordinary TypeScript test files with intentional `@ts-expect-error` assertions. Do not add a new type-test dependency.

## Documentation updates

Update only documentation affected by implemented Milestone 2 decisions.

At minimum:

- Update `docs/architecture/03-scheduler-transactions-and-concurrency.md` to distinguish implemented explicit execution from proposed Milestone 3 scheduling and Milestone 4 transactions.
- Update `docs/architecture/05-mutations-failures-and-cache.md` with the implemented initial-load, refresh-error, and branch-failure semantics.
- Update `docs/api/01-proposed-api.md` with the implemented runtime API and clearly label automatic scheduling and Vue APIs as proposed.
- Update `docs/implementation/01-roadmap.md`:
  - Mark generated Milestone 2 work as prepared.
  - Leave offline validation pending.
  - Do not mark Milestone 3 or later work complete.
- Add `docs/implementation/07-runtime-execution-implementation-note.md` containing:
  - Status
  - Files changed
  - Runtime state model
  - Execution and failure semantics
  - Static checks performed
  - Offline validation commands
  - Known risks and questions for Milestone 3

Add or update an ADR only if implementation materially changes an accepted architecture decision.

## Out of scope

Do not implement:

- Automatic execution from subscriptions or subscription
- Microtask scheduling
- Execution coalescing across graph changes
- Prefetch
- Automatic refresh
- Vue plugin or composables
- Query groups
- Atomic multi-context transactions
- Nested transactions
- Domain events
- Refresh intervals
- Polling
- Retry or backoff policies
- Optimistic mutations
- Cache garbage collection
- Metrics
- Snapshot export
- Devtools UI
- Dynamic graph registration
- Configurable concurrency limits
- Server-side rendering

Explicit runtime execution is required now. Automatic subscription-driven execution is Milestone 3.

## Quality requirements

- Prefer a small cohesive runtime implementation.
- Keep mutable runtime state separate from immutable definitions.
- Keep `src/core` independent of Vue, Pinia, devtools, and playground code.
- Do not use `any`.
- Do not suppress TypeScript errors except intentional `@ts-expect-error` assertions in type tests.
- Avoid arbitrary timers in tests.
- Avoid console logging in the core.
- Avoid global state.
- Do not expose mutable maps, sets, arrays, promises, or controllers.
- Ensure all internal promises have defined rejection handling.
- Use `Object.is` for context equality unless a concrete requirement justifies comparison options.
- Make race handling generation-based, not timing-based.
- Keep changes within Milestone 2.

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
- Search for console logging in core source.
- Confirm no scheduler, subscription, transaction, event, polling, mutation, metric, snapshot, or Vue-integration modules were added.
- Confirm mutable runtime state is not added to node-definition types or objects.
- Confirm tests represent every required behavioural category.
- Confirm documentation marks validation as pending.

These checks are not proof that TypeScript, Vitest, or the build passes.

## Offline validation for the developer

Ask the developer to run from the repository root:

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

- A graph runtime can be created from a validated graph.
- Mutable state is separate from node definitions.
- Context, data, and derived states are represented accurately.
- Context updates invalidate transitive descendants without auto-executing them.
- Explicit execution includes required ancestors only.
- Dependencies execute before children.
- Independent branches can execute concurrently.
- Data loaders and derived functions receive typed dependency access.
- Per-attempt abort signals exist.
- Generations prevent obsolete commits.
- Overlapping execution deduplicates the same node generation.
- Failed parents block dependent children only.
- Independent branches continue after another branch fails.
- Refresh errors preserve successful stale data.
- Runtime state inspection is typed and read-only.
- Required behavioural and type tests are present.
- Public exports are intentional.
- Core remains independent of Vue and the other logical layers.
- Documentation marks validation pending.
- No Milestone 3 or later behaviour is implemented.

## Validated acceptance criteria

Milestone 2 is complete only after the developer reports:

- `pnpm install --frozen-lockfile` succeeds.
- `pnpm check:boundaries` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test:run` succeeds.
- `pnpm build` succeeds.
- The playground still starts and renders.
- Dependency ordering, independent concurrency, deduplication, cancellation, racing-generation, branch-failure, and refresh-error tests pass.
- All runtime type tests pass.
- No unhandled promise rejections occur.
- Any reported issues have been fixed and revalidated.

## Expected completion response

Provide:

1. A concise summary of the runtime and execution engine prepared.
2. Files added, changed, and removed.
3. The final public runtime API.
4. Runtime state, execution, cancellation, deduplication, and failure decisions.
5. Static checks performed and their results.
6. Project commands not run in the contained environment.
7. Exact offline validation steps.
8. Assumptions, deviations, known limitations, and risks for Milestone 3.

Do not claim that type checking, tests, builds, or the playground passed unless the developer later reports those results.
