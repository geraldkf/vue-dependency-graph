# Milestone 10F: Stable Diagnostic Normaliser and Regression Coverage

## Status

Implemented and statically reviewed. Dependency-backed repository validation is pending.

## Scope

M10F adds public, pure normalisers for diagnostic snapshots, event streams, and combined exports. It also adds a cross-capability observability regression scenario and strengthens automated architecture-boundary checks.

The normalisers are public because snapshots and event exports are public diagnostic contracts intended for application tests and offline comparison. Keeping the functionality only in repository test helpers would require consumers to recreate volatile-field handling and operation-ID correlation.

## Normalisation rules

Snapshot normalisation replaces creation time, runtime identity, policy timer due times, and duration totals and maximums. Duration counts remain stable. Topology, node state, generations, errors, redaction markers, approved values, counters, and ordering remain unchanged.

Event normalisation replaces timestamps and runtime identity, aliases operation IDs in first-seen order, preserves cause links through the same alias map, and replaces duration values. It preserves sequence, type, keys, reasons, origins, outcomes, generations, errors, and array ordering.

The combined export normaliser applies both rules and shares one operation-ID alias map across its event stream.

## Immutability and idempotence

All normalisers construct new values and recursively freeze their output. Diagnostic values and safe errors are cloned before publication. Source snapshots and events remain unchanged. Already normalised values remain stable under repeated normalisation.

## Regression coverage

Focused tests verify equivalent runtime normalisation, meaningful state and ordering differences, causal ID aliases, source preservation, immutable output, idempotence, and one end-to-end trace covering subscription, scheduler execution, context invalidation, typed events, transaction commit, mutation completion, and unsubscribe.

## Architecture boundaries

The core boundary script now rejects collector, metrics, and normaliser implementation imports from runtime capability directories. Runtime capabilities may emit through narrow contracts, but they may not depend on diagnostic consumers or comparison utilities.

## Validation completed in the contained environment

Core and diagnostic capability boundary checks passed. Strict TypeScript compilation of the complete core public entry and all M10A through M10F diagnostic tests passed using a local Vitest declaration shim.

Project dependencies were unavailable, so the repository Vitest suite, Vue type check, and production build were not run or claimed.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M10F remains validation pending until all commands succeed against the combined checkout.

## Next step

After successful offline validation, implement M10G as a deterministic Runtime Observability playground scenario without introducing the Milestone 11 devtools protocol.
