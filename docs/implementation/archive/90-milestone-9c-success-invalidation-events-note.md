# Milestone 9C: Success Invalidation and Typed Event Publication

## Status

Implementation prepared. Offline validation pending.

## Scope

This slice extends confirmed-success mutation effects with explicit invalidation and typed event publication. It combines these effects with M9B direct updates in one local graph commit.

M9C does not add optimistic updates, rollback snapshots, failure classification, retry, deduplication, user cancellation, or mutation diagnostics.

## Public success effects

The success callback now exposes:

```ts
effects.update(DataNode, updater);
effects.invalidate([DataNode, DerivedNode]);
effects.publish(TypedEvent, payload);
```

`invalidate(...)` accepts data and derived nodes. Context nodes are rejected by TypeScript and defensively at runtime. Targets resolve by registered node key, and duplicate roots are deduplicated.

`publish(...)` retains the event payload type and records publications in call order. Publications are processed only after remote success.

## Atomic preparation and commit

The runtime completes these steps before graph mutation:

1. record direct updates, invalidation roots, and publications;
2. validate registered targets and target kinds;
3. verify direct-update successful values;
4. evaluate all direct updaters;
5. evaluate every event predicate using final direct-update values as an overlay;
6. collect changed-result descendants, explicit roots, event roots, and transitive descendants;
7. deduplicate the complete affected set.

A callback, updater, target-validation, or event-predicate failure applies no mutation-owned graph effect.

At commit:

- effective direct values are stored;
- directly updated generations advance once;
- directly updated nodes remain fresh unless they are also affected by invalidation;
- invalidated direct values are retained as successful stale data;
- all other affected nodes receive the existing invalidation transition once;
- all affected generations advance before obsolete active work can complete;
- one observer notification is emitted;
- at most one scheduler request is made for subscribed stale work.

## Event overlay

The event matcher now accepts a general final-value overlay rather than a context-only overlay. Existing transaction callers continue to pass staged context values. Mutation success callers pass final direct data values.

This preserves one predicate implementation and allows a mutation to update a dependency and publish a conditional event in one coherent success commit.

## Invalidation seam

The invalidation controller now prepares a combined invalidation plan without changing state. The mutation controller first advances direct-update generations, then commits the plan, ensuring all affected generations are obsolete before abort handling can release asynchronous work.

The plan identifies directly updated nodes reached by invalidation so their response values are retained but marked stale. It also computes subscriber scheduling once across the full affected set.

## Behavioural coverage

Focused tests cover:

- direct updates plus explicit invalidation in one notification;
- update-plus-invalidate retained stale response values;
- success-only typed publication;
- event predicates reading final direct-update values;
- predicate failure with no partial graph effect;
- explicit and event root deduplication across shared descendants;
- one scheduler-driven reload for subscribed invalidation;
- no success effects after remote rejection;
- defensive context invalidation rejection.

Compile-time tests cover valid data and derived invalidation, context rejection, typed event payloads, and invalid payload rejection.

## Validation completed in the contained environment

- Core boundary validation passed.
- Strict standalone TypeScript compilation of core source passed.
- Focused strict TypeScript compilation of mutation source and tests passed using a local Vitest declaration shim because repository dependencies are not installed.
- Static documentation and ZIP integrity checks are completed when the prepared package is produced.

## Offline validation

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M9C remains validation pending until all four commands succeed against the combined checkout.

## Next task

After successful M9C validation, proceed with M9D optimistic application and known-rejection rollback. M9D should build on the same mutation draft and combined local commit rather than creating a parallel cache path.
