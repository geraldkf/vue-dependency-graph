# Runtime Refactor R2 Observation Implementation Note

## Status

Validation pending.

## Objective

Extract runtime listener storage and dispatch into one closure-based internal capability while preserving all notification ownership, timing, public APIs, and runtime behavior.

## Files changed

- `src/core/runtime-observer.ts`
- `src/core/runtime.ts`
- `tests/core/runtime-observer.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/16-runtime-refactor-r2-observation-implementation-note.md`
- `docs/implementation/prompts/008-runtime-refactor-r2-extract-runtime-observation.md`

## Observer capability

The internal observer exposes only:

```ts
interface RuntimeObserver {
  readonly onChange: (
    listener: RuntimeListener
  ) => () => void;
  readonly notify: () => void;
}
```

It receives no graph, runtime state, scheduler state, execution state, or notification payload.

## Listener lifecycle

Each `createGraphRuntime(...)` call creates one observer with a private listener set. Registration remains synchronous. The returned stop function remains explicitly idempotent, and adding or removing listeners remains silent.

## Snapshot dispatch

Dispatch remains synchronous and iterates a copied listener collection. Listener additions and removals during a dispatch affect later dispatches only. Set insertion order continues to determine listener order within the captured snapshot.

## Listener failure isolation

Listener exceptions remain caught and ignored. One failing listener does not prevent later listeners, roll back committed state, populate runtime errors, or produce core logging.

## Notification ownership

The eleven existing notification ownership points remain in `runtime.ts` at the same committed transitions. The observer does not inspect state or decide when to notify.

## Tests

A focused public-behavior test file covers:

- Listener addition during dispatch
- Listener removal during dispatch
- Listener isolation between runtime instances

Existing tests continue to cover idempotent cleanup, failure isolation, subscription observation, scheduler progression, and silent no-op paths.

## Preserved API and behavior

`GraphRuntime`, `RuntimeListener`, public exports, notification timing, silent paths, scheduler behavior, execution behavior, subscriptions, validation, prefetch, and refresh remain unchanged.

## Static checks

Static inspection verifies public interface and export equality, observer privacy, runtime-local listener storage, copied collection dispatch, idempotent removal, failure isolation, semantic preservation of all eleven notification call sites, absence of later extraction, source boundaries, explicit `any`, suppressions, console logging, roadmap status, and ZIP integrity.

## Project commands

Not run in contained environment.

## Offline validation

```powershell
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
pnpm dev
```

## R3 risks and considerations

R3 must not absorb notification ownership into the state store. State snapshots and mutable node-state lookup can be extracted, but capabilities committing transitions must continue to call the observer after their state changes are complete.

## Next task

R3: Extract runtime state and active-attempt storage.
