# Milestone 2: Runtime State and Execution

## Status

Implementation complete; final combined offline validation pending.

The runtime and execution model is used by the subscription scheduler, prefetch and refresh operations, Vue composables, Pinia integration, and every playground scenario. Final validation should use the current combined repository rather than attempting to recreate the original isolated Milestone 2 state.

## Delivered capabilities

- Mutable runtime state separated from immutable definitions and graph topology
- Independent runtime instances created from one graph
- Typed, read-only node state snapshots
- Separate execution status and freshness
- Typed context updates
- Transitive descendant invalidation
- Dependency-aware explicit execution
- Concurrent independent branches and sibling dependencies
- Attempt-scoped abort controllers
- Generation and token protection against obsolete results
- Same-generation in-flight deduplication
- Branch-scoped failure handling
- Previous-value retention during refresh and refresh failure
- Runtime change observation
- Behavioural and compile-time tests

## Runtime state

```ts
interface NodeRuntimeState<TData> {
  readonly data: TData;
  readonly status: "idle" | "loading" | "success" | "refreshing" | "error";
  readonly freshness: "fresh" | "stale";
  readonly error: Error | null;
  readonly generation: number;
  readonly hasSuccessfulValue: boolean;
}
```

Status and freshness are independent:

- A node may retain successful stale data while refreshing.
- A node may remain stale after a failed refresh while keeping its previous successful value.
- Context nodes begin successful and fresh.
- Data nodes begin with their initial value but no successful load.
- Derived nodes begin with `undefined` and no successful derivation.

`runtime.getState(node)` returns a fresh frozen snapshot. It does not expose the internal mutable record.

## Runtime isolation

```ts
const firstRuntime = createGraphRuntime(graph);
const secondRuntime = createGraphRuntime(graph);
```

Definitions and topology are shared, but values, statuses, errors, generations, listeners, and active attempts are owned independently by each runtime.

## Context updates

```ts
runtime.setContext(JobSeekerId, 123);
```

A changed value:

- updates the registered context state
- increments its generation
- marks transitive descendants stale
- preserves descendant data
- clears obsolete descendant errors
- aborts affected active attempts
- prevents ignored-abort results from committing

An `Object.is` equal value is a no-op. Later Milestone 3 work added automatic scheduling for affected subscribed descendants, but invalidation and generation semantics originate from the Milestone 2 runtime model.

## Explicit execution

```ts
await runtime.execute([CurrentPointPeriod]);
```

Execution:

- validates all requested handles before loader work starts
- includes required transitive ancestors
- skips fresh successful values
- executes data-node loaders with typed dependency access and an attempt-scoped signal
- evaluates derived nodes synchronously after successful fresh parents
- runs independent parents and top-level targets concurrently
- avoids unrelated branches
- shares matching active attempts

The existing execution engine is also used by the scheduler, prefetch, and refresh operations. There is no parallel implementation path.

## Generations, tokens, and cancellation

Each attempt captures the node generation and an attempt token. A success or failure commits only when:

- the generation still matches
- the attempt token is still active
- the attempt has not been aborted or superseded

This protects state even when an API ignores its abort signal. Abort and superseded outcomes are not stored as business errors.

## In-flight deduplication

Overlapping work for the same node generation shares one active attempt:

```ts
await Promise.all([
  runtime.execute([Targets]),
  runtime.execute([Targets]),
]);
```

Deduplication is local to one runtime. A new generation does not reuse obsolete work.

Later execution origins, including scheduler, prefetch, and refresh, reuse the same node-level sharing mechanism and attach ownership to the active attempt.

## Branch-scoped failure

A direct failure blocks only descendants that require the failed node. Independent branches continue and settle.

```ts
class GraphExecutionError extends Error {
  readonly failures: readonly NodeExecutionFailure[];
}
```

Failure records distinguish:

- `failed`: the node's loader or derived function failed
- `blocked`: a required dependency failed

The execution promise rejects only after all executable independent branches settle. Per-node state remains available for consumers and diagnostics.

Unknown thrown values are normalised to `Error`. Listener errors are isolated from runtime state transitions.

## Value retention and recovery

- Initial execution uses `loading`.
- Re-execution with a previous successful value uses `refreshing`.
- Successful execution stores the result, clears the error, and marks the node fresh.
- Initial failure records the error without claiming a successful value.
- Refresh failure retains the successful value, records the new error, and leaves the node stale.
- A later successful execution clears the prior error.

## Observation

```ts
const stopObserving = runtime.onChange(() => {
  const state = runtime.getState(Targets);
});
```

Observers run after committed observable transitions. The stop function is idempotent. Listener failures do not stop later listeners or roll back state. Obsolete discarded results do not notify as success or failure.

The observation implementation was later extracted into its own closure-based capability without changing this public contract.

## Test coverage

Behavioural tests cover:

- initial context, data, and derived state
- independent runtimes
- read-only snapshot behaviour
- equal and changed context updates
- direct, transitive, and unrelated invalidation
- dependency order and independent concurrency
- derived evaluation
- fresh-value reuse
- direct and blocked failures
- independent branch continuation
- refresh failure and recovery
- cancellation and ignored-abort races
- generation and token protection
- same-generation attempt sharing
- runtime observation and listener isolation

Compile-time tests cover typed state access, typed context updates, rejection of invalid context targets or values, node-handle execution, and typed dependency getters.

## Validation commands

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

## Historical record

The original 760-line implementation prompt is removed from active documentation because it describes pre-implementation scope, forbidden later features, and contained-environment constraints. The current API, architecture documents, tests, source, and this summary describe the implemented behaviour. Git history remains the source for point-in-time implementation instructions.
