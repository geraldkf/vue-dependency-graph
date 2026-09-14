# Milestone 8A: Refresh Policy Definitions and Validation Plan

## Status

Detailed implementation plan prepared for review. No source or test implementation has been applied by this planning step.

## Objective

Introduce the immutable, strongly typed definition layer required by Milestone 8 without adding timers, subscriptions, automatic refresh, retry execution, polling sessions, pause handling, or browser integration.

M8A should make these declarations valid and type safe:

```ts
const ReferenceData = defineDataNode({
  key: "referenceData",
  initialValue: [] as ReferenceItem[],
  load: ({ signal }) => api.getReferenceData(signal),
  refresh: staleAfter({ durationMs: 30_000 }),
});

const Notifications = defineDataNode({
  key: "notifications",
  initialValue: [] as Notification[],
  load: ({ signal }) => api.getNotifications(signal),
  refresh: refreshInterval({ intervalMs: 60_000 }),
});

const ReportProgress = defineDataNode({
  key: "reportProgress",
  initialValue: undefined as ReportProgress | undefined,
  load: ({ signal }) => api.getReportProgress(signal),
  refresh: pollUntil<ReportProgress | undefined>({
    intervalMs: 2_000,
    stopWhen: value => value?.state === "completed",
    failWhen: value => value?.state === "failed",
    timeoutMs: 10 * 60_000,
  }),
});
```

M8A ends after definition, validation, public export, documentation, and test coverage. Declared policies remain inert until M8B adds runtime interpretation.

## Decisions fixed for M8A

### One policy per data node

`DataNodeDefinition` receives one `refresh` property rather than a list. This keeps policy ordering and composition out of the first release.

### Data nodes only

Context nodes remain controlled through `setContext(...)`. Derived nodes remain recalculated through dependency invalidation and explicit refresh. Neither accepts a refresh-policy option.

### Explicit generic for `pollUntil(...)`

Use `pollUntil<TValue>(...)`. TypeScript cannot reliably infer the surrounding data-node value type through a nested generic factory callback. Requiring an explicit value type avoids contextual `any`, avoids weak `unknown` callbacks, and keeps the implementation simple.

```ts
pollUntil<ReportProgress>({
  intervalMs: 2_000,
  stopWhen: value => value.state === "completed",
});
```

The `DataNodeOptions<TValue, ...>.refresh` field is still typed as `RefreshPolicy<TValue>`, so assigning a policy for the wrong value type fails at compile time.

### Retry belongs to interval and polling policies

`staleAfter(...)` only marks when a refresh is due. Automatic retry belongs to repeating policies in the first release:

- `refreshInterval(...)`
- `pollUntil(...)`

If a stale-after refresh later fails, normal node error and stale state remain visible. A concrete use case can add stale-after retry without changing the initial definition model opportunistically.

### No runtime error classes in M8A

Timeout, business-condition, and retry-exhaustion errors are runtime outcomes. Their classes should be added in the M8D and M8E slices that produce them, not exported before anything can throw them.

### Policy factories validate and freeze

Public factories reject invalid options immediately and return recursively frozen descriptors. Graph creation adds defensive validation for forged definitions entering through JavaScript or unsafe casts.

## Public contracts

Add `src/core/refresh-policies/types.ts`.

```ts
export interface StaleAfterPolicy {
  readonly kind: "stale-after";
  readonly durationMs: number;
}

export type RetryStrategy = "fixed" | "exponential";

export interface FixedRetryPolicy {
  readonly strategy: "fixed";
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly jitterRatio: number;
}

export interface ExponentialRetryPolicy {
  readonly strategy: "exponential";
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly multiplier: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export type RetryPolicy = FixedRetryPolicy | ExponentialRetryPolicy;

export interface RefreshIntervalPolicy {
  readonly kind: "interval";
  readonly intervalMs: number;
  readonly retry: RetryPolicy | undefined;
}

export interface PollUntilPolicy<TValue> {
  readonly kind: "poll-until";
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly stopWhen: (value: TValue) => boolean;
  readonly failWhen: ((value: TValue) => boolean) | undefined;
  readonly retry: RetryPolicy | undefined;
  /** Carries TValue for inference without adding runtime state. */
  readonly __valueType?: TValue;
}

export type RefreshPolicy<TValue> =
  | StaleAfterPolicy
  | RefreshIntervalPolicy
  | PollUntilPolicy<TValue>;

export type AnyRefreshPolicy = RefreshPolicy<unknown>;
```

`StaleAfterPolicy` and `RefreshIntervalPolicy` do not depend on the node value type. `PollUntilPolicy<TValue>` uses typed predicates and a phantom value member consistent with existing node and event typing conventions.

## Factory option contracts

Add `src/core/refresh-policies/policy.ts`.

```ts
export interface StaleAfterOptions {
  readonly durationMs: number;
}

export interface FixedRetryOptions {
  readonly strategy: "fixed";
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly jitterRatio?: number;
}

export interface ExponentialRetryOptions {
  readonly strategy: "exponential";
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly multiplier?: number;
  readonly maxDelayMs: number;
  readonly jitterRatio?: number;
}

export type RetryOptions = FixedRetryOptions | ExponentialRetryOptions;

export interface RefreshIntervalOptions {
  readonly intervalMs: number;
  readonly retry?: RetryOptions;
}

export interface PollUntilOptions<TValue> {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly stopWhen: (value: TValue) => boolean;
  readonly failWhen?: (value: TValue) => boolean;
  readonly retry?: RetryOptions;
}

export const staleAfter = (
  options: StaleAfterOptions
): StaleAfterPolicy;

export const refreshInterval = (
  options: RefreshIntervalOptions
): RefreshIntervalPolicy;

export const pollUntil = <TValue>(
  options: PollUntilOptions<TValue>
): PollUntilPolicy<TValue>;
```

### Defaults

Apply defaults while creating the immutable descriptor:

- `jitterRatio`: `0`
- exponential `multiplier`: `2`
- omitted `retry`: `undefined`
- omitted `failWhen`: `undefined`

Do not add default intervals, timeout values, or retry counts. These values materially affect network activity and must be explicit.

### Descriptor shape

Factories return plain frozen objects containing only normalized runtime fields. Do not retain the caller-owned options object.

```ts
Object.freeze({
  kind: "interval",
  intervalMs: options.intervalMs,
  retry: normalizeRetry(options.retry),
});
```

`normalizeRetry(...)` returns a new frozen object. This prevents later mutation through the original nested retry object.

## Validation rules

Use small private helpers in `policy.ts`. Error messages should name the invalid field and expected constraint.

### Durations

These fields must be finite numbers greater than zero:

- `durationMs`
- `intervalMs`
- `timeoutMs`
- fixed `delayMs`
- exponential `initialDelayMs`
- exponential `maxDelayMs`

Reject `0`, negative numbers, `NaN`, `Infinity`, `-Infinity`, strings, and missing values from untyped calls.

### Retry counts

`maxRetries` must be a finite, non-negative integer.

- `0` is valid and means no retries after the failed policy-owned attempt.
- Fractional, negative, infinite, and non-number values are invalid.

### Exponential multiplier

`multiplier` must be finite and at least `1`.

A multiplier below `1` silently reduces retry delays and contradicts exponential backoff. A default of `2` is applied when omitted.

### Maximum delay

For exponential retry, `maxDelayMs` must be greater than or equal to `initialDelayMs`.

### Jitter

`jitterRatio` must be finite and in the inclusive range `0` to `1`.

### Predicates

`pollUntil.stopWhen` must be a function. `failWhen`, when supplied, must be a function. M8A stores the function references but never invokes them.

### Defensive policy-shape validation

Export an internal validator from `policy.ts` or a separate internal `validation.ts`:

```ts
export const assertValidRefreshPolicy = (
  policy: unknown,
  nodeKey: string
): asserts policy is AnyRefreshPolicy;
```

The validator supports only the three known discriminators and rejects:

- non-object values;
- arrays;
- unknown or missing `kind`;
- missing required fields;
- invalid nested retry shapes;
- invalid polling predicates.

The error should include the node key so forged graph-definition failures are actionable.

Do not accept duck-typed aliases, legacy names, or extra policy kinds.

## Error ownership

### Factory argument errors

Factory validation should throw `RangeError` for invalid numeric ranges and `TypeError` for invalid runtime shapes such as a missing predicate or non-object retry value.

This is configuration validation, not graph-topology validation, so it should not use `GraphValidationError`.

### Graph validation errors

Add one graph validation code:

```ts
| "INVALID_REFRESH_POLICY"
```

When `createGraph(...)` receives a forged data-node descriptor with invalid refresh metadata, wrap the validation failure in `GraphValidationError` with code `INVALID_REFRESH_POLICY` and include the node key and original reason in the message.

If a forged context or derived node contains a `refresh` property, reject it with the same code. This defends the data-node-only contract at runtime without adding policy handling to those definitions.

## Node definition integration

Update `src/core/graph/types.ts`.

### Data definition

Add the value-typed property:

```ts
export interface DataNodeDefinition<...> extends NodeDefinition<...> {
  readonly initialValue: TValue;
  readonly load: (context: LoadContext<TDependencies>) => Promise<TValue>;
  readonly invalidatedBy: TInvalidatedBy;
  readonly refresh: RefreshPolicy<TValue> | undefined;
}
```

Add the same optional property to `DataNodeOptions`:

```ts
readonly refresh?: RefreshPolicy<TValue>;
```

Do not add a new generic parameter for policy type. Consumers need the value relationship, not preservation of one exact policy subtype through the node handle. Avoid widening the already long `DataNodeDefinition` generic list.

### Context and derived definitions

Do not add `refresh` to `ContextNodeOptions`, `ContextNodeDefinition`, `DerivedNodeOptions`, or `DerivedNodeDefinition`. Compile-time tests should prove rejection.

### Definition construction

Update `defineDataNode(...)` to:

- validate `options.refresh` when present;
- retain the already frozen policy descriptor returned by a public factory;
- expose `refresh: undefined` when omitted;
- freeze the final node descriptor as today;
- avoid executing polling predicates.

Do not clone predicate functions or add runtime controller state to the definition.

## Graph validation integration

Update `src/core/graph/graph.ts` after basic node-shape and key validation but before graph indexes are finalized.

For every registered node:

1. Read a possible `refresh` property through a narrow defensive record view.
2. If it is absent, continue.
3. If the node kind is not `data`, throw `GraphValidationError("INVALID_REFRESH_POLICY", ...)`.
4. Validate the policy descriptor using `assertValidRefreshPolicy(...)`.
5. Convert configuration `TypeError` or `RangeError` into the graph validation error while retaining the reason text.

Graph creation must not invoke `stopWhen` or `failWhen`, allocate timers, read time, or build runtime policy indexes in M8A.

A dedicated graph policy index is unnecessary. The runtime can later inspect registered data definitions when creating its policy controller. Add an index only if M8B source evidence shows repeated graph scans on an active path.

## Public exports

Update `src/core/index.ts` to export:

- `staleAfter`
- `refreshInterval`
- `pollUntil`
- `RefreshPolicy`
- `StaleAfterPolicy`
- `RefreshIntervalPolicy`
- `PollUntilPolicy`
- `RetryPolicy`
- `RetryStrategy`
- the public options types

Do not export:

- `AnyRefreshPolicy`
- `assertValidRefreshPolicy`
- normalization helpers
- internal discriminator records

The root `src/index.ts` already re-exports the core barrel. No additional root wiring should be needed unless source inspection proves otherwise.

## Files to add

```text
src/core/refresh-policies/types.ts
src/core/refresh-policies/policy.ts
tests/core/refresh-policy-definitions.spec.ts
tests/core/refresh-policy-types.test.ts
docs/implementation/80-milestone-8a-policy-definitions-validation-note.md
```

The implementation note is written with status `Prepared; offline validation pending` after source and tests are created. This document remains the pre-implementation plan.

## Files to update

```text
src/core/graph/types.ts
src/core/graph/node.ts
src/core/graph/graph.ts
src/core/graph/errors.ts
src/core/index.ts
tests/core/node-definitions.spec.ts
tests/core/graph-validation.spec.ts
docs/api/01-public-api.md
docs/architecture/02-graph-and-node-model.md
docs/architecture/04-events-refresh-and-polling.md
docs/decisions/ADR-012-refresh-policies-and-polling.md
docs/implementation/01-roadmap.md
docs/implementation/78-milestone-8-refresh-polling-plan.md
docs/testing/01-test-strategy.md
docs/README.md
```

Keep changes surgical. Do not touch runtime, execution, scheduling, subscriptions, Vue composables, Pinia, or playground source in M8A.

## Behavioural tests

Add `tests/core/refresh-policy-definitions.spec.ts`.

### Immutable definitions

Verify:

- each factory returns a frozen descriptor;
- nested retry descriptors are frozen;
- changing the caller-owned options object after creation does not mutate the descriptor;
- data-node descriptors expose the policy unchanged;
- data nodes without a policy expose `refresh: undefined`;
- predicates are not invoked during policy creation, node definition, or graph creation.

### Defaults

Verify:

- jitter defaults to `0`;
- exponential multiplier defaults to `2`;
- omitted retry remains `undefined`;
- omitted failure predicate remains `undefined`.

### Numeric validation

Use focused parameterized cases for:

- zero and negative durations;
- `NaN` and infinities;
- fractional and negative retry counts;
- exponential multiplier below `1`;
- maximum delay below initial delay;
- jitter below `0` and above `1`.

Avoid testing every field through every factory when one shared helper owns the behaviour. Add one integration case per factory plus focused helper-observable cases.

### Shape validation

Using casts only at the untyped boundary, verify:

- missing `stopWhen` is rejected;
- non-function `failWhen` is rejected;
- unknown policy kind is rejected;
- malformed retry shape is rejected;
- forged context and derived policies are rejected by graph creation;
- forged invalid data policy produces `INVALID_REFRESH_POLICY` and names the node.

### Existing definitions

Extend `node-definitions.spec.ts` only for existing descriptor integration:

- data node includes `refresh: undefined` by default;
- a policy descriptor is retained;
- context and derived descriptor behaviour remains unchanged.

Do not duplicate all factory tests there.

## Compile-time tests

Add `tests/core/refresh-policy-types.test.ts`. It is checked by `vue-tsc` and excluded from Vitest according to existing convention.

Cover:

- `pollUntil<Progress>` predicates receive `Progress`.
- `PollUntilPolicy<Progress>` retains its value type.
- A `PollUntilPolicy<OtherValue>` cannot be assigned to a `Progress` data node.
- `staleAfter(...)` and `refreshInterval(...)` can be used with any data-node value type.
- Invalid retry strategy values fail compilation.
- Missing required options fail compilation.
- Context nodes reject `refresh`.
- Derived nodes reject `refresh`.
- Existing data-node value, dependency getter, loader result, and event-invalidation inference remains unchanged.

Use `@ts-expect-error` immediately above the failing expression. Avoid `any`; use `unknown` plus a cast only for runtime defensive tests.

## Documentation updates

### Public API

Add a `Refresh policy definitions` section marked:

> Milestone 8A defines and validates policy metadata. Runtime interpretation begins in Milestone 8B.

Show one example for each factory and explicitly use a generic argument for `pollUntil<TValue>(...)`.

### Architecture

Document immutable metadata on data nodes and state that runtime sessions, timers, retry counters, and pause state are not definition state.

### ADR

Change ADR-012 from `Proposed for Milestone 8` to `Accepted for Milestone 8 design; M8A implementation pending` when this plan is approved. Do not mark it implemented until source and offline validation are complete.

### Roadmap

Record M8A as `Detailed implementation plan prepared` now. After source preparation, point to the implementation note and keep validation unchecked until the full command suite is reported successful.

## Static review checklist

Before handing M8A source files to offline validation, confirm:

- no timer APIs appear under `src/core/refresh-policies`;
- no runtime controller or mutable policy session was introduced;
- no imports from Vue, Pinia, playground, or browser globals exist in core;
- only data-node options accept `refresh`;
- policy predicates are stored but never invoked;
- all public option and descriptor collections are readonly;
- nested retry descriptors are copied and frozen;
- no `any`, TypeScript suppression, console logging, or unrelated refactor was added;
- the public barrel exports only intended consumer contracts;
- graph-validation failure occurs before runtime creation;
- previous event and node inference remains intact.

## Validation commands

Run against the combined checkout:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M8A remains `Prepared; offline validation pending` until all four commands pass and their results are reported.

No manual playground validation is required for M8A because policies are intentionally inert and no playground behaviour changes.

## Completion criteria

M8A is complete only when:

- all three policy factories and their public types are implemented;
- valid descriptors are normalized and deeply immutable;
- invalid options fail with deterministic errors;
- only data nodes accept policy metadata;
- forged policy metadata is rejected during graph creation;
- compile-time value typing is covered;
- existing node and event typing remains green;
- maintained documentation distinguishes policy definition from runtime behaviour;
- boundary, typecheck, test, and build commands pass.

## Deferred to later slices

M8A does not implement:

- timers or injected clocks;
- subscription ownership response;
- policy execution origin;
- stale-after expiration;
- interval refresh;
- polling condition evaluation;
- timeout errors;
- retry delay calculation;
- pause and resume;
- Vue/browser lifecycle integration;
- runtime policy inspection;
- playground scenarios.

## Next task

After this plan is reviewed, implement the source and tests exactly within the M8A boundary, then create `docs/implementation/80-milestone-8a-policy-definitions-validation-note.md` with the prepared files and offline validation handoff.
