# Milestone 6: Typed Events Implementation Summary

## Status

Implementation and maintained documentation complete. Final automated repository and manual playground validation pending.

## Outcome

Milestone 6 introduces framework-agnostic typed domain events that invalidate graph data without direct store-to-store coupling.

The implemented cross-domain flow is:

```text
Appointments domain
  -> publishes AppointmentBooked
  -> does not import capability nodes or a compliance store

Capability domain
  -> declares invalidatedBy: AppointmentBooked
  -> conditionally matches the event job seeker
  -> does not import an appointments store or publisher

Graph runtime
  -> resolves indexed candidates
  -> evaluates predicates atomically
  -> invalidates matched nodes and descendants
  -> schedules subscribed stale work
```

The playground demonstrates the milestone exit criterion: appointment events invalidate capability status without either store importing the other.

## Public API

### Event definitions

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");
```

Event definitions are immutable typed handles. Their key is the runtime identity, while the payload type is carried for compile-time inference.

### Node invalidation declarations

Data and derived nodes may declare unconditional invalidation:

```ts
invalidatedBy: [AppointmentBooked] as const
```

They may also declare conditional invalidation:

```ts
invalidatedBy: [{
  event: AppointmentBooked,
  when: ({ payload, get }: EventInvalidationContext<
    typeof AppointmentBooked,
    readonly [typeof JobSeekerId]
  >) => payload.jobSeekerId === get(JobSeekerId),
}] as const
```

Predicate dependency access is limited to the node's declared dependency tuple. Context nodes cannot declare event invalidation.

### Publication

```ts
runtime.publish(AppointmentBooked, {
  jobSeekerId: 123,
  appointmentId: 456,
});
```

Publication commits invalidation synchronously. Resulting loads remain asynchronous through the existing scheduler, and callers may use `await runtime.whenSettled()` when they need scheduler quiescence.

## Graph model

Graph creation validates event metadata and builds a graph-local immutable event index.

Validation covers:

- blank event keys;
- malformed declarations from untyped JavaScript;
- conditional declarations without predicates;
- duplicate event keys on one node;
- event invalidation metadata on context nodes.

The index maps event keys to candidate nodes in graph registration order. It is internal and associated with each graph through a module-private `WeakMap`, so the public graph inspection API remains unchanged.

Equivalent event handles resolve by key. Shared event contracts should still be exported from one module because erased TypeScript payload types cannot be compared at runtime.

## Immediate publication semantics

Outside transactions, publication:

1. Resolves candidates without scanning every graph node.
2. Evaluates all predicates against committed successful dependency values.
3. Applies no mutation if any predicate throws.
4. Collects matching target nodes.
5. Includes their transitive descendants.
6. Deduplicates converging paths by node key.
7. Advances each affected generation once.
8. Preserves successful stale data.
9. Clears obsolete errors.
10. Aborts affected work after generation advancement.
11. Emits one notification.
12. Requests at most one scheduler pass.

Unused events and publications whose predicates all return `false` are silent no-ops.

## Transaction semantics

Events published inside `runtime.transaction(...)` are staged in call order.

On successful root commit:

1. Final staged context values form a predicate-read overlay.
2. All staged event predicates evaluate before graph mutation.
3. Matched event targets are combined with context-driven invalidation.
4. The complete affected-node set is deduplicated.
5. Context values and invalidation commit through one notification boundary.
6. Subscribed stale work requests at most one scheduler pass.

On rollback, staged publications are discarded.

Predicate failure during commit leaves both context and event effects uncommitted. Nested and joined transaction calls share the same publication list and preserve the existing root-owned outcome semantics.

## Runtime capability boundaries

### Event definitions

`src/core/events/event.ts` owns typed immutable event handles.

### Event index

`src/core/events/event-index.ts` owns graph-to-index association and candidate lookup.

### Runtime event matching

`src/core/events/events.ts` owns publication matching and predicate dependency reads. It does not own node state, execution, scheduling, transaction outcome, or observation.

### Graph

`src/core/graph/graph.ts` validates immutable event metadata and builds the event index.

### Invalidation

`src/core/invalidation/invalidation.ts` owns the combined context/event invalidation commit, generation advancement, abort ordering, notification, and scheduler request decision.

### Transactions

`src/core/transactions/transaction-coordinator.ts` owns ordered publication staging, commit participation, and rollback discard.

### Runtime composition

`src/core/runtime.ts` remains the composition root and exposes `publish(...)` without adding a second execution or scheduler path.

## Playground

The **Typed Events** scenario contains an appointments publisher and a capability-status node separated into domain-facing modules.

It demonstrates:

- matching publication and automatic reload;
- non-matching publication as a no-op;
- staged publication remaining invisible;
- successful transaction commit;
- rollback discard;
- deterministic request counts;
- reset and unmount cleanup;
- no direct store-to-store dependency.

The scenario history is explanatory UI state only. A structured diagnostic event stream remains deferred to Milestone 10.

## Test coverage prepared

### Definition and type tests

- immutable event handles;
- blank-key rejection;
- payload extraction;
- declaration typing;
- dependency-safe predicate reads;
- context-node declaration rejection;
- publication payload typing.

### Graph tests

- deterministic event index;
- immutable candidates;
- key-equivalent lookup;
- graph index isolation;
- malformed declaration validation;
- duplicate declaration validation.

### Runtime tests

- direct and descendant invalidation;
- conditional matches and no-match behaviour;
- atomic predicate failure;
- stale-data retention;
- subscribed scheduler reload;
- shared-descendant deduplication;
- generation-before-abort ordering;
- ignored-abort protection.

### Transaction tests

- staged visibility;
- successful commit;
- rollback;
- final-context predicate reads;
- combined context/event deduplication;
- publication order;
- predicate-failure atomicity;
- joined transaction participation;
- scheduler settlement;
- commit-time abort behaviour.

### Playground tests

- matching and non-matching flows;
- transaction commit and rollback;
- deterministic reset;
- unmount cleanup;
- shell navigation.

## Non-goals preserved

Milestone 6 does not add:

- arbitrary event handlers;
- event callbacks in Vue components;
- durable messaging or replay;
- cross-tab delivery;
- backend transport ownership;
- asynchronous predicates;
- wildcard event names;
- event history or diagnostics;
- automatic mutation publication;
- query groups, polling, or devtools.

## Validation

Contained-environment static checks were completed during M6A through M6E, including core boundary checks, focused strict TypeScript compilation, changed-file hygiene checks, and ZIP integrity checks.

Final authoritative validation must run against the combined repository:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Then run the playground and complete the **Typed Events** checklist in `docs/PLAYGROUND.md`.

Do not mark Milestone 6 complete and validated until these results are reported successfully.
