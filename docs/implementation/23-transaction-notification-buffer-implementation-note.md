# Transaction Notification Buffer Implementation Note

## Status

Prepared; offline validation pending.

## Objective

Add a seam that a future Milestone 4 transaction API can defer dispatch through, without any capability needing to know a transaction is open, and without changing any existing observable behavior when no transaction is used.

## Why this was needed

The scheduler's automatic coalescing (`scheduled` flag + `queueMicrotask`) already batches multiple *synchronous* `setContext` calls into one flush for free — this is existing, unchanged behavior, exercised by `tests/core/scheduler-coalescing.spec.ts`.

It does not cover a caller-driven update that spans an `await`. Two `setContext` calls separated by an `await` each call `schedule()` on their own synchronous turn, and the microtask queued by the first call runs before the second `setContext` executes, so the scheduler flushes twice with two separate loads instead of once with the final value. `tests/core/transaction.spec.ts` (`"without a transaction, an async-spanning update causes two loads"`) demonstrates this directly against the pre-existing code path and continues to pass unchanged — the wasteful behavior is still there when a transaction isn't used, by design; this change only adds a way to opt out of it.

## Files changed

- `src/core/runtime-notification-buffer.ts` (new)
- `src/core/runtime.ts`
- `src/core/index.ts`
- `tests/core/transaction.spec.ts` (new)
- `docs/implementation/01-roadmap.md`
- `docs/implementation/23-transaction-notification-buffer-implementation-note.md` (this file)

No `docs/implementation/prompts/` file was added for this change. The existing R1–R8 note/prompt pairing records a prompt-driven workflow; this change did not originate that way, and pairing every future note with a mirrored prompt file is what was driving the documentation volume up disproportionately to shipped code. This note stands alone.

## Buffer contract

`createRuntimeNotificationBuffer(sinks)` wraps four real functions — `notify`, `schedule`, `resolveSettlementIfIdle`, `whenSettled` — behind a depth counter, and returns drop-in replacements for the first three plus `whenSettled`, plus `runTransaction` and `isInsideTransaction`.

- At depth 0 (no transaction open), every call passes straight through to the real sink, synchronously, in the same order as before this seam existed. This is a hard invariant: outside `transaction(...)`, this wrapper is never observable.
- At depth > 0, `notify()`/`schedule()` calls are recorded as pending flags rather than dispatched. `resolveSettlementIfIdle()` is a no-op — it is always re-checked once at commit instead, because a mid-transaction call (for example from an unsubscribe) would otherwise be evaluated against transient mid-transaction scheduler state rather than the final post-commit state. `whenSettled()` calls made mid-transaction are parked and only resolve once commit's own dispatch has itself settled.
- `runTransaction(work)` increments depth, awaits `work()` (sync or async), decrements depth in a `finally`, and commits once depth returns to 0. Nested `transaction(...)` calls collapse into the outermost commit because they share the same depth counter.
- Commit fires each pending `notify`/`schedule` at most once, always re-checks `resolveSettlementIfIdle`, and — only if something called `whenSettled()` mid-transaction — chains onto the real `whenSettled()` so those callers also wait out whatever async work the commit's `schedule()` dispatch starts, not just the commit itself.

## Wiring change in `runtime.ts`

Mechanical only, no logic changes to any existing capability:

- The observer's `notify` is renamed `emitNotify` to mark it as a raw sink.
- The buffer is constructed immediately after `scheduler`, using `scheduler.schedule`, `scheduler.resolveSettlementIfIdle`, and `scheduler.whenSettled` as its real sinks.
- `execution` is still constructed before `scheduler`/`buffer` exist (this ordering was already required, since `scheduler` depends on `execution.execute`), so its `notify` dependency is passed as an indirection closure `() => buffer.notify()`, following the same forward-reference pattern already used in this file for `subscriptions`, `scheduler`, and `invalidation`.
- `subscriptions`, `invalidation`, and `operations` are constructed after `buffer` exists, so they receive `buffer.notify` / `buffer.schedule` directly.
- The scheduler's own internal `notify` (used for its `SchedulerState` transitions) stays wired to the raw `emitNotify`, not the buffer. Its calls only ever happen as a consequence of the buffer eventually invoking the real `schedule()`, which by construction only happens at depth 0 — buffering it again would have no effect and would reintroduce a circular dependency (buffer needs `scheduler.schedule`; scheduler would need `buffer.notify`).
- `whenSettled` on the public `GraphRuntime` is now `buffer.whenSettled` instead of `scheduler.whenSettled` directly.
- `GraphRuntime.transaction` is added as `buffer.runTransaction`.

## What this does not do

- Does not batch, defer, or roll back state mutations. `setContext`, invalidation's descendant walk, and execution's state commits still happen immediately, synchronously, at the point they are called — a transaction only defers when observers are told about them. `tests/core/transaction.spec.ts` (`"does not roll back partial state when the transaction body throws"`) asserts this directly.
- Does not defer or reconcile subscription lifecycle abort behavior. `afterUnsubscribe`'s scan for scheduler-only attempts to cancel still runs synchronously on `unsubscribe()`, not at commit. A component that unsubscribes and immediately resubscribes to the same node within one transaction can still have its in-flight attempt aborted prematurely. This is a separate mechanism from notification buffering and is not addressed here.
- Does not satisfy any Milestone 4 checklist item. See the roadmap addition in `docs/implementation/01-roadmap.md`.

## Tests

`tests/core/transaction.spec.ts` (new, 6 tests):

- Confirms the pre-existing async-spanning double-load gap still exists without a transaction.
- Confirms a transaction wrapping the same async-spanning update produces exactly one load with the final value.
- Confirms `whenSettled()` does not resolve mid-transaction even when an unsubscribe would otherwise make the real scheduler look idle — this test failed against the first draft of the buffer (which did not route `whenSettled` through it) and passes against the current one.
- Confirms nested transactions collapse into a single commit.
- Confirms behavior at depth 0 is an exact passthrough (existing call sites unaffected).
- Confirms a thrown transaction body does not roll back state committed before the throw.

## Offline validation

```
npx vue-tsc --noEmit -p tsconfig.json
npx vitest run
npm run check:boundaries
```

All three pass: 98/98 tests (92 pre-existing, unchanged, plus 6 new), clean typecheck, clean boundary check.

## Next task

Before Milestone 4 implementation begins: decide whether invalidation's own state mutation (not just its notify/schedule calls) should also become transaction-aware, and whether subscription-lifecycle abort checks should be deferred to commit. Both are called out above as explicitly out of scope for this change.
