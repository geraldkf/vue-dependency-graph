# ADR-006: Typed Domain Events for Graph Invalidation

## Status

Accepted, implemented, and validated.

## Context

Application domains need to make graph data stale after business actions without importing another domain's store or calling another store's loading methods directly. Direct store coupling makes ownership unclear and creates integration paths outside the graph scheduler.

The framework already owns invalidation, stale-data retention, generation advancement, cancellation, subscription-aware scheduling, and atomic local graph commits. Domain events should feed that machinery rather than create another execution or handler model.

## Decision

Introduce immutable typed event handles and allow data and derived nodes to declare event-driven invalidation.

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");
```

Nodes may declare unconditional invalidation or a synchronous predicate using the typed payload and the node's declared dependencies.

```ts
invalidatedBy: [
  {
    event: AppointmentBooked,
    when: ({ payload, get }) => payload.jobSeekerId === get(JobSeekerId),
  },
];
```

Event identity is key-based. Graph creation validates declarations and builds an immutable candidate index by event key. Publishing an event with no graph consumers is a silent no-op.

Predicates are evaluated before graph mutation. A predicate failure applies no partial event invalidation. Matching nodes and their transitive descendants are invalidated through the existing generation, cancellation, notification, and scheduler paths; publication does not invoke loaders directly.

### Publication ownership

Plain runtime publication is immediate:

```ts
runtime.publish(AppointmentBooked, payload);
```

It evaluates against committed graph state and remains independent while another transaction is open.

Transaction-owned publication is explicit:

```ts
await runtime.transaction((transaction) => {
  transaction.publish(AppointmentBooked, payload);
});
```

Staged publications retain call order. Successful commit evaluates predicates against the final staged context overlay and combines context-driven and event-driven effects into one graph commit. Rollback or context conflict discards the staged publications.

A confirmed mutation success may publish through `effects.publish(...)`. Its event matches are prepared with the mutation's other success effects and participate in the same local commit. Optimistic apply, remote rejection, unknown outcome, and failed success preparation do not publish the event.

Repeated publications remain distinct because their payloads may match different nodes. The resulting affected-node set is deduplicated within one commit so each affected node advances generation at most once.

### Delivery boundary

Events are an in-memory invalidation mechanism for one `GraphRuntime`. They do not provide cross-tab delivery, durable replay, server delivery, distributed transactions, or exactly-once handling. External transports remain application-owned and must validate and map incoming messages before calling `runtime.publish(...)`.

## Consequences

- Domain publishers depend on shared event contracts rather than target stores.
- Payloads and conditional matching remain strongly typed.
- Predicates cannot read undeclared graph dependencies.
- Event publication reuses the runtime's existing stale-data, generation, cancellation, notification, and scheduling behaviour.
- A failed predicate cannot leave partially invalidated graph state.
- Transaction-owned events share the transaction's commit, rollback, and conflict outcome.
- Mutation event publication occurs only after confirmed remote success.
- The framework is not a general-purpose event bus and does not define arbitrary event handlers or replay semantics.

Transaction session ownership is defined by [ADR-005](./ADR-005-atomic-graph-transactions.md). Mutation outcome semantics are defined by [ADR-013](./ADR-013-mutation-framework.md). Public event contracts and examples are maintained in the [Public API](../api/01-public-api.md) and [User Guide](../guides/00-user-guide.md).

## Alternatives considered

### Direct store-to-store calls

Rejected because the publishing domain would need to know the target store and its invalidation or loading API.

### String-only publication

Rejected because payloads and declaration predicates would lose compile-time safety and refactoring support.

### Arbitrary event subscribers

Rejected because handler ordering, side effects, asynchronous failure, cleanup, and replay semantics would turn graph invalidation into a general event bus.

### Scan every node on publication

Rejected because immutable declarations allow a deterministic candidate index to be built once during graph creation.

### Replay staged events as separate commits

Rejected because converging context and event effects could advance one node's generation multiple times and produce unnecessary notifications or scheduler requests.

### Deduplicate publications by key

Rejected because repeated publications may carry different payloads and match different nodes. Graph effects are deduplicated, not publication records.
