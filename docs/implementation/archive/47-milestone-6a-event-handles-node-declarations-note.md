# Milestone 6A: Event Handles and Node Declaration Types

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice adds the public type foundation for Milestone 6 without adding runtime publication, graph event indexing, event matching, or event-driven invalidation behaviour.

Delivered:

- immutable typed event handles;
- event payload extraction;
- typed unconditional event invalidation declarations;
- typed conditional event invalidation declarations;
- dependency-safe predicate access;
- `invalidatedBy` support on data and derived node definitions;
- immutable empty invalidation declarations when omitted;
- public exports and compile-time coverage.

## Public event handles

Event contracts now live in `src/core/events/types.ts`, while `src/core/events/event.ts` owns `defineEvent<TPayload>(key)`. This feature-local split was applied by the later structure cleanup.

`defineEvent(...)` rejects blank keys and returns a frozen descriptor containing only the event key. The phantom payload field exists only for type inference and is not emitted at runtime.

## Node invalidation declarations

Data and derived node definitions now expose a readonly `invalidatedBy` collection. A declaration may be an event handle for unconditional invalidation, or an object containing an event handle and synchronous `when(...)` predicate.

The predicate context is strongly typed through the exported `EventInvalidationContext<TEvent, TDependencies>` type. It provides the event payload and a `get(...)` function restricted to the declared dependency tuple. Because TypeScript cannot contextually correlate a heterogeneous inline event tuple with the surrounding node dependency tuple, strict consumers should annotate the predicate context explicitly. No untyped fallback is introduced. Context nodes do not accept `invalidatedBy` because context values remain controlled through `setContext(...)`.

When omitted, data and derived definitions expose a frozen empty collection. The declaration collection is copied and frozen so caller-owned arrays cannot mutate the node descriptor.

## Runtime behaviour

No runtime event behaviour is introduced in M6A. This slice does not add `runtime.publish(...)`, graph event indexing, predicate evaluation, event-driven invalidation, transaction-aware event staging, or playground changes.

Existing graph creation and runtime execution ignore the new immutable declaration metadata until M6B and M6C consume it.

## Files changed

- `src/core/events/types.ts`
- `src/core/events/event.ts`
- `src/core/graph/types.ts`
- `src/core/graph/node.ts`
- `src/core/index.ts`
- `tests/core/event-definitions.spec.ts`
- `tests/core/node-types.test.ts`
- `docs/api/01-public-api.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/46-milestone-6-typed-events-plan.md`
- `docs/implementation/47-milestone-6a-event-handles-node-declarations-note.md`
- `docs/README.md`

## Behavioural coverage

`tests/core/event-definitions.spec.ts` covers immutable event descriptors, blank event keys, immutable declarations, predicates not running during definition, and empty declaration defaults.

## Compile-time coverage

`tests/core/node-types.test.ts` covers payload extraction, explicitly typed predicate contexts, declared dependency access, rejection of undeclared dependencies, data and derived declarations, invalid payload types, rejection on context nodes, and unchanged existing inference.

## Static validation completed

- Strict TypeScript compilation of `src/core/**/*.ts` passed using the available contained-environment compiler.
- Focused strict TypeScript compilation of `tests/core/node-types.test.ts` passed.
- Core boundary validation passed.
- No runtime publication API or implementation was added.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M6A remains validation pending until all commands succeed against the combined repository.

## Next task

After successful M6A validation, proceed with **M6B: Graph validation and event invalidation index**.
