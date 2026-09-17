# Milestone 6: Typed Events Plan

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Plan implemented through M6F documentation reconciliation. Final combined automated and manual validation remains pending.

## Objective

Add a framework-agnostic, in-memory typed event capability that allows one domain to publish a business event and graph nodes in another domain to declare event-driven invalidation without either domain importing the other's store or runtime implementation.

The milestone exit criterion remains:

> Appointment events invalidate capability status without either store importing the other.

Milestone 6 is intentionally limited to typed publication and graph invalidation. It does not introduce a general application event bus, durable messaging, event replay, event handlers with side effects, event-sourced state, cross-tab delivery, or backend transport ownership.

## Existing foundation confirmed from the repository

Milestone 6 builds on these validated behaviours:

- Node definitions are immutable typed handles and runtime state is owned per `GraphRuntime`.
- Graph creation already validates complete topology and builds deterministic parent and child indexes.
- Context and refresh invalidation already preserve successful data, advance generations, abort obsolete work, notify after committed state changes, and schedule subscribed stale work.
- Milestone 5 transactions stage context writes, reconcile affected descendants once, and separate transaction lifecycle from notification buffering.
- Runtime notification buffering already coalesces `notify`, `schedule`, and settlement dispatch while a transaction group is open.
- The playground uses one Pinia-owned runtime and deterministic scenario-local controls.

The event design should reuse these behaviours rather than creating a second invalidation, scheduling, observation, or transaction system.

## Proposed public API

### Typed event handles

```ts
interface EventDefinition<TPayload> {
  readonly key: string;
  /** Carries TPayload for inference without storing runtime state. */
  readonly __payloadType?: TPayload;
}

type AnyEventDefinition = EventDefinition<unknown>;

type EventPayload<TEvent extends AnyEventDefinition> =
  TEvent extends EventDefinition<infer TPayload>
    ? TPayload
    : never;

const defineEvent = <TPayload>(
  key: string
): EventDefinition<TPayload>;
```

Example:

```ts
const AppointmentBooked = defineEvent<{
  jobSeekerId: number;
  appointmentId: number;
}>("appointment.booked");
```

The handle carries payload typing and a stable diagnostic identity. It contains no mutable subscriber list and owns no delivery lifecycle.

### Event invalidation declarations

Data and derived nodes may declare unconditional or conditional event invalidation:

```ts
const CapabilityInterviewStatus = defineDataNode({
  key: "capabilityInterviewStatus",
  dependencies: [JobSeekerId] as const,
  invalidatedBy: [
    {
      event: AppointmentBooked,
      when: ({ payload, get }) =>
        payload.jobSeekerId === get(JobSeekerId),
    },
  ] as const,
  initialValue: undefined as CapabilityStatus | undefined,
  load: ({ get, signal }) =>
    api.getCapabilityStatus(get(JobSeekerId), signal),
});
```

The shorthand form remains available when every publication should match:

```ts
invalidatedBy: [AppointmentBooked] as const
```

The predicate context is planned as:

```ts
interface EventInvalidationContext<
  TPayload,
  TDependencies extends DependencyList,
> {
  readonly payload: TPayload;
  readonly get: GetDependencyValue<TDependencies>;
}
```

`get(...)` accepts only the node's declared dependencies. This prevents a predicate from creating hidden graph dependencies.

### Runtime publication

```ts
runtime.publish(AppointmentBooked, {
  jobSeekerId: 123,
  appointmentId: 456,
});
```

Planned signature:

```ts
publish<TEvent extends AnyEventDefinition>(
  event: TEvent,
  payload: EventPayload<TEvent>
): void;
```

Publication is synchronous with respect to committing invalidation state. Automatic loading remains asynchronous through the existing scheduler. `publish(...)` does not return a delivery receipt or wait for resulting loads. Callers that need scheduler quiescence use `await runtime.whenSettled()` after publication.

## Event definition decisions

### Identity

Event identity is key-based, matching node identity and diagnostics conventions.

Rules:

- Keys must be non-empty after trimming.
- Equivalent event handles with the same key represent the same event identity. Runtime JavaScript cannot verify whether independently created handles used the same TypeScript payload type, so shared events should be exported from one contract module.
- Publication resolves against the graph's event invalidation index by key.
- Publishing a valid event that has no invalidation declarations is a silent no-op.

The implementation should not require a separate top-level `events` registration array. Events become known to a graph through node `invalidatedBy` declarations. This keeps the definition model small and avoids registering events that the graph never consumes.

### Payload typing

Payload type safety is compile-time only. Runtime publication does not perform schema validation. Applications that accept untrusted external messages remain responsible for validating and mapping those messages before calling `runtime.publish(...)`.

### Mutability

`defineEvent(...)` returns a frozen immutable descriptor. It does not expose listeners, publish methods, or mutable metadata.

## Node definition model

### Supported node kinds

Event invalidation applies to data and derived nodes. Context nodes remain changed only through `setContext(...)` and cannot declare `invalidatedBy`.

### Declaration types

A node invalidation declaration is either:

```ts
type EventInvalidationDeclaration<
  TEvent extends AnyEventDefinition,
  TDependencies extends DependencyList,
> =
  | TEvent
  | {
      readonly event: TEvent;
      readonly when: (
        context: EventInvalidationContext<
          EventPayload<TEvent>,
          TDependencies
        >
      ) => boolean;
    };
```

The exact internal generic shape may be simplified during implementation, but public inference must preserve:

- the event payload type inside `when`;
- dependency-safe `get(...)` access;
- readonly event declaration collections;
- existing inference for node value, dependencies, loader, and derived result.

### Predicate contract

Predicates must be:

- synchronous;
- side-effect free;
- deterministic for the supplied payload and committed dependency values;
- free of asynchronous work;
- free of runtime publication or context mutation.

A predicate returning `false` leaves that node and its descendants unchanged.

If a predicate throws, `publish(...)` should fail before applying any event-owned invalidation. This requires evaluating all candidate predicates first and committing only after matching completes. Partial invalidation from earlier candidates is not acceptable.

## Graph construction and event index

Graph creation should build an immutable event invalidation index rather than scanning every node on every publication.

Conceptually:

```text
event key
  -> node A unconditional declaration
  -> node B conditional declaration
  -> node C conditional declaration
```

Each indexed record needs only:

- the registered event definition;
- the registered target node;
- the optional predicate.

Graph creation should validate:

- event keys are not blank;
- a node does not declare the same event key more than once;
- conditional declarations reference a valid typed event handle;
- event declarations are accepted only on data and derived nodes;
- returned inspection collections cannot mutate the index.

Registration and index order should be deterministic. Candidate targets should follow graph registration order so predicate evaluation and future diagnostics are reproducible.

The event index is internal for Milestone 6. A public event-topology inspection API is deferred until observability or devtools requires it.

## Publication and invalidation semantics

### Non-transaction publication

For `runtime.publish(event, payload)` outside a transaction:

1. Resolve event candidates from the graph event index.
2. If no candidates exist, return without notification or scheduling.
3. Evaluate every candidate predicate against the payload and committed dependency values.
4. If any predicate throws, rethrow the original error and apply no event invalidation.
5. Collect directly matched target nodes.
6. Collect the transitive descendant union of all matched targets.
7. Deduplicate direct targets and descendants by node key.
8. Apply the standard invalidation transition once to every affected node.
9. Advance each affected generation once.
10. Preserve existing data and `hasSuccessfulValue`.
11. Clear obsolete errors and set status consistently with existing invalidation behaviour.
12. Abort affected active attempts only after all affected generations advance.
13. Notify once after the complete event invalidation commit.
14. Request at most one scheduler pass when any affected node has subscription ownership.

A matched target is itself invalidated. This differs from context invalidation, where descendants are invalidated but the changed context remains fresh.

### No-match publication

A known event whose predicates all return `false` is a silent no-op:

- no generation change;
- no abort;
- no notification;
- no scheduler request.

### Data retention and errors

Event invalidation should use the existing stale-data model:

- successful data remains available;
- freshness becomes stale;
- status becomes `success` when a successful value exists, otherwise `idle`;
- existing error is cleared;
- `hasSuccessfulValue` remains unchanged.

This keeps event invalidation consistent with context and changed-refresh-result invalidation.

### Active attempts

If a matching event affects active work:

- advance all affected generations first;
- abort affected active attempts second;
- allow existing generation and token checks to reject ignored-abort completions as obsolete;
- leave unrelated attempts active.

### Scheduler interaction

Publication must reuse the existing automatic scheduler:

- stale subscribed affected nodes are scheduled;
- required ancestors are included by the existing execution engine;
- unrelated branches remain untouched;
- synchronous publication calls coalesce through existing scheduler behaviour;
- `whenSettled()` continues to represent scheduler quiescence only.

No event-specific execution engine or reload path should be introduced.

## Transaction-aware publication

### Required behaviour

Events published inside `runtime.transaction(...)` are staged until the transaction group successfully commits.

While the transaction is open:

- no event predicate is evaluated;
- no event-owned generation changes occur;
- no event-owned attempt is aborted;
- no event-owned notification is emitted;
- no event-owned scheduler request is made;
- public runtime reads remain committed reads.

On successful root commit:

1. Commit effective staged context changes.
2. Evaluate staged events against the newly committed context and dependency state.
3. Combine event-matched invalidation with the transaction commit boundary.
4. Invalidate each affected node once even when reached by multiple context changes, events, or descendant paths.
5. Advance each affected generation once.
6. Abort affected attempts after generation advancement.
7. Emit one coalesced notification for the transaction's graph-state commit.
8. Request at most one scheduler pass.

On rollback, staged event publications are discarded with no event-owned graph effect.

### Publication order

The transaction coordinator should retain staged publications in call order. This matters because:

- predicates are evaluated deterministically;
- future diagnostics should preserve every publication;
- two publications of the same event may have different payloads and match different nodes.

Milestone 6 should not deduplicate publication records by event key or payload. It may deduplicate the resulting invalidation node set at commit.

### Root and joined transactions

Events follow the validated Milestone 5 group semantics:

- root and joined calls share one staged event collection;
- the root outcome controls commit or rollback;
- all participants settle before the group closes;
- joined failure does not independently poison a successful root unless propagated into root work.

### Commit ordering decision

Committed context values must be visible to event predicates at transaction commit. Therefore context reconciliation occurs before event matching.

If context changes have already made an event target stale, the event does not increment that node's generation a second time in the same transaction commit. The combined affected-node set is deduplicated before transitions are applied.

This combined commit requirement means Milestone 6 should extend the transaction commit model deliberately rather than simply replaying `publish(...)` calls one by one after context commit.

## Capability design

### Event definitions

Suggested location:

```text
src/core/events/event.ts
```

Owns immutable event handles and payload utility types.

### Event invalidation contracts

Suggested location:

```text
src/core/events/types.ts
```

Owns internal/public-adjacent declaration and predicate context types.

### Graph event index

The graph capability should build and privately own the event-to-node index alongside existing topology indexes. Avoid a runtime map rebuilt per runtime because event declarations are immutable graph metadata.

### Runtime event controller

Suggested location:

```text
src/core/events/event-matcher.ts
```

A closure-based runtime capability should own:

- immediate publication validation and candidate matching;
- transaction-aware staging participation;
- predicate evaluation;
- conversion of matched event targets into one invalidation request.

It should not own:

- node state storage;
- descendant traversal implementation;
- active attempt storage;
- scheduler state;
- observation dispatch;
- transaction root outcome;
- diagnostics history.

### Invalidation integration

The existing invalidation capability should gain a reusable operation that accepts directly affected node roots and applies one unioned invalidation commit. Context commit and event publication should share the same state-transition helper where practical.

Avoid copying the generation, stale state, abort, notification, and scheduling loops into the event controller.

### Transaction integration

The transaction coordinator should own staged event publication records because it already owns transaction group lifetime and rollback. The notification buffer should remain dispatch-only.

A likely composition is:

```text
transaction coordinator
  -> staged context changes
  -> staged event publications
  -> successful commit callback
       -> context reconciliation
       -> event matching using committed context state
       -> one combined invalidation commit
  -> notification buffer release
```

The exact internal callback shape should be decided in the first implementation slice. Do not expose transaction internals publicly.

## Error behaviour

### Definition and graph errors

Invalid event keys and invalid `invalidatedBy` declarations fail during definition or graph creation, before a runtime is created.

### Publication errors

`publish(...)` should throw synchronously for:

- an invalid event handle shape entering through untyped JavaScript;
- a predicate exception;
- an internal missing dependency value required by a predicate.

A failed publication must apply no partial event-owned invalidation.

Publishing an event with no graph consumers is not an error.

### Scheduler and loader failures

Publication itself does not surface later loader failures. Resulting automatic execution follows existing behaviour:

- node failures are stored in node state;
- scheduler failure is available through `getSchedulerState().error`;
- `whenSettled()` resolves after scheduler failure;
- independent branches continue.

## Type-safety requirements

Compile-time tests should prove:

- `defineEvent<TPayload>` retains its payload type;
- `EventPayload<typeof Event>` resolves correctly;
- `runtime.publish(event, payload)` requires the exact payload shape;
- missing and incorrectly typed payload fields are rejected;
- unconditional declarations accept event handles;
- conditional predicates receive the correct payload type;
- predicate `get(...)` accepts declared dependencies;
- predicate `get(...)` rejects undeclared dependencies;
- context nodes cannot declare `invalidatedBy`;
- existing node inference is unchanged when `invalidatedBy` is omitted;
- readonly tuples retain event declaration inference.

Avoid `any`, broad string event names, and payload casts in public examples.

## Behavioural test plan

### Event definitions and graph validation

Cover:

- immutable event handle;
- blank event key rejection;
- deterministic event index construction;
- duplicate event declaration on one node rejection;
- equivalent event handles using one key resolve through key-based identity;
- graphs without events remaining unchanged;
- registration order not affecting dependency topology.

### Unconditional invalidation

Cover:

- one event invalidates one data node;
- a directly invalidated derived node becomes stale;
- transitive descendants invalidate;
- unrelated branches remain unchanged;
- successful stale data is retained;
- existing errors are cleared;
- fresh generation increments once;
- one publication produces one notification and at most one scheduler pass.

### Conditional matching

Cover:

- matching payload invalidates;
- non-matching payload is a silent no-op;
- predicate reads declared dependency values;
- multiple candidate nodes match independently;
- one predicate throwing prevents all event-owned invalidation;
- equivalent event handles resolve by key.

### Active work and races

Cover:

- affected active work aborts after generation advancement;
- unrelated active work remains active;
- ignored-abort completion cannot overwrite state;
- shared descendants reached from multiple matched roots advance once;
- data-load concurrency limits remain unchanged.

### Subscription and scheduling

Cover:

- subscribed matched nodes reload automatically;
- unsubscribed matched nodes remain stale without loading;
- required ancestors execute through the existing engine;
- no-match publication does not schedule;
- rapid synchronous publications coalesce scheduler work without losing final invalidation state;
- `whenSettled()` waits for event-triggered scheduler work.

### Transaction-aware events

Cover:

- event publication remains invisible while a transaction is open;
- successful transaction applies staged events at commit;
- rollback discards staged events;
- predicates evaluate against newly committed context values;
- multiple staged events preserve publication order;
- duplicate event publications do not duplicate one node's generation change in the commit;
- context and event effects sharing descendants deduplicate into one invalidation transition;
- joined transactions share staged publications;
- root failure discards publications from joined work;
- successful root commits publications from joined work;
- transaction-time `whenSettled()` waits through event-triggered scheduling.

### Regression coverage

The complete existing transaction, invalidation, scheduler, refresh, concurrency, Vue, Pinia, and playground suites must remain green.

## Playground scenario

Add one deterministic **Typed Events** scenario using two conceptual domains:

```text
Appointments domain
  publishes AppointmentBooked

Compliance domain
  owns JobSeekerId context
  owns CapabilityInterviewStatus data node
  declares event invalidation
```

The scenario should expose:

- current job seeker context;
- current capability status and request count;
- event payload job seeker identifier;
- publish matching event control;
- publish non-matching event control;
- publish inside transaction control;
- node status and freshness;
- committed event/invalidation history suitable for the scenario;
- deterministic API completion or response values.

Required demonstrations:

1. A matching event invalidates and reloads capability status.
2. A non-matching event leaves capability status untouched.
3. The appointments scenario code does not import the compliance store or node-loading implementation.
4. An event staged inside a transaction does not invalidate before commit.
5. Transaction rollback discards the staged event.
6. Repeated runs are deterministic and reset cleanly.
7. Switching tabs releases component-owned subscriptions and leaves no suspended transaction.

The scenario history is explanatory UI state, not a public runtime diagnostic event stream. Structured diagnostics remain Milestone 10.

## Implementation sequence

### M6A: Public event handles and node declaration types

Status: Implementation prepared; offline validation pending. See `docs/implementation/47-milestone-6a-event-handles-node-declarations-note.md`.

- Add `defineEvent`, `EventDefinition`, `AnyEventDefinition`, and `EventPayload`.
- Add typed `invalidatedBy` support to data and derived node options.
- Preserve existing node inference when no event declarations are supplied.
- Add compile-time tests.
- Update the public API proposal.

Exit condition: event payloads and conditional predicates are strongly typed without runtime behaviour.

### M6B: Graph validation and event invalidation index

Status: Implementation prepared; offline validation pending. See `docs/implementation/48-milestone-6b-event-index-implementation-note.md`.

- Validate event keys and declaration shapes.
- Reject duplicate event keys per node while preserving key-equivalent event identity.
- Build deterministic event-to-node candidate indexes during graph creation.
- Keep the index immutable and internal.
- Add graph behavioural tests.

Exit condition: a graph can resolve event candidates without scanning all nodes at publication time.

### M6C: Immediate runtime publication

Status: Implementation prepared; offline validation pending. See `docs/implementation/49-milestone-6c-immediate-publication-note.md`.

- Add `GraphRuntime.publish(...)`.
- Evaluate predicates atomically against committed dependency values.
- Reuse one invalidation union and existing state-transition semantics.
- Abort affected work after generation advancement.
- Notify once and request at most one scheduler pass.
- Add no-match, failure, scheduling, and race tests.

Exit condition: publishing a matching event outside a transaction invalidates and reloads only the required subscribed graph.

### M6D: Transaction-aware event publication

Status: Implementation prepared; offline validation pending. See `docs/implementation/50-milestone-6d-transaction-events-note.md`.

- Stage publication records in call order while a transaction group is active.
- Discard them on rollback.
- Evaluate them after effective context commit.
- Deduplicate combined context and event invalidation effects.
- Preserve root/joined transaction semantics.
- Extend settlement and race tests.

Exit condition: observers never see event effects from a rolled-back transaction or an intermediate transaction state.

### M6E: Cross-domain playground scenario

Status: Implementation prepared; automated and manual validation pending. See `docs/implementation/51-milestone-6e-typed-events-playground-note.md`.

- Add deterministic appointments-to-compliance event flow.
- Cover matching, non-matching, commit, rollback, reset, and unmount behaviour.
- Use the existing Pinia-owned runtime model.
- Add Vue Testing Library component coverage.

Exit condition: the playground visibly demonstrates cross-domain invalidation without direct store coupling.

### M6F: Documentation and final validation

Status: Maintained documentation reconciled; final combined validation pending. See `docs/implementation/52-milestone-6-implementation-summary.md` and `docs/implementation/53-milestone-6-validation-handoff.md`.

- Update maintained API and architecture documents from planned to implemented wording.
- Update ADR-006 with final implementation consequences.
- Update the roadmap and playground checklist.
- Run full automated repository validation.
- Complete manual browser validation.

Exit condition: Milestone 6 is documented, tested, built, and manually validated against its cross-domain exit criterion.

## Documentation changes expected during implementation

- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/testing/01-test-strategy.md`
- `docs/PLAYGROUND.md`
- a final Milestone 6 implementation summary

## Explicit non-goals

Milestone 6 does not add:

- arbitrary event subscribers or handlers;
- event callbacks in Vue components;
- event-derived state separate from graph nodes;
- durable queues, replay, persistence, or exactly-once delivery;
- backend or service-bus transports;
- cross-tab or cross-runtime broadcast;
- asynchronous predicates;
- event priorities;
- wildcard or pattern-matched event keys;
- event version migration;
- retries for publication;
- structured diagnostic history;
- mutations that automatically publish events;
- polling, stale-time, query groups, or devtools.

External transports may validate and map incoming messages, then call `runtime.publish(...)` explicitly.

## Risks and decisions to preserve during implementation

### Hidden dependencies

Conditional predicates must not gain unrestricted runtime reads. Restricting `get(...)` to declared node dependencies keeps topology honest and tests predictable.

### Partial invalidation

All predicates for one publication must be evaluated before mutation. Otherwise a later predicate failure could leave an earlier candidate invalidated.

### Transaction ordering

Predicates must see successfully committed transaction context values. Event replay before context commit would match against the wrong business scope.

### Duplicate generation changes

Context changes, multiple events, direct targets, and descendant paths can converge on one node. The commit boundary must deduplicate affected keys before generation advancement.

### General event-bus creep

The runtime event capability exists only to trigger graph invalidation. Adding arbitrary handlers would create side-effect ordering, error ownership, and lifecycle problems outside this milestone.

### Diagnostics deferral

Publication records should remain available long enough for transaction commit processing, but Milestone 6 should not retain an unbounded runtime event history. Diagnostic event streams and bounded history belong to Milestone 10.

## Validation contract

For each implementation slice, run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

For M6E and M6F, also run the playground and complete the Typed Events manual checklist.

Do not mark a slice validated until the project owner reports successful offline results. Do not mark Milestone 6 complete until the full repository commands and manual playground validation pass against the combined implementation.

## Open questions

No blocking question remains for the planning stage. The plan assumes:

1. Event identity is key-based, consistent with node identity.
2. Publishing an event with no consumers is a silent no-op.
3. Conditional predicates receive `payload` and dependency-safe `get(...)`.
4. Predicate failure aborts the publication atomically.
5. Context changes commit before staged event predicates are evaluated.
6. Multiple publications are preserved, while their resulting invalidation set is deduplicated.
7. Events invalidate data and derived nodes, not context nodes.

If any of these assumptions should differ, decide that before M6A because each affects public typing or transaction semantics.

## Next task

After this plan is reviewed, prepare **M6A: Public event handles and node declaration types** as a small implementation slice with no runtime publication behaviour yet.
