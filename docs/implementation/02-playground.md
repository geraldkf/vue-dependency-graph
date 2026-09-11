# Playground and Testing Harness

## Purpose

The playground is an executable specification for the framework. It should expose race conditions, invalidation behaviour, failure handling, and API ergonomics before integration into an existing application.

## Reference domain

Use a small neutral scenario with enough complexity to exercise the graph:

```text
JobSeekerId
├── Appointments
│   └── CapabilityInterviewStatus
├── PointPeriods
│   └── SelectedPointPeriod
│       └── Targets
└── Permissions
    └── CanModifyAppointment (derived)
```

Events:

- `appointment.booked`
- `appointment.cancelled`
- `appointment.rescheduled`

Long-running workflow:

- Start assessment
- Poll assessment progress
- Complete or fail

## Panels

### Scenario controls

- Change one context
- Change multiple contexts atomically
- Add and remove subscription
- Publish typed events
- Run optimistic mutations
- Start and cancel polling

### API simulator

Per endpoint controls:

- Latency
- Deterministic response
- Next-call failure
- Failure sequence
- Abort support
- Progress transition sequence
- Retry-after behaviour

Do not start with random failures because deterministic scenarios are easier to reproduce.

### Graph inspector

- Nodes and edges
- Status and freshness
- Active subscription count
- Current generation
- Last invalidation reason

### Timeline

- Context commits
- Scheduler flushes
- Node executions
- Events
- Mutations
- Poll attempts

### Metrics

- Request count by endpoint
- Deduplicated requests
- Abort count
- Discarded stale results
- Node duration
- Query time-to-ready

## Required scenarios

1. Child registered before parent.
2. Two context values committed in one transaction.
3. Rapid context change while a previous request is in flight.
4. Two components subscription the same node.
5. One component releases subscription while another remains.
6. Independent branch failure.
7. Parent failure blocks only dependent descendants.
8. Refresh failure retains stale data.
9. Domain event condition matches one job seeker only.
10. Polling completes.
11. Polling fails.
12. Polling times out.
13. Subscription disappears during polling.
14. Optimistic mutation succeeds.
15. Optimistic mutation fails and rolls back.
16. Snapshot exports with sensitive values redacted.

## Definition of useful playground

A contributor should be able to reproduce a graph behaviour by selecting a named scenario, run it repeatedly, and inspect identical diagnostic output without modifying application code.
