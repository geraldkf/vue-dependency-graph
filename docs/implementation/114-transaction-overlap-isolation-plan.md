# Transaction Overlap Isolation — Implementation Plan

## Status

- [x] C0 — Design note (this document + `ADR-005`'s "isolated transaction
      sessions" amendment)
- [x] C1 — `TransactionSession` (folded C3 into this step — see below)
- [x] C2 — `GraphTransaction.transaction()`
- [x] C3 — done, folded into C1 (see C1 notes)
- [ ] C4 — Notification dispatch fix
- [ ] C5 — Conflict detection sanity pass
- [ ] C6 — Migrate this repo's nested call sites
- [ ] C7 — Rewrite tests describing the old shared-group behaviour
- [ ] C8 — Documentation

Each checked-off step's own section below records what actually shipped,
including any deviation from the plan discovered during implementation.
Steps are landed and reviewed one at a time — see each step's own commit/
zip for the exact diff.

## Why this exists

`docs/decisions/ADR-005-atomic-graph-transactions.md`'s "context conflict
detection" amendment states: *"Overlapping explicit transaction calls
continue to join one group for this work... Serialising or rejecting
independently overlapping transaction calls remains deferred until a
concrete use case requires different semantics."* This plan is that
concrete use case. See the new "isolated transaction sessions" amendment
in that same document for the full rationale; this document is the
implementation breakdown it references.

In short: two calls to `runtime.transaction(...)` that overlap in time but
have no intent to compose currently share one outcome by accident, because
`transaction-coordinator.ts` stages every open transaction's writes into
one set of module-level maps gated by a single `activeGroup` flag. A
joined call's own promise settling correctly or not is decoupled from
whether its own writes actually commit. Given this runtime is a single
instance shared by the whole app (`docs/architecture/07-vue-and-pinia-
integration.md`), this is not a contrived scenario.

No external consumers of this library exist yet, so this plan removes the
shared/ambient model directly rather than fencing it with an opt-in flag
and a deprecation window — see the ADR amendment for why that's the right
call specifically because of that fact, and specifically because JS has no
reliable ambient-async-context mechanism (`AsyncContext` is TC39 Stage 2,
no native browser support) to make silent ambient joining safe the way
C#'s `TransactionScope`/`ExecutionContext` can.

---

## C0 — Design note

**Status: done.** See `docs/decisions/ADR-005-atomic-graph-transactions.md`,
"Amendment: isolated transaction sessions" — records the decision, the
related notification-buffer finding, and the `whenSettled` judgment call
(Option 1: keep a narrow guard scoped to open sessions).

---

## C1 — `TransactionSession`

**Status: done.** Also absorbed C3's deletion work — see "Deviation from
plan" below.

### What shipped

`src/core/transactions/transaction-coordinator.ts` rewritten: the
module-level `stagedContexts`/`stagedEvents`/`activeGroup` and the
`depth`/`rootSucceeded`/`resolveJoinedTransactions`/
`waitForJoinedTransactions` bookkeeping are gone. Every `runTransaction`
call now creates its own `TransactionSession` (`stagedContexts`,
`stagedEvents`, `settled`), stages into it, and commits or discards it
independently. `createGraphTransaction` takes the session directly instead
of a `group: symbol`; `assertActive()` checks `session.settled` instead of
comparing against a shared `activeGroup`.

### Deviation from plan: C3 landed with C1, not separately

The plan described C1 as a state-ownership change and C3 as a later,
separate deletion of the now-dead root/joined bookkeeping. In practice
there was no way to do C1 without deleting that bookkeeping in the same
diff — the moment every call gets its own independent session
unconditionally, `depth`/`isRoot`/the joined-settlement promise pair have
nothing left to read or coordinate. Leaving them in place, unused, would
have been dead code with no reviewable purpose, so they were removed here.
C3 is marked done for that reason; there is no separate C3 diff to review.

### Verified blast radius (ran the full suite, not just the predicted file)

Only `tests/core/transaction-overlap.spec.ts` broke, and only 2 of its 3
cases — smaller than expected, worth explaining precisely rather than
just noting the number:

- **The 2 that broke are exactly the ones the plan predicted:** a joined
  call's failure no longer causes its writes to commit via an unrelated
  successful root; a joined call's success no longer gets discarded by an
  unrelated failed root. Both now correctly reflect only their own
  outcome. This is the fix working as intended.
- **The 3rd case in that file ("joins overlapping transaction calls and
  commits after every participant settles") still passes**, but only
  because it writes to two *different* context nodes, one per call — so
  "both values end up committed" holds true whether they're one shared
  group or two fully independent transactions. Its name and framing are
  now inaccurate (there is no group), even though its assertions don't
  currently catch that. Flagged for C7.
- **`transaction-handle.spec.ts`'s "closes joined handles together when
  the shared group closes" test (ambient nesting: a second
  `runtime.transaction(...)` call from inside another's callback) also
  still passes** — this was the more surprising one, and worth
  understanding rather than taking at face value. Verified directly:
  under C1, that inner call is now itself an independent root, so it
  commits its own write standalone, before the outer call's `work` even
  finishes. The outer call has nothing staged of its own, so its own
  commit is a no-op that doesn't disturb the inner's already-applied
  write. The test's assertions happen not to distinguish this from real
  shared-group atomicity. **Confirmed this is a real, meaningful
  behaviour change, not just a coincidence that happens to be harmless:**
  probed directly with `inner succeeds, outer throws afterward` — under
  the old model this would roll back the inner's write; under C1 it does
  not (the inner has already committed independently by the time the
  outer throws). Ambient re-entrant nesting no longer provides any
  atomicity at all after C1. This is expected and intentional — real
  nested atomicity is only available from C2 onward, via
  `transaction.transaction(...)` — but it means this specific existing
  test is currently a false assurance (still green, but for the wrong
  reason) and needs strengthening, not just renaming, in C6/C7.

### Exit criterion

Met, with the above two files flagged rather than silently left as
coincidentally-green. Typecheck clean. 415/417 tests pass; the 2 failures
are the expected, predicted ones.

---

## C2 — `GraphTransaction.transaction()`

**Status: done.**

### What shipped

`src/core/transactions/types.ts`: `GraphTransaction` gains `transaction: <T>(
work: (transaction: GraphTransaction) => T | Promise<T>) => Promise<T>`.

`transaction-coordinator.ts`'s `createGraphTransaction(session)` implements
it exactly as planned: `assertActive()` then reuse the same `session` --
no new commit boundary, no participant tracking. Matches the original
plan's sketch with no deviation this time (C1's deviation doesn't recur
here, since this step never needed the removed depth/root bookkeeping in
the first place).

Note `assertActive()` throws *synchronously*, same as `setContext`/
`publish` already do -- calling `transaction.transaction(...)` after the
parent has settled throws immediately, it does not return a rejected
promise. Test written accordingly (`expect(() => ...).toThrow(...)`, not
`await expect(...).rejects.toThrow(...)`).

### Tests

Added to `tests/core/transaction-handle.spec.ts`, in a new nested
`describe("explicit nesting via transaction.transaction(...)")` block
(the file's 4 existing tests, including "closes joined handles together
when the shared group closes," are untouched here -- that one's
name/premise is still stale from before C1 and is explicitly C6/C7's job,
not this step's):

- nested work commits as part of the same session as the outer's own
  writes;
- nested work throwing rolls back the *whole* session, including the
  outer's own already-staged writes -- this is the concrete proof that
  explicit nesting restores real atomicity, in contrast to C1's finding
  that ambient re-entrant nesting no longer does;
- a conflict detected against nested work's staged context propagates to
  the outer caller as `GraphTransactionConflictError`;
- calling `transaction.transaction(...)` after the parent has already
  settled throws "Graph transaction is no longer active," matching
  `setContext`/`publish`'s existing behaviour for the same case.

### Exit criterion

Met. 8/8 in `transaction-handle.spec.ts` (4 existing + 4 new), typecheck
clean, full suite 422/424 -- the same 2 pre-existing, expected
`transaction-overlap.spec.ts` failures from C1, still queued for C7,
nothing new broken.

---

## C3 — Delete root/joined bookkeeping

**Status: done — folded into C1.** See C1's "Deviation from plan" note
above for why: there was no reviewable way to land C1 without this
deletion happening in the same diff. Nothing further to do here.

---

## C4 — Notification dispatch fix

**Status: planned.**

### Change

`src/core/invalidation/invalidation.ts`'s `commitContexts` already
dispatches `notify()`/`schedule()` exactly once per call, confirmed from
source — so the buffering `notification-buffer.ts` provides was never
coalescing a transaction's *own* dispatch, only gating unrelated callers
while any transaction anywhere is open. Per C1/C3, there is no longer a
shared group for that gating to serve. Remove `notify`/`schedule` gating
from `runWithBufferedNotifications`'s depth check — `commitSession` calls
the real dispatch (`emitNotify`/`scheduler.schedule`) directly, same as
the immediate-write path in `runtime.ts` already does.

Per the ADR amendment's Option 1 decision, `whenSettled()`/
`resolveSettlementIfIdle()` keep a guard — scoped to currently-open
`TransactionSession`s rather than a global depth counter. Concretely: the
coordinator (not the notification buffer) tracks which sessions are
currently open, and a global `whenSettled()` call additionally waits for
each of them to reach `settled: true` (and for whatever `schedule()` call
their commit triggers) before resolving.

### Tests

New `tests/core/transaction-notification-isolation.spec.ts`: an unrelated
node's `notify()` fires immediately even while a separate, independent
transaction is open and mid-`await` — should fail against today's
`notification-buffer.ts` and pass after this change. Plus a test for the
Option 1 `whenSettled` guard: a `whenSettled()` call made while a
transaction is open waits for that transaction's eventual schedule
dispatch.

### Exit criterion

New tests pass; `notification-buffer.ts` survives in a smaller form (the
settlement-waiting piece only) rather than being deleted outright, since
Option 1 was chosen over Option 2.

---

## C5 — Conflict detection sanity pass

**Status: planned.**

Re-read `tests/core/transaction-conflicts.spec.ts` end to end against the
C1 implementation. The generation-baseline check doesn't reference
`activeGroup` today, so moving it onto `session.stagedContexts` should be
a mechanical carry-over. This step is verification, not redesign — if any
case needs a behavioural change rather than a call-site rename, that's a
signal C1 missed something.

**Exit criterion:** `transaction-conflicts.spec.ts` passes with zero
assertion changes.

---

## C6 — Migrate this repo's nested call sites

**Status: planned.**

Every `runtime.transaction(...)` call made from *inside* another
transaction's own callback needs to change to `transaction.transaction(
...)`. Requires a full read of each file below — most
`runtime.transaction(` occurrences in these files are ordinary top-level
calls needing no change:

`tests/core/transaction-handle.spec.ts`,
`tests/core/transaction-events.spec.ts`,
`tests/core/transaction-settlement.spec.ts`,
`tests/core/transaction-rollback.spec.ts`,
`tests/core/transaction-staging.spec.ts`,
`tests/core/transaction-invalidation.spec.ts`,
`tests/core/transaction-conflicts.spec.ts`,
`tests/core/transaction-context-isolation.spec.ts`,
`tests/core/transaction-event-isolation.spec.ts`,
`tests/core/transaction-operation-isolation.spec.ts`,
`tests/core/transaction-races.spec.ts` (name suggests independent overlap,
likely needs no migration — confirm rather than assume).

Also grep `src/` for any internal library code that nests
`runtime.transaction(...)` re-entrantly — none expected, needs confirming.

**Exit criterion:** every migrated file's existing assertions pass
unmodified with the new call spelling.

---

## C7 — Rewrite tests describing the old shared-group behaviour

**Status: planned.**

`tests/core/transaction-overlap.spec.ts`'s current cases assert exactly
the behaviour this plan removes (joins and commits together; a failing
joined call's writes committing anyway via the root; a succeeding joined
call's writes discarded anyway via the root). Repurpose the file to assert
independence directly, or fold its cases into
`transaction-session-isolation.spec.ts` from C1 and delete it — whichever
reads more clearly once in front of the implementer.

**Exit criterion:** full suite passes; no remaining test describes two
unrelated `runtime.transaction(...)` calls sharing an outcome.

---

## C8 — Documentation

**Status: planned.**

- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
  "Transaction seam" section: rewrite for session isolation and
  `transaction.transaction(...)`.
- `docs/api/01-public-api.md`: update `GraphTransaction` and
  `runtime.transaction`.
- `README.md` "Transaction ownership" section: extend to show
  `transaction.transaction(...)`; state that two `runtime.transaction(
  ...)` calls are always independent.
- `docs/implementation/23-transaction-notification-buffer-implementation-
  note.md`: note pointing forward to this plan.

**Exit criterion:** docs accurately describe the shipped behaviour, no
remaining reference to shared groups.
