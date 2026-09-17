# TOI-8E Transaction Ownership Migration Guidance

## Status

Prepared. Documentation review and final validation pending.

## Purpose

Transaction participation is now explicit. Only calls made through `GraphTransaction` participate in commit or rollback. Plain runtime calls remain immediate and independent while another transaction is open.

## Required transaction callback migration

### Before

```ts
await runtime.transaction(async () => {
  runtime.setContext(JobSeekerId, 123);
  runtime.publish(AppointmentBooked, payload);
  await localWork();
});
```

### After

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(JobSeekerId, 123);
  transaction.publish(AppointmentBooked, payload);
  await localWork();
});
```

Do not retain ambient runtime calls inside transaction callbacks when they are intended to stage. Compilation may not find every old callback because a zero-argument function can still be passed where the runtime supplies one argument. Search transaction callback bodies explicitly for `runtime.setContext(...)` and `runtime.publish(...)`.

## Immediate runtime operations

These calls do not join another caller's transaction:

```ts
runtime.setContext(Context, value);
runtime.publish(Event, payload);
await runtime.execute([Node]);
await runtime.prefetch([Node]);
await runtime.refresh([Node]);
```

They use committed graph state. Context changes and event publications notify and schedule immediately. Caller-owned execution operations remain available while a transaction is open and do not observe staged context values.

## Helper migration

Pass the narrow capability to helpers that intentionally stage work:

```ts
const stageAppointment = (
  transaction: GraphTransaction,
  jobSeekerId: number,
): void => {
  transaction.setContext(JobSeekerId, jobSeekerId);
  transaction.publish(AppointmentBooked, { jobSeekerId });
};

await runtime.transaction(transaction => {
  stageAppointment(transaction, 123);
});
```

Prefer this over opening another transaction merely to share staged helpers. Explicit nested or overlapping `runtime.transaction(...)` calls still join one group and share the root outcome.

## Handle lifecycle

Do not retain a transaction handle after the group closes. Calls after commit, rollback, predicate failure, or conflict throw synchronously:

```text
Graph transaction is no longer active.
```

The handle intentionally does not expose public reads, subscriptions, settlement, execution, prefetch, refresh, commit, or rollback. Public reads remain committed reads.

## Conflict handling

A transaction records each context generation when that context is first staged. If an independent write changes the same context before commit, the transaction rejects atomically:

```ts
try {
  await runtime.transaction(async transaction => {
    transaction.setContext(JobSeekerId, 123);
    await localWork();
  });
} catch (error) {
  if (error instanceof GraphTransactionConflictError) {
    reportConflict(error.contextKeys);
  }
}
```

Conflict behaviour:

- independent values remain committed;
- no staged context partially commits;
- no staged event predicate is evaluated;
- no staged invalidation, abort, notification, or scheduling effect occurs;
- `contextKeys` is immutable and sorted deterministically.

## Settlement migration

`runtime.whenSettled()` observes ordinary scheduler work directly. To include scheduler work triggered by transaction commit, await in this order:

```ts
await runtime.transaction(transaction => {
  transaction.setContext(Context, value);
});
await runtime.whenSettled();
```

A `whenSettled()` call made while a transaction is merely open does not wait for that transaction to close. This allows unrelated immediate work to settle independently.

## Repository migration checklist

- Search all `runtime.transaction(...)` callbacks.
- Replace transaction-owned `runtime.setContext(...)` with `transaction.setContext(...)`.
- Replace transaction-owned `runtime.publish(...)` with `transaction.publish(...)`.
- Leave deliberately immediate runtime calls unchanged.
- Pass `GraphTransaction` into staging helpers.
- Add conflict handling where an independent same-context write is possible.
- Await the transaction before `runtime.whenSettled()` when commit-triggered work matters.
- Remove expectations that execute, prefetch, or refresh throw merely because another transaction is open.
- Add lifecycle tests if code can accidentally retain a handle.
- Validate context isolation, event isolation, conflict rejection, reset, and unmount behaviour.

## Compatibility

This is an intentional pre-release API correction. No compatibility mode preserves ambient staging because that would preserve the original silent capture and rollback defect. Historical Milestone 5 and Milestone 6 notes remain point-in-time records; maintained API and architecture documents describe the current contract.
