# Events, Refresh Policies, and Polling

> Milestone 8 refresh policies and polling are implemented and validated, including the deterministic Polling Progress playground. See `../implementation/86-milestone-8-implementation-summary.md`. The implementation sequence is recorded in [the Milestone 8 plan](../implementation/78-milestone-8-refresh-polling-plan.md), and the accepted architecture is recorded in [ADR-012](../decisions/ADR-012-refresh-policies-and-polling.md). The sections below describe the implemented behaviour.

## Domain events

Status: Milestone 6 implementation and maintained documentation are complete, with final combined automated and manual validation pending. Typed events support graph indexing, conditional matching, immediate publication, transaction-aware publication, and the cross-domain playground. See `docs/implementation/52-milestone-6-implementation-summary.md`.

Cross-store integration should use typed events rather than direct store imports.

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>('appointment.booked');
```

A node may declare invalidation events:

```ts
const CapabilityInterviewStatus = defineDataNode({
  key: 'capabilityInterviewStatus',
  dependencies: [JobSeekerId],
  invalidatedBy: [AppointmentBooked],
  load: ({ get }) => api.getCapabilityStatus(get(JobSeekerId)),
});
```

## Graph event index

Graph creation validates event declaration shapes, blank keys, duplicate event keys on one node, and defensive context-node declarations. It then builds a graph-local immutable candidate index keyed by event key. Candidate order follows graph registration order. The index is internal and does not expand the public `Graph` inspection API. Runtime publication consumes this index directly, avoiding a full graph scan per publication.

## Event matching

Invalidating every instance for every event can be wasteful. A node may provide a predicate:

```ts
invalidatedBy: [{
  event: AppointmentBooked,
  when: ({ payload, get }: EventInvalidationContext<
    typeof AppointmentBooked,
    readonly [typeof JobSeekerId]
  >) => payload.jobSeekerId === get(JobSeekerId),
}]
```

Predicates must be synchronous and side-effect free.

## Immediate publication

`runtime.publish(event, payload)` evaluates every indexed predicate against committed successful dependency values before applying mutation. A matching publication invalidates the directly declared nodes and their transitive descendants, preserves successful stale data, advances generations once, aborts affected attempts after generation advancement, emits one notification, and requests at most one scheduler pass. No-match and unused events are silent. Publications made through a `GraphTransaction` handle are staged in call order and participate in that session’s commit or rollback outcome.

## Delivery semantics

The first release provides an in-memory event channel for one JavaScript application runtime.

It does not guarantee:

- Cross-tab delivery
- Server delivery
- Durable replay
- Exactly-once processing

External transports can validate and map received messages, then call `runtime.publish(...)`.

## Refresh policies

Refresh policies describe when a successful or stale node should be loaded again.

Proposed policies:

- Manual invalidation only
- Stale after duration
- Refresh on window focus
- Refresh on network reconnect
- Fixed interval while subscribed
- Poll until a condition is satisfied

Browser-specific triggers belong in the Vue/browser adapter, while the core receives lifecycle signals through an injectable environment abstraction.

## Polling long-running operations

Polling is first-class because long-running workflows often return a progress resource before final completion.

```ts
const ReportProgress = defineDataNode({
  key: 'reportProgress',
  dependencies: [ReportId],
  load: ({ get, signal }) => api.getProgress(get(ReportId), signal),
  refresh: pollUntil({
    intervalMs: 2_000,
    stopWhen: result => result.state === 'completed',
    failWhen: result => result.state === 'failed',
    timeoutMs: 10 * 60_000,
  }),
});
```

## Polling requirements

- Poll only while the node has subscription, unless explicitly configured otherwise.
- Stop when the completion condition succeeds.
- Stop and expose an error when a failure condition succeeds.
- Stop on timeout.
- Pause when the browser is offline where browser integration is available.
- Avoid overlapping polls.
- Support abort when subscription disappears or dependencies change.
- Add jitter or backoff options to avoid synchronised clients.
- Record attempts and elapsed time in metrics.

## Progress callbacks

Consumers should read progress from node data. The polling engine should not require a separate callback channel.

## Event and transaction interaction

Events published inside a graph transaction are staged in call order and discarded on rollback. On successful commit, context values commit first, event predicates evaluate against committed values, and the combined affected-node set is invalidated once. Publication records are not deduplicated by key or payload; only their resulting graph effects are deduplicated. Diagnostic history for event publication is available through the Milestone 10 diagnostic event stream (`event.published`, `event.matched`; see `docs/api/01-public-api.md`).

### Implemented manual refresh

Step 3C provides explicit one-shot refresh:

```ts
await runtime.refresh([Targets]);
```

Manual refresh forces registered data and derived nodes to execute again. It is not a refresh policy and does not introduce timers, stale-time rules, focus handling, reconnect handling, polling, retries, or backoff. Context nodes are not refreshable because their values are changed through `setContext(...)`.

A changed refresh result invalidates transitive descendants while preserving their data. Subscribed descendants are then handled by the automatic scheduler. An `Object.is` equal result does not invalidate descendants.


## Transaction-owned and immediate event publication

Event ownership is explicit:

```ts
await runtime.transaction(transaction => {
  transaction.publish(AppointmentBooked, payload);
});

runtime.publish(UnrelatedEvent, payload);
```

`transaction.publish(...)` appends an ordered publication to the owning transaction session. Successful commit evaluates its predicates against the final staged context overlay and combines context-driven and event-driven invalidation into one atomic graph change. Rollback or context conflict discards the staged publication without evaluating or applying it.

Plain `runtime.publish(...)` always evaluates against committed state and applies matching invalidation immediately, even while an unrelated transaction is open. Its observer notification, scheduler work, execution result, and settlement are independent of that transaction. Repeated publications remain distinct for predicate order; only their resulting graph effects are deduplicated per commit.
