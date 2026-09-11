# Runtime Refactor R5 Subscription Lifecycle Implementation Note

## Status

Validation pending.

## Objective

Extract runtime-local subscription storage and lifecycle accounting while preserving public APIs, scheduler triggering, cancellation ownership, and notification ordering.

## Files changed

- `src/core/runtime-subscriptions.ts`
- `src/core/runtime.ts`
- `tests/core/node-subscription-registration.spec.ts`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/11-runtime-composition-refactor-plan.md`
- `docs/implementation/19-runtime-refactor-r5-subscription-lifecycle-implementation-note.md`
- `docs/implementation/prompts/011-runtime-refactor-r5-extract-subscription-lifecycle.md`

## Subscription controller

The internal controller owns `subscribeNodes(...)`, frozen subscription snapshots, total-subscriber inspection, and the direct-subscriber query used by scheduler target selection.

## State and initialization

Each controller owns a private map containing only direct and required counts. Every registered graph node receives eager zero-count state. Total remains derived.

## Snapshots

Each inspection returns a new frozen snapshot containing direct, required, and total counts.

## Validation and atomicity

All requested handles resolve through the existing registered-node helper before mutation. Equivalent handles resolve by key, duplicate keys preserve first-occurrence order, and failed validation applies no partial counts.

## Contributions

Each subscription contributes once to directly selected keys and once to each transitive ancestor key. Shared and diamond ancestors are deduplicated, and directly selected nodes are removed from required contributions.

## Unsubscribe

Each subscription owns an explicit active flag. Active unsubscribe validates and removes its contributions exactly once. Repeated unsubscribe is silent.

## Notification ordering

Non-empty registration commits counts, notifies, then requests scheduling. Active unsubscribe removes counts, notifies, then invokes runtime-owned cancellation evaluation.

## External policy boundaries

Scheduler queueing remains in `runtime.ts` through `afterSubscribe`. Active-attempt iteration, scheduler-only ownership checks, abort decisions, and settlement remain in `runtime.ts` through `afterUnsubscribe`.

## Scheduler query

The controller exposes an internal direct-subscriber predicate so scheduler terminal-target selection remains unchanged. Total-subscriber inspection is used by invalidation and cancellation without exposing mutable records.

## Type error correction

`NodeValue` was restored to the type imports in `runtime.ts`, resolving the R4 `TS2304` errors in `RuntimeNodeData<TNode>`.

## Tests

Existing subscription, propagation, lifecycle, scheduler, cancellation, prefetch, refresh, and type tests remain. A focused test now verifies subscription snapshot independence and freezing.

## Preserved API and behavior

Public APIs, exports, R2 observation, R3 storage, R4 execution, scheduler behavior, cancellation policy, and runtime behavior were intentionally preserved.

## Static checks

Static inspection covers public interface and export equality, controller privacy, eager state creation, derived totals, atomic validation, contribution semantics, callback ordering, scheduler and cancellation boundaries, source hygiene, notification count, roadmap status, and ZIP integrity.

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

## R6 considerations

R6 may move scheduler state, queueing, follow-up handling, target selection, errors, and settlement. It must preserve the controller's direct-subscriber query and keep final-unsubscribe cancellation ownership explicit.

## Next task

R6: Extract the automatic scheduler.
