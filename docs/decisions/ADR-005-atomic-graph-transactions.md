# ADR-005: Atomic Graph Transactions

## Status

Accepted, implemented, and validated. Original Milestone 5 decision recorded on 14 September 2026. Isolated transaction-session amendment and final cleanup completed on 16 September 2026.

## Current decision summary

- Each top-level `runtime.transaction(...)` call creates an independent `TransactionSession`.
- Context changes and event publications are staged on the callback handle.
- `transaction.transaction(...)` is the explicit same-session composition API.
- Plain runtime operations remain independent and use committed graph state.
- Context generations provide first-commit-wins optimistic conflict detection.
- A conflicted session applies no context, event, notification, or scheduler effect.
- Observer notification and scheduler dispatch are direct runtime capabilities and are not gated by unrelated open sessions.
- `runtime.whenSettled()` is scheduler-specific.
- Transaction diagnostic operation and cause IDs remain session-local.
- Transactions provide local graph atomicity only, not backend rollback.
- The former transaction notification buffer and its final pass-through compatibility wrapper have been removed.

The remainder of this ADR preserves the original decision history and subsequent amendments. Where historical text describes ambient transaction depth, shared groups, or a notification buffer, this current summary and the isolated-session amendment are authoritative.

## Context

ADR-002 committed to transactions batching "local context, event, mutation, and invalidation changes" without promising backend rollback. Two mechanisms exist or are planned toward that:

1. `runtime-notification-buffer.ts` (built ahead of Milestone 5, see `docs/implementation/23-transaction-notification-buffer-implementation-note.md`) already defers `notify`/`schedule`/`resolveSettlementIfIdle`/`whenSettled` dispatch until a `runtime.transaction(work)` call commits. This gives every reactive subscriber a single, coalesced view — no `onChange` listener ever fires mid-transaction. It does not touch state mutation itself: `setContext`, invalidation's descendant walk, and execution's attempt-completion commits all still apply immediately and synchronously, and are not rolled back if the transaction body throws.
2. Milestone 5's own checklist (`docs/implementation/01-roadmap.md`) additionally lists "Atomic context updates," "Deferred invalidation," and "Transaction rollback for local synchronous failure" — none of which the notification buffer provides. These require actual state to be staged and applied at commit, not just notifications to be deferred.

Before designing that staging mechanism, we traced where state mutation actually happens. It is not confined to `invalidation.ts`. `state/state.ts`'s `getMutableState(key)` returns a live, directly-mutable reference — there is no copy-on-write anywhere today — and both `invalidation/invalidation.ts` (`setContext`, `invalidateDescendants`) and `execution/execution.ts` (attempt success/failure commits) mutate it in place. Any staging mechanism has to intercept both, not just invalidation.

Two shapes were considered for where that staging mechanism lives:

- **Extend `runtime-notification-buffer.ts` itself** to also own state staging, so the same file gates both "when do observers get told" and "when does state become real."
- **A separate capability**, most naturally a staging mode on `state/state.ts` (`beginStagedWrites()` / `commitStagedWrites()`), coordinated by `runtime.transaction(work)` alongside the existing notification buffer, committed in an order that applies staged state and runs one coalesced invalidation pass before the buffer's own commit fires notify/schedule.

## Decision

Build transaction state staging as a separate capability, not as an extension of `runtime-notification-buffer.ts`.

Concretely, when Milestone 5 is implemented:

- `state/state.ts` gains a staging mode: writes made while a transaction is open go into a transaction-scoped overlay rather than the live mutable objects; `invalidation/invalidation.ts` and `execution/execution.ts` are updated to write through this staging-aware path instead of mutating `getMutableState`'s result directly.
- `runtime.transaction(work)` owns transaction depth centrally (rather than each participant tracking its own counter) and, on commit, applies staged writes and runs one coalesced invalidation pass across every changed node before triggering the notification buffer's own commit — so anything that does get notified sees fully-applied final state, never a partially-applied one.
- `runtime-notification-buffer.ts` is not modified by this work. It keeps its existing, already-tested single responsibility: deferring dispatch, not deferring state.

## Consequences

- The notification buffer's six existing tests and its role in the composition root are unaffected. Milestone 5 adds a new capability rather than reopening a validated one.
- This matches the composition root's existing pattern (`docs/implementation/11-runtime-composition-refactor-plan.md`) of narrow, single-purpose capabilities wired together in `runtime.ts` — state staging becomes capability #10, built the same way execution, invalidation, and subscriptions were.
- Milestone 6's "transaction-aware event publication" checklist item is the same shape of problem (defer dispatch of something until commit) and can reuse the same pattern — a third small capability sharing the same commit trigger — rather than requiring a decision about whether to fold event-buffering into an already-multi-purpose file.
- **For Milestone 9 specifically:** optimistic mutations need the near-opposite semantics — apply immediately for UI responsiveness, roll back to a snapshot on failure — not defer until commit. The staging mechanism built here must be scoped strictly to writes made while `depth > 0` inside an explicit `runtime.transaction(...)` call, and must never become the assumed path for all state writes. A direct `setContext` outside a transaction, and an optimistic mutation's write, both continue to apply immediately through the existing unstaged path. Milestone 9's design should treat this as a given constraint, not something to redecide.
- Cost accepted: `runtime.transaction`'s orchestration becomes slightly more involved than a single file's internal commit — it now sequences two participants (state staging, then the notification buffer) in a specific order, rather than one file handling everything internally. This ordering needs to be explicit and tested when Milestone 5 is implemented.

## Alternatives considered

- **Extend the notification buffer itself.** Rejected. It would fold `state/state.ts` and `invalidation/invalidation.ts` concerns (generation/freshness semantics, active-attempt abort timing) into `transactions/`, reversing the narrow-capability boundaries the R1–R9 refactor sequence and the subsequent feature-folder restructure were done to establish. It also does not actually reduce the amount of code that changes in `execution.ts`/`invalidation.ts` — those still need rewriting to go through a staging-aware write path regardless of which file owns the staging logic — so the option mostly relocates the work to a less accurate home rather than avoiding it.
- **Settle for weak atomicity (notification deferral only, already built) and treat "Atomic context updates" / "Deferred invalidation" as satisfied.** Considered but not adopted, because ADR-002's original commitment was to batch mutation and invalidation changes themselves, not only their notification, and Milestone 5's checklist explicitly separates "deferred scheduling" (already satisfied by the buffer) from "atomic context updates" and "deferred invalidation" (not satisfied by it). If a future revision decides weak atomicity is sufficient after all, that should be its own explicit ADR update, not an implicit scope reduction discovered mid-implementation.

## Milestone 5A clarification

Source reconciliation for Milestone 5A refined the staging boundary described above.

The accepted direction remains unchanged for caller-driven context writes: context values and their descendant invalidation are staged and reconciled at the successful outermost commit, while the notification buffer remains a separate dispatch-only capability.

However, the initial implementation will **not** make every `getMutableState(...)` consumer automatically read and write a global transaction overlay. A transaction may span an `await`, during which an execution attempt started before the transaction can complete independently. Treating that unrelated completion as transaction-owned would allow a later transaction rollback to discard legitimate runtime work and would make execution ownership depend only on timing.

Milestone 5 therefore adopts these narrower rules:

- public `getState(...)` remains a committed read while a transaction is open;
- `setContext(...)` stages final caller-driven context values;
- execution attempts already active remain committed runtime work;
- explicit `execute(...)`, `prefetch(...)`, and `refresh(...)` calls from inside a transaction are rejected in the initial implementation;
- scheduler work caused by staged context invalidation starts only after commit;
- subscription lifecycle changes remain immediate and outside the staged context transaction model.

This clarification deliberately replaces the earlier assumption that execution attempt-completion writes must always be intercepted by the same staging overlay. Execution race safety is instead preserved through existing generation and attempt-token checks, with commit-time context invalidation advancing affected generations once and aborting attempts that remain active.

The detailed consistency model, commit ordering, rollback behaviour, risks, and implementation slices are recorded in `docs/implementation/29-milestone-5-atomic-transactions-plan.md`.


## Overlapping transaction calls

Milestone 5H.1 clarifies that overlapping calls on one runtime join one transaction group. The first call is the root and owns the commit or rollback outcome. All joined calls share staged context state and must settle before the root promise and group lifecycle complete. A joined failure remains caller-visible but does not poison a successful root unless it propagates into root work. This preserves caught nested failure behaviour and avoids completion-order-dependent outcomes without changing the public API.


## Internal contract cleanup

Milestone 5H.3 confirms that notification-buffer depth is private to dispatch deferral, while transaction-state decisions belong to the transaction coordinator. The accidental pre-release `RuntimeNotificationBuffer` type re-export was removed from the core public barrel because it represents composition wiring rather than a consumer capability. Staging and invalidation now share one internal `ContextChange` boundary type without exposing transaction storage publicly.


## Amendment: explicit context ownership

TOI-2 introduces the public `GraphTransaction` capability and TOI-3 removes ambient context staging. Transaction-owned context changes must use `transaction.setContext(...)`. Plain `runtime.setContext(...)` always commits to runtime state immediately, even when another transaction group is open. A transaction rollback discards only context changes staged through its handle.

This amendment corrects the ownership gap in the original runtime-wide depth model. TOI-5 completes dispatch isolation: observer notification and automatic scheduling for an unrelated immediate context write bypass the transaction-owned buffer. Same-context conflict detection remains deferred to TOI-7.


## Amendment: caller-owned operations during transactions

TOI-6 removes the runtime-wide transaction guards from `execute(...)`, `prefetch(...)`, and `refresh(...)`. These plain runtime operations are caller-owned and continue while another transaction is open. They read committed graph state, do not see staged context values, and publish execution state independently of the transaction notification buffer.

`GraphTransaction` does not expose execution operations. Code that requires execution against newly staged context values must await successful transaction completion before starting that work. Existing generation and attempt-token rules continue to protect transaction commit races.


## Amendment: context conflict detection

TOI-7 adds optimistic conflict detection for contexts staged through `GraphTransaction`. The coordinator records the committed generation when a context is first staged. Before event predicate evaluation or graph mutation, commit verifies that every staged context still has that generation.

If any generation changed independently, the root transaction rejects with `GraphTransactionConflictError`. The error exposes immutable, deterministically sorted `contextKeys`. No staged context or event effect commits, and independently committed runtime changes are preserved. This also applies when the final staged value reverted to its original value, because an independent write still changed the transaction's baseline.

Overlapping explicit transaction calls continue to join one group for this work. They share staged state and conflict baselines, all participants settle before closure, and the root outcome retains control of commit or rollback. Serialising or rejecting independently overlapping transaction calls remains deferred until a concrete use case requires different semantics.


## Amendment: isolated transaction sessions

A source-code review of `src/core/transactions/*` found that the "one group"
model the previous amendment describes has a real cost: two calls to
`runtime.transaction(...)` that overlap in wall-clock time but are
otherwise unrelated (different features, different callers, no intent to
compose) silently share one outcome. A joined call whose own callback
throws can still have its writes committed, if the root happens to
succeed; a joined call that succeeds can have its writes silently
discarded, if the root happens to fail. Per
`docs/architecture/07-vue-and-pinia-integration.md`, this runtime is a
single instance shared by the whole app ("one stable runtime per Pinia
instance," holding every feature's nodes), so two unrelated features
calling `runtime.transaction(...)` around the same moment is the expected
shape of real usage, not an edge case — e.g. a booking flow and an
unrelated settings save, both in flight at once.

This amendment supersedes "Overlapping explicit transaction calls continue
to join one group" above. Going forward:

- Every root `runtime.transaction(...)` call owns its own staged context/
  event state, independent of any other call. There is no shared
  `activeGroup` for a second call to observe or join — isolation is
  structural, not policy.
- Composition is explicit only: `GraphTransaction` gains a `transaction(
  work)` method that nests further work into the *same* session the
  caller already holds a handle for. There is no ambient/ID-based
  rejoining of an already-open transaction from a second top-level
  `runtime.transaction(...)` call.
- No opt-in flag, deprecation warning, or default-flip rollout is needed
  for this change: at the time of this amendment the transaction API has
  no external consumers to migrate, only this repo's own call sites (see
  the implementation plan below).

**Related finding, same review:** `notification-buffer.ts`'s `depth`
counter gates `notify`/`schedule`/`whenSettled`/`resolveSettlementIfIdle`
for the *entire runtime* for as long as *any* transaction is open
anywhere, not just for the transaction that's committing. Combined with
the shared-runtime architecture above, this means an unrelated feature's
`notify()` — e.g. a background poll finishing, on a node the open
transaction never touches — can be silently delayed for however long that
other transaction's own async work takes. `invalidation.ts`'s
`commitContexts` already dispatches `notify()`/`schedule()` exactly once
per commit call regardless of batch size, so the buffer was never actually
coalescing a transaction's *own* dispatch — its only remaining effect,
once transactions stop sharing a group, is this unrelated-caller delay.
This is addressed as part of the same body of work.

**Settlement decision:** keep `runtime.whenSettled()` scheduler-specific.

Two options were considered:

1. Make `runtime.whenSettled()` wait for every transaction session open at
   the time of the call, then wait for scheduler work triggered by those
   sessions.
2. Keep `runtime.whenSettled()` as direct scheduler settlement. An open
   transaction that has not committed has not yet requested scheduler work,
   so it is outside this method's contract.

**Decision: Option 2.** The runtime is shared by unrelated application
features. Allowing one long-running transaction callback to block another
feature's scheduler-settlement check would preserve cross-feature coupling
through a different channel after notification and scheduling dispatch had
been isolated.

The intended usage for transaction-triggered work is explicit:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(Context, value);
});
await runtime.whenSettled();
```

When the transaction promise resolves successfully, its commit has already
requested any required scheduler work. The following `whenSettled()` waits
for that work. Calling `whenSettled()` while a transaction remains open may
resolve if the scheduler is currently idle; it does not predict work that an
uncommitted session may request later.

During C4 implementation, source inspection also confirmed that the former
transaction-aware `buffer.whenSettled()` path had never been wired to the
public runtime API; public `runtime.whenSettled()` already delegated directly
to the scheduler. C4 therefore removes the unreachable guarded semantics
rather than making them public. This clarifies and preserves the effective
runtime contract while removing the notification buffer's remaining ambient
transaction state.

A separate whole-runtime quiescence API that includes open transactions is
deferred until a concrete consumer requires one. It must not be added by
silently broadening `runtime.whenSettled()`.

Implementation plan: `docs/implementation/114-transaction-overlap-
isolation-plan.md`.


The maintained public contract and migration examples are in `docs/api/01-public-api.md` and `docs/implementation/67-toi-8e-migration-guidance.md`.
