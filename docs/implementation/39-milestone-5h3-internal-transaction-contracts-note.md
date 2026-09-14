# Milestone 5H.3: Internal Transaction Contracts

## Status

Internal contract cleanup prepared. Offline validation pending.

## Objective

Remove transaction details that leaked beyond their owning capability and consolidate the one internal value shape genuinely shared by staging and commit reconciliation.

## Decisions

### Notification-buffer transaction state is private

Removed `isInsideTransaction()` from `RuntimeNotificationBuffer`.

The notification buffer owns dispatch depth internally, but no other capability should make transaction-state decisions from that depth. The transaction coordinator is the sole owner of runtime transaction lifecycle and continues to expose its own internal `isInsideTransaction()` operation for context staging and operation guards.

No current source or test caller used the notification-buffer member.

### RuntimeNotificationBuffer is not public API

Removed the `RuntimeNotificationBuffer` type re-export from `src/core/index.ts`.

The type represents composition-root wiring rather than a consumer capability:

- consumers cannot construct it through the public runtime API;
- its methods are internal sink replacements;
- it is not documented in `docs/api/01-public-api.md`;
- exposing it would couple consumers to notification and scheduler implementation details.

The library remains at version `0.0.0` and private. This cleanup intentionally removes the accidental pre-release type export before a stable API is established. The implementation type remains exported from its internal module for use by `runtime.ts`.

### ContextChange is the shared internal boundary type

Added:

```text
src/core/transactions/types.ts
```

`ContextChange` represents a registered context handle and its final value. It is now shared by:

- the transaction coordinator's staged context map;
- the invalidation controller's commit-time reconciliation input.

Removed the duplicate `StagedContextValue` and invalidation-local `ContextChange` declarations.

This type is internal and is not re-exported from `src/core/index.ts`.

## Scope

This cleanup does not change:

- public `GraphRuntime` signatures;
- transaction staging or overlap semantics;
- commit and rollback behaviour;
- notification or scheduling behaviour;
- test behaviour;
- Vue integration.

## Validation completed in the contained environment

```text
node scripts/check-boundaries.mjs
tsc -p /tmp/tsconfig-core.json --pretty false
```

Both passed.

Static inspection also confirmed:

- notification-buffer `isInsideTransaction()` is removed;
- coordinator `isInsideTransaction()` remains;
- `RuntimeNotificationBuffer` is no longer re-exported publicly;
- `ContextChange` has one internal declaration;
- `StagedContextValue` no longer exists.

## Offline validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

M5H.3 remains validation pending until those commands pass.

## Next follow-up

M5H.4 may review Atomic Transaction playground lifecycle behaviour after manual browser validation. It should make no change unless an observable lifecycle issue is found.
