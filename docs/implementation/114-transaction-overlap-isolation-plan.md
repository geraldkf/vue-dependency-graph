# Transaction Overlap Isolation — Implementation Plan

## Status

- [x] C0 — Design note (this document + `ADR-005`'s "isolated transaction
      sessions" amendment)
- [x] C1 — `TransactionSession` (folded C3 into this step — see below)
- [x] C2 — `GraphTransaction.transaction()`
- [x] C3 — done, folded into C1 (see C1 notes)
- [x] C4 — Notification and scheduling dispatch isolation
- [x] C5 — Transaction diagnostic correlation isolation
- [x] C6 — Conflict detection and genuine overlap sanity pass
- [x] C7 — Event-only overlap isolation coverage
- [x] C8 — Migrate this repo's nested call sites by intent
- [x] C9 — Rewrite tests describing the old shared-group behaviour
- [x] C10 — Transaction Isolation playground
- [x] C11 — Documentation and final validation

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

## C4 — Notification and scheduling dispatch isolation

**Status: implemented and validated.**

### What shipped

`notification-buffer.ts` remains temporarily as a compatibility seam for the
existing runtime composition, but no longer owns transaction depth or pending
dispatch state. `notify()`, `schedule()`, `resolveSettlementIfIdle()`, and
`whenSettled()` now pass directly to their real runtime sinks.
`runTransaction(...)` preserves asynchronous error normalisation only; it does
not gate runtime activity.

Source inspection during C4 confirmed that public `runtime.whenSettled()` had
always been wired directly to `scheduler.whenSettled()`. The previous guarded
`buffer.whenSettled()` implementation was unreachable from the public API.
C4 records the effective scheduler-specific behaviour in ADR-005 and removes
the unreachable transaction-aware settlement semantics instead of making them
public.

This is intentionally a small change. Removing or renaming the now-pass-through
compatibility seam is deferred until final cleanup, after transaction call-site
migration confirms that no remaining internal contract requires it.

Focused coverage now proves that:

- one transaction can commit, notify, schedule, and reload while another
  independent transaction remains open;
- a subscription created while a transaction remains open notifies and loads
  immediately;
- committed graph state remains isolated until each owning session closes;
- scheduler-specific settlement remains available while an unrelated
  transaction callback is open.

**Expected temporary full-suite baseline:** the two obsolete shared-group
assertions in `tests/core/transaction-overlap.spec.ts` remain the only known
failures until C9 rewrites that file.

### Problem

`src/core/invalidation/invalidation.ts`'s `commitContexts` already
dispatches `notify()` and `schedule()` once per commit call. The existing
runtime-wide notification buffer therefore does not coalesce one
transaction session's own commit. Instead, while any transaction callback
is open, it can delay notification and scheduling caused by unrelated:

- immediate context writes;
- immediate event publications;
- scheduler and execution transitions;
- refresh-policy work;
- mutations;
- another independent transaction session.

Per-session staging is not fully isolated while this runtime-wide dispatch
gate remains.

### Change

Remove transaction-depth gating from live `notify()` and `schedule()`
dispatch. A transaction session's successful `commitSession(...)` already
produces one coherent graph commit and can dispatch through the same real
observer and scheduler paths used by immediate runtime changes.

Do not add session-aware notification buffers or one buffer per session.
The transaction coordinator owns staged state; observation and scheduling
remain independent runtime capabilities.

### Settlement decision

Keep `runtime.whenSettled()` scheduler-specific. The normal usage remains:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(Context, value);
});
await runtime.whenSettled();
```

Once the transaction promise resolves, its commit has already requested
any required scheduler work. The following `whenSettled()` call waits for
that scheduler work without also waiting for unrelated open transaction
callbacks.

Do not broaden `whenSettled()` to wait for every open transaction session.
That would reintroduce cross-feature coupling through settlement even after
notification and scheduling isolation are fixed. A separate whole-runtime
transaction-settlement API is deferred until a concrete consumer requires
one.

### Tests

Add `tests/core/transaction-notification-isolation.spec.ts` covering:

- an unrelated immediate context update notifies before another transaction
  callback closes;
- an unrelated immediate event publication notifies and schedules before
  another transaction closes;
- unrelated scheduler execution completes while a transaction remains open;
- `whenSettled()` remains scheduler-specific and does not wait for an
  unrelated open transaction;
- a caller that awaits its own transaction and then calls `whenSettled()`
  still waits for commit-triggered scheduler work.

### Exit criterion

Unrelated observer and scheduler activity is never delayed by an open
transaction session. Existing transaction atomicity remains unchanged.

---

## C5 — Transaction diagnostic correlation isolation

**Status: implemented and validated.**

### What shipped

Each top-level transaction now receives an internal immutable
`TransactionCommitContext` containing its runtime-local diagnostic operation
ID. The transaction coordinator stores that context on the owning
`TransactionSession` and returns it only through the session's commit callback.
The public `GraphTransaction` API and diagnostic event schema are unchanged.

`runtime.ts` no longer assigns a transaction operation ID to shared ambient
state before awaiting the transaction callback. At commit, the owning
operation ID is passed explicitly into `commitGraphChanges(...)`. That method
scopes graph-change observation to the synchronous commit, emits context,
event, and invalidation records with the owning ID, and restores the previous
synchronous diagnostic state afterward.

Focused coverage starts two independent sessions, commits them in reverse
start order, and verifies that each session's context, event, invalidation,
scheduler, node-load, and terminal transaction records retain the correct
operation and cause chain.

**Expected temporary full-suite baseline:** the two obsolete shared-group
assertions in `tests/core/transaction-overlap.spec.ts` remain the only known
failures until C9 rewrites that file.

### Problem

The runtime currently uses mutable composition-root diagnostic context,
including `graphChangeOperationId`, while transaction callbacks may overlap.
One transaction may overwrite that ambient operation ID before another
session commits. This can attribute one session's `context.changed`,
`node.invalidated`, scheduler, or node-execution records to another
transaction's operation.

Per-session state isolation must include per-session diagnostic causality.
A transaction's terminal record and graph-change records must never disagree
about operation ownership.

### Change

Remove ambient transaction diagnostic ownership from shared runtime fields.
Carry a narrow internal diagnostic context explicitly through the transaction
commit boundary, for example:

```ts
interface TransactionCommitContext {
  readonly operationId: string;
}
```

The runtime may pass this context to the coordinator/commit callback, or the
runtime may retain it in a runtime-owned wrapper around one session. Keep the
transaction coordinator independent of the diagnostics implementation. Do
not make public transaction IDs or add a telemetry abstraction.

The selected implementation must ensure that context changes, event matches,
invalidation, scheduler requests, and scheduler-owned node attempts use the
operation and cause IDs belonging to the session that actually committed.

### Tests

Add overlapping transaction diagnostics coverage that:

- starts two independent sessions with distinct operation IDs;
- commits the sessions in reverse start order;
- verifies each `transaction.started` and terminal event retains its own ID;
- verifies each session's context/event/invalidation records use that same
  operation ID;
- verifies scheduler and node-execution cause chains point to the correct
  committing session;
- verifies rollback or conflict from one session cannot alter another
  session's diagnostic chain.

### Exit criterion

No transaction diagnostic event depends on mutable ambient ownership shared
by overlapping sessions.

---

## C6 — Conflict detection and genuine overlap sanity pass

**Status: implemented and validated.**

### What shipped

The existing generation-baseline implementation required no production-code
change. Each session already records the committed generation when a context
is first staged, validates every staged context before predicate evaluation or
graph mutation, and creates an immutable, unique, sorted conflict-key list.

Focused genuine-overlap coverage now starts two sessions that both stage the
same context while also staging session-specific context and event work. The
suite releases the sessions in both completion orders and verifies that:

- the first session to commit succeeds;
- the later commit rejects with `GraphTransactionConflictError`;
- the successful shared value remains committed;
- the rejected session applies none of its other context or event effects;
- observer snapshots never expose rejected partial state;
- only the successful session emits graph-change diagnostics;
- committed and conflicted terminal diagnostics retain their owning operation
  IDs;
- repeated writes still produce unique, sorted, immutable conflict keys.

The pre-existing immediate-write conflict suite remains unchanged and
continues covering a plain runtime write that advances generation after a
transaction has staged its baseline.

**Expected temporary full-suite baseline:** the two obsolete shared-group
assertions in `tests/core/transaction-overlap.spec.ts` remain the only known
failures until C9 rewrites that file.

Re-read `tests/core/transaction-conflicts.spec.ts` against the isolated
session implementation. Preserve generation-baseline conflict detection:
a session records the committed generation when a context is first staged,
and validates every staged context before event evaluation or graph mutation.

Add genuine overlapping same-context tests rather than relying only on an
immediate runtime write:

```ts
const first = runtime.transaction(async transaction => {
  transaction.setContext(Context, 2);
  await releaseFirst.promise;
});

const second = runtime.transaction(async transaction => {
  transaction.setContext(Context, 3);
  await releaseSecond.promise;
});
```

Run both completion orders. In each case:

- the first session to commit succeeds;
- the later commit rejects with `GraphTransactionConflictError`;
- the successful value remains committed;
- no other context or event effect from the rejected session commits;
- observers never see partial rejected state;
- conflict keys remain unique, immutable, and sorted;
- diagnostic events identify the correct successful and conflicted sessions.

Also retain coverage for a plain immediate write changing a staged context's
generation before commit.

### Exit criterion

Disjoint sessions commit independently. Same-context sessions resolve by
ordinary optimistic generation conflict in either completion order, with no
partial commit.

---

## C7 — Event-only overlap isolation coverage

**Status: implemented and validated.**

### What shipped

The existing session-local event staging and commit path required no
production-code change. Focused overlap coverage now verifies event ownership
independently from context staging:

- two event-only sessions overlap while the committing session is released
  first and the other session later rolls back;
- both completion orders are covered;
- the committed event notifies, schedules, and reloads its subscribed target
  before the unrelated session closes;
- the rolled-back event never invalidates, reloads, or emits a publication
  diagnostic;
- committed publication, scheduler, and node-load diagnostic causality remains
  attached to the owning transaction operation;
- a predicate exception rolls back only its owning session and cannot alter a
  successfully committed event session;
- a mixed context/event conflict commits all work from the winning session and
  no context or event effect from the rejected session.

The tests use the public runtime entry points and observable state, scheduler,
listener, and diagnostic outcomes. No event matcher or coordinator internals
are called directly.

**Expected temporary full-suite baseline:** the two obsolete shared-group
assertions in `tests/core/transaction-overlap.spec.ts` remain the only known
failures until C9 rewrites that file.

Add direct coverage for independent event-only sessions:

- transaction A stages event A and remains open;
- transaction B stages event B and commits;
- B's matching invalidation, notification, scheduling, reload, and
  diagnostics complete before A closes;
- A subsequently rolls back and event A never applies;
- reversing the completion order preserves the corresponding independent
  outcomes;
- a predicate exception in one session applies no event effect and does not
  affect another session.

Include one mixed context/event case proving that a rejected or conflicted
session applies neither its context nor event work while another session's
commit remains intact.

### Exit criterion

Event publication ownership is session-local and has the same independence
and atomicity guarantees as staged context changes.

---

## C8 — Migrate this repo's nested call sites by intent

**Status: implemented and validated.**

### What shipped

A repository-wide structural audit found eight nested
`runtime.transaction(...)` calls, all in transaction behaviour tests. Every
call was intentional same-session composition rather than independent work:

- two staged-value composition cases in
  `tests/core/transaction-staging.spec.ts`;
- three propagated, caught, and outer rollback cases in
  `tests/core/transaction-rollback.spec.ts`;
- two staged-event composition cases in
  `tests/core/transaction-events.spec.ts`;
- one nested-handle lifecycle case in
  `tests/core/transaction-handle.spec.ts`.

Each call now uses `transaction.transaction(...)` and performs nested writes
or publications through the nested handle. Test names and local variable names
that referred to root/joined group semantics were updated to describe outer,
nested, and shared-session ownership.

The audit found no nested `runtime.transaction(...)` call in `src/`, the
playground scenarios, or the other listed transaction suites. Top-level
runtime transactions that intentionally overlap remain unchanged and are
covered by the C4 through C7 isolation suites.

A structural follow-up check confirms that no `runtime.transaction(...)` call
is lexically nested inside another runtime transaction callback anywhere in
`src/` or `tests/`.

**Expected temporary full-suite baseline:** the two obsolete shared-group
assertions in `tests/core/transaction-overlap.spec.ts` remain the only known
failures until C9 rewrites that file.

Search every `runtime.transaction(...)` call made from inside an existing
transaction callback. Do not perform a blind textual replacement. Classify
each call site first:

### Intended composition

The inner work must share the caller's commit or rollback boundary. Change:

```ts
await runtime.transaction(...);
```

into:

```ts
await transaction.transaction(...);
```

### Intended independence

The work is a separate operation that merely overlaps in time. Keep:

```ts
await runtime.transaction(...);
```

and add a focused comment or test where the independence is not obvious.

Audit at least:

- `tests/core/transaction-staging.spec.ts`;
- `tests/core/transaction-rollback.spec.ts`;
- `tests/core/transaction-events.spec.ts`;
- `tests/core/transaction-invalidation.spec.ts`;
- `tests/core/transaction-conflicts.spec.ts`;
- `tests/core/transaction-context-isolation.spec.ts`;
- `tests/core/transaction-event-isolation.spec.ts`;
- `tests/core/transaction-operation-isolation.spec.ts`;
- `tests/core/transaction-races.spec.ts`;
- `src/` for internal re-entrant transaction calls.

### Exit criterion

Every nested call site documents its intended ownership through API choice.
Existing behavioural assertions remain unchanged unless they explicitly
encoded the removed ambient joining model.

---

## C9 — Rewrite tests describing the old shared-group behaviour

**Status: implemented and validated.**

### What shipped

`tests/core/transaction-overlap.spec.ts` no longer describes root, joined, or
shared-group ownership. Its three cases now verify observable isolated-session
behaviour:

- disjoint overlapping sessions commit independently in completion order;
- a failed session cannot commit through an overlapping successful session;
- one session's rollback cannot discard another session's successful commit.

The focused conflict, event, dispatch, settlement, and diagnostic suites added
in C4 through C7 remain responsible for the specialised overlap guarantees,
so this file stays small and does not duplicate those scenarios.

### Validation finding incorporated

The supplied full-suite output contained six failures. Two were the obsolete
shared-group assertions replaced by this step. The other four matched the
behaviour produced when C4's pass-through notification buffer is absent: a
committed event session remains gated behind another open session, and a later
transaction can overwrite the scheduler cause used by the delayed work.

To make that integration dependency explicit, this step carries the C4
pass-through buffer forward and adds a focused event-session regression to
`tests/core/transaction-notification-isolation.spec.ts`. The regression proves
that an event transaction can notify, schedule, and reload while an unrelated
transaction remains open. This also protects the C5 diagnostic-correlation and
C7 event-isolation tests from silently running against the pre-C4 buffer.

No transaction coordinator, conflict, event matching, or graph commit behaviour
changed in C9.

`tests/core/transaction-overlap.spec.ts` currently contains expectations for
the removed shared-group model. Replace or delete those cases after the new
isolation, conflict, event, dispatch, and diagnostic tests exist.

Do not merely invert expected values. Reframe tests around observable
business behaviour:

- each unrelated session follows its own callback outcome;
- disjoint commits are independent in either order;
- same-context commits conflict deterministically;
- one session's failure cannot commit or discard another session's work;
- notifications, scheduling, settlement, and diagnostics remain isolated.

### Exit criterion

No test describes unrelated `runtime.transaction(...)` calls as sharing a
root outcome or staged state.

---

## C10 — Transaction Isolation playground

**Status: implemented and validated.**

### What shipped

A dedicated `Transaction Isolation` playground tab now demonstrates the
behaviour delivered by C1 through C9 without overloading the existing Atomic
Transaction scenario.

The scenario presents two independent operations with separate transaction
phases, committed values, dependent request counts, and completion controls.
It supports:

- starting two disjoint top-level sessions and committing them in either order;
- rolling back either session without changing the other session's outcome;
- staging the same context in both sessions and showing first-commit-wins
  generation conflict behaviour;
- showing that one committed session notifies, schedules, and reloads its
  dependent node while the other session remains open;
- displaying scheduler state separately from transaction state, reflecting the
  scheduler-specific `runtime.whenSettled()` contract;
- showing recent diagnostic operation and cause IDs for committed, rolled-back,
  and conflicted outcomes;
- deterministic reset and safe disposal of open sessions.

The implementation is split between
`src/playground/scenarios/transaction-isolation-model.ts` and
`src/playground/scenarios/TransactionIsolationScenario.vue`. Behaviour-focused
component tests exercise independent completion, rollback isolation, conflict,
scheduler activity, diagnostics, reset, and unmount cleanup.

The existing Atomic Transaction, Typed Events, and Runtime Observability
scenarios remain applicable. Their introductory copy now directs overlap
exploration to the new scenario and describes event ownership in session-local
terms. No playground scenario was removed.

### Exit criterion

The playground visibly demonstrates isolated top-level session ownership,
conflict behaviour, scheduler independence, and diagnostic causality through
public runtime APIs only.

---

## C11 — Documentation and final validation

**Status: complete. Milestone 10 closed on 16 September 2026.**

### What shipped

Maintained architecture, public API, README, ADR, migration, historical
notification-buffer, roadmap, and test-strategy documentation now describe the
isolated-session contract consistently. The legacy ADR path now points to the
maintained decision record rather than preserving a conflicting contract.

The temporary pass-through notification-buffer compatibility seam was removed.
Runtime capabilities now call observer and scheduler sinks directly, and the
transaction coordinator owns only session lifecycle, staging, generation
validation, and commit.

### Validation handoff

The project owner reported final dependency-backed offline verification
successful for:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Focused static validation and repository consistency checks were also completed
for the final cleanup package. The Atomic Transaction, Transaction Isolation,
Typed Events, and Runtime Observability playgrounds remain applicable and
collectively demonstrate atomicity, overlap isolation, event ownership,
scheduler-specific settlement, conflict handling, and diagnostic causality.

Update maintained documentation only after the behaviour is validated:

- `docs/architecture/03-scheduler-transactions-and-concurrency.md`;
- `docs/api/01-public-api.md`;
- `README.md` transaction ownership section;
- `docs/implementation/23-transaction-notification-buffer-implementation-note.md`;
- `docs/decisions/ADR-005-atomic-graph-transactions.md`;
- transaction migration guidance;
- test strategy and validation handoff.

The maintained contract must state clearly:

- every top-level `runtime.transaction(...)` creates an independent session;
- `transaction.transaction(...)` is the only explicit same-session nesting
  mechanism;
- plain runtime operations remain independent;
- generation conflicts protect overlapping writes to the same context;
- notification and scheduling are not gated by unrelated sessions;
- `whenSettled()` remains scheduler-specific;
- diagnostic causality is session-local;
- transactions provide local graph atomicity, not backend rollback.

### Final validation

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Manually validate the Atomic Transaction, Transaction Isolation, Typed Events,
and Runtime Observability playground paths, including both transaction
completion orders, rollback, conflict, notification timing, scheduler-specific
settlement, reset, unmount, and causal diagnostic output.

### Exit criterion

All commands pass, manual paths pass, maintained current-contract sections use
isolated-session terminology, historical step records are clearly identified as
historical, and the completed implementation matches the isolated-session ADR.
