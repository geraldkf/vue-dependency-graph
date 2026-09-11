# Mutations, Failures, and Cache Behaviour

## Mutations

A mutation is an operation that changes remote state and then reconciles graph state.

Supported strategies should include:

- Invalidate affected nodes after success
- Replace known node data after success
- Optimistically update before remote completion

## Optimistic mutation flow

```text
capture rollback state
apply optimistic updater in a local transaction
execute remote mutation
    |
    +-- success: reconcile and invalidate configured nodes
    |
    +-- failure: rollback local changes and expose mutation error
```

Proposed shape:

```ts
await graph.mutate({
  optimistic: tx => {
    tx.update(Appointments, current => [...current, pendingAppointment]);
  },
  execute: signal => api.bookAppointment(command, signal),
  onSuccess: (result, tx) => {
    tx.update(Appointments, current => replacePending(current, result));
    tx.publish(AppointmentBooked, toEvent(result));
  },
  invalidate: [CapabilityInterviewStatus],
});
```

## Rollback constraints

Rollback restores graph state, not backend state. If a remote request succeeded but the response was lost, reconciliation may require invalidation and refetch rather than assuming failure.

Initial implementation can use immutable snapshots of touched nodes for reliable rollback. More advanced patch-based rollback can be considered later.

## Cache behaviour

The first release should keep cache rules intentionally small:

- Successful data remains available until replaced or explicitly cleared.
- Invalidation marks it stale.
- Demand causes stale data to refresh.
- Optional `staleTimeMs` controls time-based freshness.
- Optional garbage collection may remove unobserved nodes after `gcTimeMs`.

Avoid introducing many named cache policies before concrete use cases exist.

## Failure scopes

Global fail-fast is too coarse. Failure should be evaluated by dependency branch.

- A child cannot execute if a required parent failed.
- An independent branch may continue.
- A query may report partial success.
- A node may retain stale data while exposing a refresh error.

## Node error model

Suggested error state distinguishes:

- Initial load error, no usable data
- Refresh error, stale data retained
- Dependency-blocked state
- Abort or superseded execution, not presented as a business error

## Retry policy

Retries should be explicit and bounded:

```ts
retry: {
  attempts: 3,
  delay: exponentialBackoff({ initialMs: 500, maxMs: 5_000 }),
  when: error => isTransient(error),
}
```

No automatic retry should occur for every error by default.

## Query aggregate state

For multiple nodes, expose enough information to avoid one ambiguous boolean:

- `isPending`: at least one required node has no usable data
- `isRefreshing`: usable data exists and at least one node is refreshing
- `isSuccess`: every requested node has usable successful data
- `errorsByNode`
- `hasPartialFailure`

## Manual refresh

Consumers may explicitly refresh a node or query. Manual refresh marks the requested nodes stale and schedules them. It should not require direct access to private execution APIs.
