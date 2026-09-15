# Milestone 9A: Mutation Definitions and Basic Execution

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice introduces typed remote mutation commands without changing graph state. It deliberately does not add direct cache reconciliation, invalidation, success event publication, optimistic updates, rollback snapshots, failure classification, retry, deduplication, or mutation diagnostics.

## Public API

`defineMutation(...)` creates a frozen definition containing:

- a non-blank mutation key;
- a typed asynchronous `execute(...)` function;
- compile-time input and result information.

`MutationExecuteContext<TInput>` provides the exact input and an attempt-scoped `AbortSignal`. `MutationInput<TMutation>` and `MutationResult<TMutation>` extract the definition types.

`GraphRuntime` now exposes:

```ts
runtime.mutate(definition, input): Promise<TResult>
```

Each call invokes the definition once and returns its remote result. Synchronous throws and asynchronous rejections become rejection of the returned mutation promise without wrapping the original error.

## Runtime ownership

A small framework-agnostic mutation controller owns M9A execution. It creates a fresh `AbortController` per call and does not use graph state, graph topology, subscriptions, scheduling, refresh policies, the data-load concurrency limiter, or notification buffering.

Plain mutation calls remain independent while a graph transaction is open, matching the transaction-ownership model used by other plain runtime operations. Mutations cannot see staged transaction state because `GraphTransaction` does not expose `mutate(...)`. Mutation completion is not committed or discarded by an unrelated transaction.

The signal is introduced now so later slices can retain one execution contract. M9A intentionally exposes no caller cancellation option because cancellation and unknown remote outcomes must be designed together in M9E.

## Files changed

- `src/core/mutations/types.ts`
- `src/core/mutations/mutation.ts`
- `src/core/mutations/mutation-controller.ts`
- `src/core/runtime.ts`
- `src/core/index.ts`
- `tests/core/mutation-definitions.spec.ts`
- `tests/core/mutation-execution.spec.ts`
- `tests/core/mutation-types.test.ts`
- maintained Milestone 9 documentation

## Behavioural coverage

Focused tests cover:

- immutable mutation definitions;
- blank keys and malformed execute functions;
- one invocation with the exact input;
- a fresh non-aborted signal for each call;
- typed remote results;
- preservation of the original rejection;
- no graph state change or observer notification;
- independent calls across runtimes;
- independent execution while a graph transaction is open.

Compile-time coverage verifies input inference, result inference, utility types, required input fields, input property types, and explicit result contracts.

## Design correction from planning

The initial plan proposed rejecting `runtime.mutate(...)` while any transaction was open. Source reconciliation showed that this would conflict with the established explicit ownership model and could not distinguish a callback-owned call from another independent caller. M9A therefore treats plain mutation execution like plain execute, prefetch, and refresh work: it remains independent and has no ambient transaction participation.

## Validation completed in the contained environment

- Core boundary validation passed.
- A strict standalone TypeScript check over `src/core/**/*.ts` passed.
- A focused strict TypeScript check over the mutation type test passed.
- Static documentation and ZIP checks are completed when the prepared package is produced.

Repository dependencies are not installed in the contained environment, so the full Vue typecheck, Vitest suite, and production build remain offline responsibilities.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9A remains validation pending until all four commands succeed against the combined checkout.

## Next task

After successful M9A validation, proceed with M9B atomic direct cache reconciliation. M9B should introduce effect typing and runtime behaviour together rather than exposing inert callback options in M9A.
