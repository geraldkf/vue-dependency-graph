# Events, Refresh Policies, and Polling

## Domain events

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

## Event matching

Invalidating every instance for every event can be wasteful. A node may provide a predicate:

```ts
invalidatedBy: [{
  event: AppointmentBooked,
  when: ({ event, get }) => event.jobSeekerId === get(JobSeekerId),
}]
```

Predicates must be synchronous and side-effect free.

## Delivery semantics

The first release provides an in-memory event channel for one JavaScript application runtime.

It does not guarantee:

- Cross-tab delivery
- Server delivery
- Durable replay
- Exactly-once processing

External transports can call `graph.publish` when they receive messages.

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

Events published inside a graph transaction are applied at commit. Duplicate events may be coalesced for invalidation, but diagnostic history should preserve what was published.

### Implemented manual refresh

Step 3C provides explicit one-shot refresh:

```ts
await runtime.refresh([Targets]);
```

Manual refresh forces registered data and derived nodes to execute again. It is not a refresh policy and does not introduce timers, stale-time rules, focus handling, reconnect handling, polling, retries, or backoff. Context nodes are not refreshable because their values are changed through `setContext(...)`.

A changed refresh result invalidates transitive descendants while preserving their data. Subscribed descendants are then handled by the automatic scheduler. An `Object.is` equal result does not invalidate descendants.
