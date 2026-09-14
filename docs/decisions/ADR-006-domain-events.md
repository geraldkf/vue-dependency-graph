# ADR-006: Typed Domain Events for Graph Invalidation

## Status

Implemented for Milestone 6. Event contracts, graph indexing, immediate publication, transaction-aware publication, and the cross-domain playground are implemented. Final combined automated and manual validation is pending.

## Context

Application domains need to make graph data stale after business actions without importing another domain's store or calling another store's loading methods directly. Direct store coupling makes ownership unclear and creates integration paths outside the graph scheduler.

The framework already owns node invalidation, stale-data retention, generation advancement, cancellation, subscription-aware scheduling, and atomic context transactions. Typed events should feed that existing machinery rather than create another execution model.

## Decision

Introduce immutable typed event handles and allow data and derived nodes to declare event-driven invalidation.

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");
```

Nodes may declare unconditional invalidation or a synchronous predicate using the typed payload and their declared dependencies.

```ts
invalidatedBy: [{
  event: AppointmentBooked,
  when: ({ payload, get }) =>
    payload.jobSeekerId === get(JobSeekerId),
}]
```

Applications publish through the runtime:

```ts
runtime.publish(AppointmentBooked, payload);
```

Event identity is key-based. The graph builds an immutable internal event invalidation index from node declarations. Publishing an event with no graph consumers is a silent no-op.

Publication invalidates matched nodes and their transitive descendants through the existing invalidation and scheduler capabilities. It does not invoke loaders directly.

Events published inside a graph transaction are staged in call order. On successful commit, effective context values commit first, event predicates evaluate against committed values, and combined context/event effects are deduplicated into one invalidation commit. Rollback discards staged publications.

## Consequences

- Domain publishers depend on shared event contracts rather than target stores.
- Payload shape and conditional matching are strongly typed.
- Predicates cannot read undeclared graph dependencies.
- Event publication uses existing stale-data, generation, cancellation, notification, and scheduling behaviour.
- A predicate failure causes no partial event-owned invalidation.
- Multiple publications remain distinct for ordering and future diagnostics, but affected node keys are deduplicated per transaction commit.
- Runtime delivery is in-memory and local to one `GraphRuntime`.
- External messages require application-owned validation and explicit mapping before publication.
- No general-purpose handler API or event history is introduced.

## Alternatives considered

### Direct store-to-store calls

Rejected because the publishing domain would need to know the target store and its invalidation or loading API.

### String-only publication

Rejected because payloads and declaration predicates would lose compile-time safety and refactoring support.

### Arbitrary event subscribers

Rejected for Milestone 6. Handler ordering, side effects, async failure, cleanup, and replay semantics would turn graph invalidation into a general event bus.

### Scan every node on publication

Rejected because immutable declarations allow a deterministic index to be built once during graph creation.

### Replay staged events one by one after transaction commit

Rejected because converging context and event effects could advance one node's generation multiple times and produce unnecessary notifications or scheduler requests.

### Deduplicate staged events by key

Rejected because repeated publications may carry different payloads and match different nodes. Deduplicate graph effects, not publication records.


## Amendment: explicit event ownership

TOI-2 introduces `GraphTransaction`, and TOI-4 removes ambient event staging. Transaction-owned event publications must use `transaction.publish(...)`. Plain `runtime.publish(...)` always evaluates and applies its event effects immediately, even while another transaction group is open. A transaction rollback discards only publications staged through its handle.

This amendment corrects the ownership gap in the original runtime-wide depth model. TOI-5 completes dispatch isolation: observer notification and automatic scheduling for an unrelated immediate publication bypass the transaction-owned buffer.
