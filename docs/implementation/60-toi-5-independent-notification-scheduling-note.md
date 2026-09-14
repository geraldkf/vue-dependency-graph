# TOI-5 Independent Notification and Scheduling Note

## Status

Prepared. Offline validation pending.

## Implemented

- Split graph-change commit dispatch into explicit immediate and transaction-owned paths.
- Plain `runtime.setContext(...)` and `runtime.publish(...)` use direct observer notification and scheduler dispatch.
- Transaction commit continues using the transaction notification buffer for one coherent notification and at most one scheduler pass.
- `RuntimeInvalidationController.commitContexts(...)` accepts a narrow optional dispatch capability while retaining one graph-transition implementation.
- `runtime.whenSettled()` now observes the scheduler directly, so unrelated immediate work can settle while another transaction remains open.
- Updated transaction settlement tests to reflect explicit ownership. Callers await the transaction before awaiting work triggered by transaction commit.
- Added focused context and event tests proving observer notification and subscribed reloads occur before an unrelated transaction closes.

## Design boundary

Invalidation remains responsible for reconciliation, affected-node collection, generation advancement, cancellation ordering, stale-data preservation, and deciding whether notification or scheduling is required. Dispatch selection is supplied as a narrow `{ notify, schedule }` capability. The notification buffer remains transaction-owned dispatch infrastructure and does not decide operation ownership.

## Deliberately deferred

- TOI-6 now removes ambient guards from unrelated `execute(...)`, `prefetch(...)`, and `refresh(...)`.
- TOI-7 adds same-context conflict detection and completes concurrency semantics.

## Validation

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Offline validation remains pending because dependencies are not installed in the stored workspace.
