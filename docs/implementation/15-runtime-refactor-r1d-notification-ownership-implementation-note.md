# Runtime Refactor R1D Notification Ownership Implementation Note

## Status

Validation pending.

## Objective

Document the current notification ownership and observable transition contract before listener storage and dispatch are extracted in R2.

## Files changed

- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/15-runtime-refactor-r1d-notification-ownership-implementation-note.md`
- `docs/implementation/prompts/007d-runtime-refactor-r1d-notification-ownership.md`

## Primary rule

A capability notifies after it commits an externally observable runtime transition. Its caller does not notify again for the same transition.

This does not promise one notification per public API call. Multi-stage operations can commit several transitions.

## Listener lifecycle

`onChange(...)` listeners are stored per runtime. The stop function is idempotent. Dispatch uses a copied listener sequence, preserves registration order for that dispatch, isolates listener failures, does not log them, and exposes no mutable internal state or transition payload.

## Capability ownership

- Subscription lifecycle owns notifications after count changes.
- Context and invalidation own notification after context and descendant state commits.
- Execution owns attempt-start, committed-success, and committed-failure notifications.
- Refresh preparation owns notification after stale state and generation changes.
- Scheduler owns notifications after public scheduler-state transitions.
- Runtime observation owns registration, removal, dispatch, and failure isolation.

## Silent operations

No-op and discarded paths are silent when they commit no observable state, including equal context updates, empty operations, repeated cleanup, pre-mutation validation failure, fresh-value reuse, obsolete-result discard, and settlement without a scheduler transition.

## Non-contractual details

Exact total notification counts for multi-stage operations, unrelated branch ordering, microtask counts, private flags and attempts, mutable-map structure, and the future physical location of `notify()` are not public contracts.

## Source, tests, and API

All files under `src/` and `tests/` remain byte-for-byte unchanged. Public APIs, exports, and behavior were unchanged.

## Static checks

Static checks cover source and test hashes, public-interface and export equality, current `notify()` call sites, documentation coverage, task status, core boundaries where available, JSON parsing where available, and ZIP integrity.

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

## R2 requirements and risks

R2 must extract listener storage and dispatch only. It must preserve call sites, listener order, snapshot-at-dispatch behavior, failure isolation, idempotent cleanup, and silent paths. It must not batch, defer, coalesce, or add payloads.

The main risk is accidentally moving notification timing or ownership while moving the listener collection. R2 should mechanically delegate existing `notify()` calls to the extracted observer.

## Next task

R2: Extract runtime observation.
