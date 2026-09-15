# Milestone 10G: Runtime Observability Playground

## Status

Implemented and statically reviewed. Dependency-backed repository validation and manual browser verification are pending.

## Scope

M10G adds a deterministic Runtime Observability playground scenario using a dedicated core runtime and bounded in-memory collector. It demonstrates the public observability API without introducing the Milestone 11 devtools protocol, inspector transport, or remote command model.

## Demonstrated lifecycle

The scenario mounts one subscribed summary node and exposes controls for:

- context change and subscribed reload;
- explicit refresh;
- one deterministic request failure;
- recovery after failure;
- transaction rollback;
- successful mutation;
- scenario reset;
- snapshot JSON export.

The page shows the current domain state, last action, recent event timeline, cumulative metrics, and a stable redacted snapshot preview.

## Privacy behaviour

The protected token node uses default value omission. The visible summary uses an explicit redactor. The snapshot preview is normalised before display and export, so runtime identity, operation identifiers, timestamps, timers, and durations are deterministic while meaningful state and causality remain visible.

## Runtime ownership and cleanup

The scenario model owns its graph runtime, collector, and subscription. `dispose()` releases the direct summary subscription and therefore its required dependency ownership. Vue scope disposal calls `dispose()` when the user leaves the tab or unmounts the playground.

Reset disposes the current scenario, creates a new runtime and collector, waits for initial settlement, and resets the view to a clean deterministic baseline.

## Behavioural coverage

Focused tests cover:

- control-driven context, refresh, failure, recovery, rollback, and mutation behaviour;
- timeline and metrics updates from the same event stream;
- protected-value omission in the preview;
- clean reset state and identifier baseline;
- direct and required subscription release on disposal;
- registration of the Runtime Observability tab in the playground shell.

## Validation completed in the contained environment

- Core and diagnostic capability boundary checks passed.
- Strict core TypeScript compilation passed.
- Strict TypeScript compilation of the framework-agnostic scenario model passed.
- Existing M10A through M10F diagnostic test TypeScript validation remained successful.
- ZIP integrity and repository-relative paths were verified.

Project dependencies were unavailable, so Vue SFC type checking, Testing Library execution, the complete Vitest suite, and the production build were not run or claimed.

## Offline validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Manual browser validation:

1. Open Runtime Observability and confirm the initial subscription trace settles.
2. Run each control and confirm timeline order and metrics.
3. Confirm failure followed by recovery.
4. Confirm transaction rollback leaves the selected case unchanged.
5. Confirm the snapshot omits `secret-token` and includes only the redacted summary value.
6. Export the snapshot and confirm valid JSON.
7. Reset and confirm clean events, metrics, state, and IDs.
8. Switch tabs and confirm the dedicated subscription is released.

M10G was validated successfully through the combined automated and manual Milestone 10 closure checks.

## Next step

After successful offline and manual validation, proceed with M10H documentation reconciliation and final Milestone 10 validation handoff.
