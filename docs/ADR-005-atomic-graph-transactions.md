# ADR-005: Atomic Graph Transactions

## Status

Accepted for design. Not yet implemented — scheduled for Milestone 4. This ADR records where the implementation will live and why, so Milestone 4 does not have to re-derive it, and so Milestone 9 (optimistic mutations) starts from a known constraint rather than discovering it after the fact.

## Context

ADR-002 committed to transactions batching "local context, event, mutation, and invalidation changes" without promising backend rollback. Two mechanisms exist or are planned toward that:

1. `runtime-notification-buffer.ts` (built ahead of Milestone 4, see `docs/implementation/23-transaction-notification-buffer-implementation-note.md`) already defers `notify`/`schedule`/`resolveSettlementIfIdle`/`whenSettled` dispatch until a `runtime.transaction(work)` call commits. This gives every reactive subscriber a single, coalesced view — no `onChange` listener ever fires mid-transaction. It does not touch state mutation itself: `setContext`, invalidation's descendant walk, and execution's attempt-completion commits all still apply immediately and synchronously, and are not rolled back if the transaction body throws.
2. Milestone 4's own checklist (`docs/implementation/01-roadmap.md`) additionally lists "Atomic context updates," "Deferred invalidation," and "Transaction rollback for local synchronous failure" — none of which the notification buffer provides. These require actual state to be staged and applied at commit, not just notifications to be deferred.

Before designing that staging mechanism, we traced where state mutation actually happens. It is not confined to `invalidation.ts`. `state/state.ts`'s `getMutableState(key)` returns a live, directly-mutable reference — there is no copy-on-write anywhere today — and both `invalidation/invalidation.ts` (`setContext`, `invalidateDescendants`) and `execution/execution.ts` (attempt success/failure commits) mutate it in place. Any staging mechanism has to intercept both, not just invalidation.

Two shapes were considered for where that staging mechanism lives:

- **Extend `runtime-notification-buffer.ts` itself** to also own state staging, so the same file gates both "when do observers get told" and "when does state become real."
- **A separate capability**, most naturally a staging mode on `state/state.ts` (`beginStagedWrites()` / `commitStagedWrites()`), coordinated by `runtime.transaction(work)` alongside the existing notification buffer, committed in an order that applies staged state and runs one coalesced invalidation pass before the buffer's own commit fires notify/schedule.

## Decision

Build transaction state staging as a separate capability, not as an extension of `runtime-notification-buffer.ts`.

Concretely, when Milestone 4 is implemented:

- `state/state.ts` gains a staging mode: writes made while a transaction is open go into a transaction-scoped overlay rather than the live mutable objects; `invalidation/invalidation.ts` and `execution/execution.ts` are updated to write through this staging-aware path instead of mutating `getMutableState`'s result directly.
- `runtime.transaction(work)` owns transaction depth centrally (rather than each participant tracking its own counter) and, on commit, applies staged writes and runs one coalesced invalidation pass across every changed node before triggering the notification buffer's own commit — so anything that does get notified sees fully-applied final state, never a partially-applied one.
- `runtime-notification-buffer.ts` is not modified by this work. It keeps its existing, already-tested single responsibility: deferring dispatch, not deferring state.

## Consequences

- The notification buffer's six existing tests and its role in the composition root are unaffected. Milestone 4 adds a new capability rather than reopening a validated one.
- This matches the composition root's existing pattern (`docs/implementation/11-runtime-composition-refactor-plan.md`) of narrow, single-purpose capabilities wired together in `runtime.ts` — state staging becomes capability #10, built the same way execution, invalidation, and subscriptions were.
- Milestone 6's "transaction-aware event publication" checklist item is the same shape of problem (defer dispatch of something until commit) and can reuse the same pattern — a third small capability sharing the same commit trigger — rather than requiring a decision about whether to fold event-buffering into an already-multi-purpose file.
- **For Milestone 9 specifically:** optimistic mutations need the near-opposite semantics — apply immediately for UI responsiveness, roll back to a snapshot on failure — not defer until commit. The staging mechanism built here must be scoped strictly to writes made while `depth > 0` inside an explicit `runtime.transaction(...)` call, and must never become the assumed path for all state writes. A direct `setContext` outside a transaction, and an optimistic mutation's write, both continue to apply immediately through the existing unstaged path. Milestone 9's design should treat this as a given constraint, not something to redecide.
- Cost accepted: `runtime.transaction`'s orchestration becomes slightly more involved than a single file's internal commit — it now sequences two participants (state staging, then the notification buffer) in a specific order, rather than one file handling everything internally. This ordering needs to be explicit and tested when Milestone 4 is implemented.

## Alternatives considered

- **Extend the notification buffer itself.** Rejected. It would fold `state/state.ts` and `invalidation/invalidation.ts` concerns (generation/freshness semantics, active-attempt abort timing) into `transactions/`, reversing the narrow-capability boundaries the R1–R9 refactor sequence and the subsequent feature-folder restructure were done to establish. It also does not actually reduce the amount of code that changes in `execution.ts`/`invalidation.ts` — those still need rewriting to go through a staging-aware write path regardless of which file owns the staging logic — so the option mostly relocates the work to a less accurate home rather than avoiding it.
- **Settle for weak atomicity (notification deferral only, already built) and treat "Atomic context updates" / "Deferred invalidation" as satisfied.** Considered but not adopted, because ADR-002's original commitment was to batch mutation and invalidation changes themselves, not only their notification, and Milestone 4's checklist explicitly separates "deferred scheduling" (already satisfied by the buffer) from "atomic context updates" and "deferred invalidation" (not satisfied by it). If a future revision decides weak atomicity is sufficient after all, that should be its own explicit ADR update, not an implicit scope reduction discovered mid-implementation.
