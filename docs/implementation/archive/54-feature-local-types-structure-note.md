# Feature-Local Types Structure Cleanup

## Status

Implementation prepared. Offline validation pending.

## Objective

Remove ambiguous singular/plural filenames such as `node.ts` versus `nodes.ts` and `event.ts` versus `events.ts` while matching the repository's established feature-local `types.ts` convention.

## Final structure

```text
src/core/graph/
  errors.ts
  graph.ts
  node.ts
  types.ts

src/core/events/
  event.ts
  event-index.ts
  event-matcher.ts
  types.ts
```

## Responsibilities

### `graph/types.ts`

Owns graph and node contracts:

- node kinds and definitions;
- node option types;
- dependency contracts;
- loader and derived contexts;
- event invalidation declaration contracts;
- the public `Graph` interface.

### `graph/node.ts`

Owns immutable node-definition construction:

- `defineContextNode(...)`;
- `defineDataNode(...)`;
- `defineDerivedNode(...)`;
- key validation;
- dependency and invalidation-list freezing.

### `graph/graph.ts`

Continues to own graph construction, topology validation, and the event invalidation index build.

### `events/types.ts`

Owns event contracts:

- `EventDefinition<TPayload>`;
- `AnyEventDefinition`;
- `EventPayload<TEvent>`.

### `events/event.ts`

Owns `defineEvent(...)`, including key validation and immutable event-handle construction.

### `events/event-index.ts`

Continues to own graph-local event candidate indexing and lookup.

### `events/event-matcher.ts`

Owns runtime publication matching and predicate dependency reads. Its internal names now describe that responsibility:

```text
RuntimeEventMatcher
RuntimeEventMatcherDependencies
createRuntimeEventMatcher(...)
```

## Renames

```text
src/core/graph/node.ts   -> src/core/graph/types.ts
src/core/graph/node.ts  -> src/core/graph/node.ts
src/core/events/event-matcher.ts -> src/core/events/event-matcher.ts
```

`src/core/events/event.ts` remains, but event contracts move into the new `src/core/events/types.ts`.

## Public API impact

There is no intended public API change. The core barrel continues to export:

- node and graph contracts;
- node definition factories;
- event contracts;
- `defineEvent(...)`;
- runtime APIs.

Consumers importing from the public `src/core` entry point are unaffected. Direct imports from private core implementation paths are not supported and must follow the new structure if used internally.

## Dependency direction

The structure preserves a clear contract dependency direction:

```text
events/types.ts
  <- events/event.ts
  <- graph/types.ts
  <- graph/node.ts
  <- graph/graph.ts
  <- events/event-matcher.ts
  <- runtime.ts
```

Feature types remain near their implementation instead of moving into a global types folder. This matches the existing `execution/types.ts`, `operations/types.ts`, `state/types.ts`, `subscriptions/types.ts`, and `transactions/types.ts` pattern.

## Files removed

After applying the renamed files, remove:

```text
src/core/graph/node.ts
src/core/events/event-matcher.ts
```

The original `src/core/graph/node.ts` is replaced by the node factory implementation, while its former contracts move to `src/core/graph/types.ts`.

## Validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

This is a structural naming cleanup only. Runtime behaviour and public exports should remain unchanged.
