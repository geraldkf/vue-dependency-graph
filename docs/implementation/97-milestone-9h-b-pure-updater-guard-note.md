# Milestone 9H-B: Pure Updater Contract and Guard

## Status

Implemented. Offline validation pending.

## Scope

M9H-B formalises mutation update functions as pure replacement functions and adds development and test protection against in-place writes to graph-owned plain arrays and plain objects.

It does not freeze committed runtime values, add production cloning, or guard non-plain domain values. M9H-C remote-success reconciliation-failure recovery remains the next slice.

## Contract

Every optimistic and success updater must treat the current value and nested plain values as read-only, return the intended replacement value, and avoid side effects that mutate graph-owned state.

This contract applies in every build. The runtime guard is additional development feedback, not the source of the contract.

## Guard behaviour

Development and test builds create recursive read-only views for plain arrays and plain objects. The views are isolated from source property descriptors and reject property assignment, array mutation methods, deletion, property definition, prototype replacement, and equivalent writes through nested plain containers.

A detected write becomes `GraphMutationStateError` for the affected node. Preparation stops before optimistic ownership, request execution, generation changes, notification, scheduling, or success-effect commit.

## Replacement unwrapping

Immutable expressions such as array spread, object spread, `map`, and nested replacement can copy protected nested views into a newly returned value. Before change detection and commit, the runtime recursively unwraps those protected references back to their original graph values.

This prevents development-only proxies from becoming committed application data while preserving ordinary immutable sharing patterns.

## Production and non-plain values

The guard is compiled behind `import.meta.env.DEV`, so production builds avoid recursive proxy creation and result unwrapping.

Only arrays and objects whose prototype is `Object.prototype` or `null` are recursively protected. `Date`, `Map`, `Set`, class instances, typed arrays, and platform objects are passed through without recursive protection. Their updater contract remains immutable replacement.

## Behavioural coverage

Focused tests cover immutable array and object replacement, direct and nested write rejection, no partial success effect, rejection before optimistic request execution or ownership, subsequent valid ownership acquisition, immutable `Date` replacement, and verification that protected nested proxies are not retained in committed data.

## Compatibility

The public API shape is unchanged. Existing immutable updater code retains the same logical behaviour. Code that mutates `current` in place was already outside the intended atomic replacement model and now fails early in development and tests.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source and all mutation test source passed using a local Vitest declaration shim.
- Core boundary validation passed.
- Static documentation and ZIP integrity checks are completed when the cumulative package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9H-B remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-C remote-success reconciliation-failure recovery, including the dedicated error contract and authoritative stale reconciliation path.
