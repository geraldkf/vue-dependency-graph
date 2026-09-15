# Milestone 10E: Diagnostic Snapshots and Redaction

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10E adds a versioned diagnostic snapshot that is safe to export by default. It introduces typed node-level value policy, deterministic runtime inspection sections, bounded error serialisation, and failure-isolated redaction.

## Snapshot contract

`GraphRuntime.createDiagnosticSnapshot()` returns immutable `GraphDiagnosticSnapshotV1` containing:

- schema version, creation timestamp, and runtime ID;
- topology in graph registration order;
- node state in graph registration order;
- scheduler state with a copied safe error;
- subscription state in graph registration order;
- refresh-policy session inspection;
- optional metrics from an inspectable configured sink;
- retained and dropped diagnostic counts.

Snapshot creation emits no diagnostic record and does not notify, schedule, load, refresh, mutate, or settle graph work.

## Value policy

Every node definition receives immutable diagnostics metadata. Value handling defaults to `"omit"`.

A node may specify:

- `"omit"`;
- `"include"`;
- a synchronous redactor strongly typed to the node value.

Included and redacted output accepts null, booleans, finite numbers, strings, arrays, and plain objects. Cycles, functions, symbols, bigint values, non-finite numbers, and non-plain objects are rejected from the diagnostic value. Unsafe full inclusion falls back to omission. Unsafe or throwing redactors produce `redaction-failed` with a safe error marker.

## Error safety

Runtime errors are copied into bounded serialisable records containing name, message, and optional cause. Cause depth is limited and cycles are marked `truncated`. Stack traces and custom enumerable error fields are not exported.

## Internal inspection

The refresh-policy controller exposes a narrow immutable snapshot of session state. The diagnostic emitter exposes its runtime-local ID internally. A configured sink is inspected only when it supplies `getEvents()` or `getMetrics()`; an ordinary sink remains valid and produces a snapshot without collector sections.

## Behavioural coverage

Focused tests cover default omission, explicit inclusion, typed redaction, redactor exceptions, cyclic values, cyclic error causes, deterministic ordering, collector summary, subscriptions, and the absence of observer, scheduler, state, or diagnostic side effects.

## Validation completed in the contained environment

Core boundary validation and strict TypeScript compilation of the core public entry and M10E tests passed with the available compiler. Project dependencies were unavailable, so the repository Vitest, Vue type-check, and production build commands were not run or claimed.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10E remains validation pending until all commands succeed against the combined checkout.

## Next step

After successful offline validation, implement M10F stable snapshot normalisation and the complete observability regression suite.
