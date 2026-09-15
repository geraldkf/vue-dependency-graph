# Milestone 5: Atomic Transactions Plan

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Prepared for review and offline validation. No runtime behaviour is changed by this planning task.

## Objective

Milestone 5 will replace the current notification-only transaction seam with atomic local context commits. A successful outer transaction will publish one coherent set of context values, invalidate each affected descendant once, make relevant active attempts obsolete at commit, and request at most one automatic scheduler pass. A failed outer transaction will discard its staged context changes without invalidation, aborts, notification, or scheduling.

The exit criterion remains: observers do not see partially committed related context values.

## Current behaviour confirmed from source

`runtime.transaction(work)` currently delegates to `transactions/notification-buffer.ts`. The buffer:

- keeps a depth counter across synchronous and asynchronous work;
- coalesces nested transactions into the outermost completion;
- defers `notify()`, `schedule()`, `resolveSettlementIfIdle()`, and transaction-time `whenSettled()` dispatch;
- does not stage or roll back graph state.

Consequently, `setContext(...)` currently mutates the context and all descendants immediately. A later failure rejects the transaction but leaves those mutations committed. Active descendant attempts are also aborted immediately. The buffer hides intermediate notifications, but direct reads can observe the intermediate state.

## Source-confirmed mutation inventory

### Runtime state storage

`state/state.ts` owns mutable node records and active-attempt records. `getMutableState(key)` currently returns the live committed record.

### Context and invalidation

`invalidation/invalidation.ts` currently writes:

- context `data`, `status`, `freshness`, `error`, `generation`, and `hasSuccessfulValue`;
- descendant `generation`, `freshness`, `status`, and `error`;
- active-attempt abort signals for affected descendants.

It then notifies and conditionally schedules.

### Execution

`execution/execution.ts` currently writes:

- attempt-start `status`, `freshness`, and `error`;
- successful `data`, `status`, `freshness`, `error`, and `hasSuccessfulValue`;
- failed `status`, `freshness`, and `error`;
- active-attempt insertion and token-safe deletion.

### Refresh preparation

`operations/operations.ts` currently writes requested target `generation`, `freshness`, and `status`, aborts superseded attempts, then notifies before refresh execution.

### Subscription lifecycle

`subscriptions/subscriptions.ts` mutates direct and required subscription counts. Final unsubscribe cancellation is coordinated in `runtime.ts` and is not currently deferred as state.

### Scheduler

`scheduling/scheduler.ts` mutates scheduler flags and error state. Scheduler notifications are emitted through the raw observer after the notification buffer releases a deferred schedule request.

## Chosen consistency model

### Atomic unit

Milestone 5 transactions atomically commit **caller-driven context changes and their graph consequences**:

- final context values;
- context generation changes;
- descendant invalidation state;
- descendant generation changes;
- invalidation-time active-attempt abort decisions;
- one coalesced runtime notification;
- one coalesced automatic scheduler request when required.

The transaction does not provide backend atomicity and does not roll back remote work.

### Committed reads during a transaction

Public `runtime.getState(...)` continues to return committed state until the outer transaction commits. Staged context values are private to the transaction coordinator and are not exposed through the public API.

This is intentionally a committed-read model rather than a global read-through overlay. A global overlay would allow unrelated asynchronous work that runs while a transaction spans an `await` to read or write transaction-local state. That would make rollback capable of discarding legitimate execution completions that did not belong to the transaction.

The initial Milestone 5 API therefore does not provide read-your-writes through `getState(...)`. Consumers express the complete related update in the transaction body and observe it after the returned promise resolves.

### Execution and one-shot operations

Execution attempts that started before a transaction remain normal committed runtime work. Their start, success, and failure transitions are not transaction-owned and are not rolled back. Their notifications remain buffered while a transaction is open, as they are today.

To keep transaction semantics deterministic, the following caller-owned operations will be rejected when invoked from inside an active transaction:

- `runtime.execute(...)`;
- `runtime.prefetch(...)`;
- `runtime.refresh(...)`.

Automatic scheduler work cannot be newly started by staged context changes because scheduling is deferred until commit. Scheduler work already active before the transaction may complete normally.

This restriction avoids ambiguous dependency reads and promise ownership without changing behaviour outside explicit transactions. It can be revisited through a separate ADR if a concrete use case requires transactional execution.

### Subscription lifecycle

Subscription registration and release remain immediate in Milestone 5. They are not staged or rolled back.

The existing notification buffer still coalesces their notifications and scheduling dispatch. Final-unsubscribe cancellation remains immediate. This is an explicit limitation, but it does not violate the Milestone 5 exit criterion because subscription counts are not related context values.

A later change should address transactional subscription reconciliation only if a real component workflow requires unsubscribe and resubscribe to be atomic.

## Staging model

Add a narrow transaction context capability under `src/core/transactions/` rather than making all state access globally staging-aware.

The coordinator owns:

- transaction depth;
- the original committed value for each staged context key;
- the final staged value for each context key;
- outermost commit and rollback;
- coordination with the existing notification buffer.

`setContext(...)` delegates to the coordinator while a transaction is active. Outside a transaction it preserves the current immediate path.

The staged record should contain only what is required to reconcile final context changes. It should not clone every runtime node state eagerly.

## Final-state reconciliation

Multiple writes to one context are reduced to the final value.

For example:

```ts
await runtime.transaction(() => {
  runtime.setContext(Context, 2);
  runtime.setContext(Context, 1);
});
```

If the original committed value was `1`, commit is a no-op for that context:

- its generation does not change;
- descendants are not invalidated because of it;
- affected work is not aborted because of it;
- it does not cause notification or scheduling.

`Object.is` remains the equality rule.

## Commit algorithm

At successful completion of the outermost transaction:

1. Compare each final staged context value with its original committed value using `Object.is`.
2. Remove reverted or unchanged entries.
3. If no effective context changes remain, commit no graph state and release no transaction-owned notification or schedule request.
4. Apply every effective context value to its committed context state.
5. Increment each changed context generation once and restore its normal successful fresh context state.
6. Collect the transitive descendant union for all changed contexts using graph topology.
7. Deduplicate descendants by key, including shared and diamond paths.
8. Apply one invalidation transition to each affected descendant:
   - increment generation once;
   - mark freshness stale;
   - set status to `success` when a successful value exists, otherwise `idle`;
   - clear the error;
   - preserve data and `hasSuccessfulValue`.
9. Abort active attempts for affected descendants only after their committed generations have advanced.
10. Determine whether any affected descendant currently has total subscription ownership.
11. Record one transaction-owned notification.
12. Record one scheduler request only when subscribed affected work exists.
13. Commit the existing notification buffer so observers see the fully reconciled state before scheduler execution begins.
14. Re-check scheduler settlement and release transaction-time `whenSettled()` callers through the existing buffer contract.

The state commit and invalidation traversal must complete synchronously once outer transaction work has resolved. No observer or loader runs inside that commit sequence.

## Rollback algorithm

If the outer transaction body throws or rejects:

1. Discard all staged context records.
2. Do not mutate context values or generations.
3. Do not invalidate descendants.
4. Do not abort attempts because of discarded changes.
5. Do not issue a transaction-owned notification.
6. Do not issue a transaction-owned scheduler request.
7. Clear transaction lifecycle state.
8. Allow non-transaction runtime transitions that occurred independently while the transaction was open to remain committed.
9. Reject with the original error.

Nested transactions use one outer transaction scope and do not introduce savepoints.

## Nested transaction semantics

- Nested success contributes staged context writes to the outer transaction.
- An inner failure that propagates causes the outer transaction to roll back.
- An inner failure caught by outer work does not automatically poison the outer transaction. Writes made before the caught failure remain staged and may commit if outer work completes successfully.
- Only the outermost successful completion commits.
- Only the outermost failed completion rolls back.

This matches normal JavaScript error handling and avoids a hidden rollback-only flag.

## Execution completion while a transaction is open

An active attempt may complete while transaction work is awaiting.

The attempt commits through the existing execution path because it is not owned by the context transaction. Its notification is buffered until the transaction completes. At context commit:

- if the attempt's node is unaffected, its committed result remains valid;
- if the attempt's node is an affected descendant, commit-time generation advancement makes that result stale and aborts any attempt still active;
- if the attempt completed before generation advancement, its data is preserved as stale successful data after invalidation;
- if it completes after generation advancement, existing generation and token checks prevent an obsolete result from committing.

This preserves useful completed data without allowing it to override the committed context generation.

## Capability boundaries

### Transaction coordinator

Add a closure-based capability, likely:

```text
src/core/transactions/transaction-coordinator.ts
```

It owns transaction lifecycle, staged context values, nesting, effective-change reconciliation, commit, rollback, and operation guards.

### Notification buffer

`transactions/notification-buffer.ts` continues to own dispatch deferral only. Its public internal contract may receive a small commit-versus-rollback distinction if required so discarded transaction-owned dispatch flags are not released after failure.

This is a correctness change to lifecycle coordination, not a transfer of state-staging responsibility.

### State store

`state/state.ts` remains the owner of committed node state and active attempts. It may gain narrow commit helpers or cloning helpers only where they reduce direct mutation safely. It does not own transaction depth or the staged-context map.

### Invalidation controller

`invalidation/invalidation.ts` gains a commit-time path that:

- accepts the effective changed contexts and final values;
- applies context commits;
- collects and deduplicates descendants;
- applies one invalidation per descendant;
- aborts obsolete attempts after generation changes;
- returns whether scheduling is required.

The existing immediate `setContext(...)` path remains unchanged outside transactions.

### Execution controller

`execution/execution.ts` keeps its current committed execution model. It gains only an active-transaction guard at public caller-operation entry points through runtime or operations wiring. Execution writes are not added to the context staging overlay.

### Operations controller

`operations/operations.ts` preserves refresh behaviour outside transactions and rejects refresh and prefetch inside an active transaction through a narrow injected guard.

### Runtime composition

`runtime.ts` remains the explicit composition root and sequences:

1. transaction coordinator begin;
2. notification-buffer begin;
3. user work;
4. context commit or rollback;
5. notification-buffer commit or rollback;
6. lifecycle cleanup.

The exact API between the two transaction capabilities should be settled in the first implementation slice without exposing it publicly.

## Risks and edge cases

### Buffer rollback

The current notification buffer commits pending flags in `finally`, including when work throws. Atomic rollback requires distinguishing a successful outer completion from rollback so transaction-owned pending notification and scheduling flags can be discarded.

Independent runtime transitions that occur while the transaction is open still need their notifications preserved. The implementation must not blindly discard every buffered flag on rollback. The safest design is to track dispatch requested by transaction-owned context commit separately from dispatch caused by unrelated runtime work, or to defer creation of context notification and schedule flags until successful commit.

### Long asynchronous transactions

Because public reads remain committed and context writes are private, long transactions do not expose partial context state. They do delay transaction-buffered notifications and schedule dispatch. Callers should keep transaction work local and short even though asynchronous work is supported.

### Re-entrancy

Observer callbacks run only after commit. They may start another transaction normally. No observer may run while the context commit is being applied.

### Refresh and explicit execution

Rejecting caller-owned execution inside a transaction is a deliberate initial constraint. Tests and public documentation must state it clearly.

### Subscription cancellation

Immediate unsubscribe cancellation remains a known limitation. It should not be opportunistically redesigned during Milestone 5.

### Concurrency limiter

`maxConcurrentLoads` remains orthogonal. Transaction staging consumes no limiter slots and does not change FIFO admission. Delayed scheduling may change when a load is submitted, but not how the limiter admits it.

## Implementation sequence

### M5B: Transaction coordinator skeleton and operation guards

- Add transaction lifecycle ownership outside the notification buffer.
- Preserve nested async depth.
- Add `isInsideTransaction()` as an internal dependency.
- Reject explicit execution, prefetch, and refresh inside a transaction.
- Preserve current state behaviour temporarily.
- Add focused lifecycle and guard tests.

### M5C: Staged context values

- Stage final context values without touching committed state.
- Keep `getState(...)` committed-read.
- Preserve immediate `setContext(...)` outside transactions.
- Add multiple-write, equal-value, and nested staging tests.

### M5D: Atomic commit and coalesced invalidation

- Commit effective contexts together.
- Deduplicate descendant invalidation across roots and diamonds.
- Increment generations once.
- Abort affected attempts at commit.
- Notify once and schedule once.
- Add observer, generation, abort, and scheduler tests.

### M5E: Rollback and buffer lifecycle

- Discard staged context changes on synchronous throw or asynchronous rejection.
- Ensure no invalidation, abort, transaction-owned notification, or scheduling.
- Preserve independently committed execution transitions.
- Add propagated failure, caught nested failure, and independent execution tests.

### M5F: Settlement and race completion

- Confirm `whenSettled()` inside transactions waits through successful commit scheduling.
- Confirm rollback callers settle without phantom scheduler work.
- Cover execution completing before and after commit-time generation advancement.
- Confirm ignored-abort protection remains effective.

### M5G: Playground and maintained documentation

- Add a deterministic atomic-context playground scenario.
- Update public API, architecture, test strategy, ADR status, implementation summary, and roadmap.
- Run full automated and manual browser validation.

Each slice must remain prepared until its offline validation results are reported.

## Test plan

Final Milestone 5 coverage must include:

- two related context values observed atomically;
- committed reads during an open transaction;
- multiple writes to one context;
- final value equal to original value;
- two changed roots with one shared descendant;
- diamond descendant invalidated once;
- one generation increment per effective changed context and affected descendant;
- nested success;
- propagated inner failure rolling back the outer transaction;
- caught inner failure allowing outer commit;
- outer failure after inner success;
- synchronous throw and asynchronous rejection with equivalent rollback;
- no context notification after rollback;
- no context scheduler request after rollback;
- one coalesced context notification after commit;
- one scheduler pass after commit;
- affected attempt aborted at commit rather than at staging time;
- unaffected attempt remains active;
- completion before commit becomes preserved stale data when affected;
- completion after generation advancement cannot overwrite committed state;
- `whenSettled()` inside a successful transaction;
- `whenSettled()` during rollback;
- explicit execution, prefetch, and refresh rejected inside a transaction;
- behaviour outside transactions unchanged;
- concurrency-limit behaviour unchanged;
- subscription lifecycle behaviour explicitly unchanged.

Use deferred promises and observable conditions. Avoid real delays and fixed microtask-turn assumptions.

## Playground scenario

Add an **Atomic Context Commit** scenario with:

- two related context values;
- one derived or data result depending on both;
- a transaction containing an awaited gap between context writes;
- visible committed context values;
- an observer snapshot history;
- loader or derivation count;
- a rollback control.

The scenario must demonstrate that intermediate combinations are never observed and that rollback leaves the committed graph unchanged.

## Documentation changes required at milestone completion

- `docs/api/01-public-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/decisions/ADR-005-atomic-graph-transactions.md`
- `docs/implementation/01-roadmap.md`
- `docs/testing/01-test-strategy.md`
- playground documentation
- a final Milestone 5 implementation summary

## Validation

This planning task changes documentation only. Run locally:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Milestone 5 implementation remains unstarted until the first implementation slice is prepared. Planning remains validation pending until the commands above are reported successful against the combined repository.

## Next task

Prepare the implementation prompt for **M5B: Transaction coordinator skeleton and operation guards** after this consistency model is reviewed.
