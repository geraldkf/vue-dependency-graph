# Milestone 10A: Diagnostic Foundation

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10A introduces the optional framework-agnostic diagnostic foundation without instrumenting the existing runtime lifecycle in depth. It establishes the public contracts, one runtime-local failure-isolating emitter, deterministic identifiers, and caller-operation request events that later M10 steps will extend.

## Delivered contracts

The core now exports:

- `GraphDiagnosticEvent`;
- `GraphDiagnosticEventBase`;
- `GraphDiagnosticEventType`;
- `GraphDiagnosticOperationKind`;
- `GraphDiagnosticSink`;
- `GraphDiagnosticsEnvironment`;
- `GraphDiagnosticsOptions`;
- the initial runtime-created and operation-requested event types.

`GraphRuntimeOptions` accepts optional `diagnostics` configuration. Omitting diagnostics or supplying diagnostics without a sink preserves a no-op path and does not create a runtime ID or read the diagnostics clock.

## Diagnostic emitter

`src/core/diagnostics/diagnostic-emitter.ts` is the only M10A module that invokes the configured sink.

It owns:

- runtime-local sequence numbers;
- runtime-local operation numbers;
- runtime identity creation;
- timestamps;
- immutable event records;
- immutable node-key arrays;
- sink exception isolation.

The emitter is internal and is not exported from the core barrel. Capabilities do not call sinks directly.

## Initial events

M10A emits:

- `runtime.created`;
- `operation.execute.requested`;
- `operation.prefetch.requested`;
- `operation.refresh.requested`;
- `operation.query-prefetch.requested`;
- `operation.query-refresh.requested`.

The runtime-created event retains graph registration order. Operation events retain caller target order. Query events include the query key and resolved query node keys.

These records describe runtime creation and caller intent. They do not yet imply that a loader started, a fresh value was skipped, an active attempt was reused, a refresh was prepared, or an operation succeeded. Those lifecycle records belong to M10B.

## Behaviour boundaries

M10A preserves:

- existing execution, prefetch, refresh, and query behaviour;
- existing validation timing;
- graph observer semantics;
- scheduler settlement semantics;
- transaction notification buffering;
- runtime concurrency behaviour;
- refresh-policy behaviour;
- mutation behaviour.

Diagnostics remain synchronous and observational. They are not awaited and are not included in `whenSettled()`.

## Tests

Behaviour-focused coverage verifies:

- immutable runtime and operation records;
- sequence and timestamp order;
- deterministic runtime and operation identifiers;
- independent counters for separate runtimes;
- sink failure isolation;
- no diagnostics-environment work when no sink is configured;
- public diagnostics option and event typing.

## Validation completed in the contained environment

- Strict TypeScript compilation of the complete core public entry succeeded using the available global TypeScript compiler and the repository's core environment declaration.
- Strict TypeScript compilation of the new diagnostics tests succeeded using a local Vitest declaration shim.
- Static inspection confirmed the emitter remains private and the core boundary remains framework-agnostic.

Project dependencies were not installed, so the repository `vue-tsc`, Vitest, and Vite commands were not run or claimed.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10A was validated successfully against the combined checkout during Milestone 10 closure.

## Next step

After successful offline validation, implement M10B core execution causality. M10B must propagate operation and cause identity through subscriptions, scheduling, execution, invalidation, prefetch, refresh, queries, dependency execution, concurrency queueing, attempt reuse, fresh skips, outcomes, aborts, and discarded results without changing runtime behaviour.
