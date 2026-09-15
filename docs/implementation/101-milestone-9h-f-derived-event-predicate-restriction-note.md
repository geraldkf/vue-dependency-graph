# Milestone 9H-F: Derived Event Predicate Restriction

## Status

Implemented. Offline validation pending.

## Scope

M9H-F prevents mutation success event predicates from reading a derived dependency affected by the mutation's optimistic targets or the same success draft. This avoids making event invalidation decisions against a derived value that has not yet recomputed.

## Preparation sequence

Mutation success reconciliation now collects and validates update, invalidation, and publication drafts; computes effective direct updates; creates a preliminary affected set; collects affected derived-node keys; evaluates event predicates with direct data overlays and prohibited derived keys; adds valid event targets; and commits all success effects once.

The preliminary invalidation plan performs no state mutation or dispatch.

## Shared event matcher

The event matcher now accepts optional matching options:

```ts
interface EventMatchOptions {
  readonly valueOverlay?: readonly EventValueOverlay[];
  readonly prohibitedDependencyKeys?: ReadonlySet<string>;
}
```

Normal runtime publication supplies no options. Transaction publication supplies staged context values as `valueOverlay`. Mutation publication supplies final direct data values and affected derived keys.

A prohibited read throws an internal `EventPredicateDependencyError` containing the event target node key and dependency key.

## Mutation failure behaviour

For non-optimistic mutations, a prohibited read rejects local success preparation before any update, explicit invalidation, or event invalidation commits.

For optimistic mutations after confirmed remote success, the M9H-C path retains optimistic state, marks the captured graph stale, releases ownership, schedules subscribed recovery, and rejects with `GraphMutationReconciliationError` whose cause is the dependency-read error.

## Allowed reads

Mutation event predicates may continue to read directly updated data nodes through the final-value overlay, unaffected successful data nodes, committed context nodes, and unaffected derived nodes.

Normal runtime publication and transaction publication retain their existing derived predicate semantics.

## Behavioural coverage

Focused tests verify direct-update and explicit-invalidation rejection, no partial success effects or notification, optimistic reconciliation recovery, unaffected derived reads, direct data overlays, and unchanged runtime and transaction publication.

Existing multiple-publication ordering and deduplication tests remain applicable because the shared matcher preserves publication traversal order and matched-node deduplication.

## Compatibility

The public mutation, event, runtime, and transaction API shapes are unchanged. `EventMatchOptions` and `EventPredicateDependencyError` remain internal core implementation details.

## Validation completed in the contained environment

- Strict TypeScript compilation of core source, mutation tests, runtime event tests, and transaction event tests passed using a local Vitest declaration shim.
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

M9H-F remains validation pending until all four commands succeed against the combined checkout.

## Next task

Implement M9H-G internal mutation-controller decomposition, preserving all M9H-A through M9H-F behaviour while creating explicit lifecycle seams for Milestone 10 instrumentation.
