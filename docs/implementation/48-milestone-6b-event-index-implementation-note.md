# Milestone 6B: Graph Event Validation and Invalidation Index

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice makes M6A event invalidation declarations part of immutable graph metadata. It validates declarations during `createGraph(...)` and builds a deterministic event-to-node candidate index for later runtime publication.

M6B does not add `runtime.publish(...)`, evaluate predicates, invalidate runtime state, schedule work, stage events in transactions, or change Vue and playground behaviour.

## Graph validation

Graph creation now validates event declaration metadata after normal node topology validation.

Validation covers:

- `invalidatedBy` must be an array when supplied by untyped JavaScript;
- event declarations must be event handles or conditional `{ event, when }` objects;
- event keys must contain a non-whitespace character;
- conditional declarations must provide a function predicate;
- one node cannot declare the same event key more than once;
- context nodes cannot declare event invalidation metadata.

Equivalent event handles with the same key retain key-based identity. Runtime JavaScript cannot compare erased TypeScript payload types, so shared event contracts should be exported from one module rather than independently recreated with incompatible payload types.

New `GraphValidationErrorCode` values are:

```text
INVALID_EVENT_KEY
INVALID_EVENT_DECLARATION
DUPLICATE_EVENT_INVALIDATION
```

Existing node, dependency, and cycle validation behaviour remains unchanged.

## Event invalidation index

Graph creation builds one candidate list per event key. Every candidate records:

- the declared event handle;
- the registered target node;
- the optional predicate.

Candidate order follows graph node registration order. Declaration order within one node is validated, but duplicate keys on that node are rejected.

The index is associated with the graph through a module-private `WeakMap`. This keeps the public `Graph` interface and public barrel unchanged while allowing the later M6C runtime capability to resolve candidates directly by event key without scanning all nodes.

Returned candidate arrays and candidate records are frozen. A missing event key resolves to an immutable empty collection. Separate graphs have independent indexes even when they share event handles or node definitions.

## Capability boundary

Added:

```text
src/core/events/event-index.ts
```

This internal module owns graph-to-index association and candidate lookup. It is deliberately not re-exported from `src/core/index.ts`.

`src/core/graph/graph.ts` owns declaration validation and index construction because event declarations are immutable graph metadata. Runtime predicate evaluation and invalidation remain deferred to M6C.

## Files changed

- `src/core/events/event-index.ts`
- `src/core/graph/graph.ts`
- `src/core/graph/errors.ts`
- `tests/core/event-index.spec.ts`
- `docs/api/01-public-api.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/46-milestone-6-typed-events-plan.md`
- `docs/implementation/48-milestone-6b-event-index-implementation-note.md`
- `docs/README.md`

## Behavioural coverage

The focused graph tests cover:

- deterministic candidate ordering;
- unconditional and conditional candidate records;
- frozen candidate arrays and records;
- key-equivalent event lookup;
- immutable empty lookup results;
- graph-local index isolation;
- duplicate event declarations on one node;
- malformed conditional declarations from untyped input;
- blank event keys from untyped input;
- context-node event declarations from untyped input.

No predicate is evaluated by graph construction.

## Static validation completed

- Core boundary validation passed.
- Strict TypeScript compilation of `src/core/**/*.ts` passed using the available contained-environment compiler.
- JSON configuration parsing passed.
- The internal event index is not publicly re-exported.
- No runtime publication method or invalidation behaviour was added.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M6B remains validation pending until all commands succeed against the combined repository.

## Next task

After successful M6B validation, proceed with **M6C: Immediate runtime publication**.
