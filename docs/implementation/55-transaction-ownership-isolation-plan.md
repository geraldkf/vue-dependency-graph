# Transaction Ownership Isolation Plan

## Status

Planning complete. TOI-2 through TOI-7 are prepared. Offline validation remains pending.

## Work item

**Transaction Ownership Isolation (TOI)**

This work is a cross-cutting corrective item after Milestone 6 and before Milestone 7. It replaces ambient runtime-wide transaction participation with explicit transaction ownership.

## Problem statement

The current transaction coordinator determines whether `runtime.setContext(...)` and `runtime.publish(...)` should be staged by checking whether any transaction group is active on the runtime.

That runtime-wide state does not identify which asynchronous call chain opened the transaction. Consequently, an unrelated caller can invoke a plain runtime operation while another caller's transaction is awaiting and have that operation silently captured by the open transaction.

For context writes, the observable failure is:

1. Caller A opens `runtime.transaction(...)` and awaits.
2. Caller B, which did not call `transaction(...)`, invokes `runtime.setContext(...)`.
3. Caller B's write is staged instead of committed immediately.
4. Public reads continue to expose the old committed value.
5. If Caller A rolls back, Caller B's write is discarded without an error being surfaced to Caller B.

Transaction-aware event publication has the equivalent ownership risk. A plain `runtime.publish(...)` call may be staged or discarded merely because an unrelated transaction is active.

The same runtime-wide transaction test also affects caller-owned `execute(...)`, `prefetch(...)`, and `refresh(...)` guards. An unrelated operation may be rejected even though its caller did not participate in the open transaction.

This behaviour is broader than the documented overlapping-transaction rule. Overlapping transaction calls explicitly opt into `runtime.transaction(...)`; captured plain runtime operations do not.

## Objective

Only operations performed through an explicit transaction handle participate in that transaction's commit or rollback.

Plain runtime operations remain immediate and independent, even while another transaction is open on the same runtime.

The target usage is:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(FirstContext, 2);

  await localWork();

  transaction.setContext(SecondContext, 20);
  transaction.publish(AppointmentBooked, payload);
});
```

Operations that do not use the handle remain normal runtime operations:

```ts
runtime.setContext(UnrelatedContext, 999);
runtime.publish(UnrelatedEvent, payload);
await runtime.refresh([UnrelatedNode]);
```

## Scope

This work covers:

- Explicit ownership of staged context writes.
- Explicit ownership of staged typed-event publications.
- Transaction-handle lifetime and use-after-close protection.
- Immediate notification and scheduling for unrelated runtime operations.
- Caller-owned execution operations while another transaction is open.
- Same-context conflicts between staged and immediate writes.
- Existing nested and overlapping transaction-group semantics.
- Public API, architecture, ADR, playground, tests, and migration documentation.

## Non-goals

This work does not introduce:

- Backend or distributed transactions.
- Database-style ACID guarantees.
- Snapshot isolation for all graph state.
- Rollback of HTTP calls or other remote work.
- Staging of data-node or derived-node execution completions.
- Read-your-writes through `runtime.getState(...)`.
- `execute(...)`, `prefetch(...)`, or `refresh(...)` on the transaction handle.
- Transaction savepoints.
- Independently committed nested transactions.
- A general-purpose asynchronous context propagation system.
- Node-specific locks.
- A new execution or scheduler engine.

## Design principles

### Explicit participation

Transaction participation must be represented by possession and use of a transaction handle. Runtime-wide activity alone must not make a caller part of a transaction.

### Narrow transaction authority

The transaction handle exposes only operations that have defined staged semantics:

- `setContext(...)`
- `publish(...)`

It does not duplicate `GraphRuntime`.

### Committed public reads

`runtime.getState(...)` continues to expose committed state while a transaction is open. The transaction handle does not expose a staged-state read API in this work.

### Immediate runtime operations

Plain runtime operations remain independent:

- `runtime.setContext(...)` commits immediately.
- `runtime.publish(...)` publishes immediately.
- unrelated `runtime.execute(...)`, `runtime.prefetch(...)`, and `runtime.refresh(...)` remain callable.

Immediate means state mutation, observer notification, invalidation, cancellation, scheduling, and settlement are not held behind another caller's transaction boundary.

### Atomic transaction commit

Transaction-owned context and event effects retain the existing atomic local commit model:

- final context values are reconciled;
- event predicates evaluate before mutation;
- context-driven and event-driven affected nodes are combined;
- converging paths are deduplicated;
- generations advance before affected attempts are aborted;
- observers receive one coherent committed graph state;
- at most one automatic scheduler pass is requested.

## Proposed public API

### Transaction callback

```ts
interface GraphRuntime {
  transaction<TResult>(
    work: (
      transaction: GraphTransaction
    ) => TResult | Promise<TResult>
  ): Promise<TResult>;
}
```

### Transaction handle

```ts
interface GraphTransaction {
  setContext<TNode extends AnyContextNodeDefinition>(
    node: TNode,
    value: NodeValue<TNode>
  ): void;

  publish<TEvent extends AnyEventDefinition>(
    event: TEvent,
    payload: EventPayload<TEvent>
  ): void;
}
```

`GraphTransaction` is the preferred public name because it identifies the capability as belonging to the graph runtime. `TransactionHandle` may remain an internal implementation name if useful, but public documentation should use one consistent term.

## Context ownership semantics

### Transaction-owned context write

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(JobSeekerId, 123);
});
```

The write is staged. It becomes committed only if the root transaction group succeeds.

### Plain runtime context write

```ts
runtime.setContext(JobSeekerId, 123);
```

The write is always immediate. It is never added to an active transaction's staged-context map.

### Final staged values

Multiple staged writes to one context retain only the final staged value:

```ts
await runtime.transaction(transaction => {
  transaction.setContext(JobSeekerId, 123);
  transaction.setContext(JobSeekerId, 456);
});
```

The effective staged value is `456`.

### Reverted staged values

If the final staged value equals the value observed when the context was first staged, using `Object.is`, the transaction applies no change for that context unless a conflict is detected first.

## Event ownership semantics

### Transaction-owned publication

```ts
await runtime.transaction(transaction => {
  transaction.publish(AppointmentBooked, payload);
});
```

The publication is staged in call order and participates in the root transaction outcome.

### Plain runtime publication

```ts
runtime.publish(AppointmentBooked, payload);
```

The publication is always immediate. It is never appended to an active transaction's staged-publication list.

### Transaction commit

At successful commit:

1. Determine effective, conflict-free staged context changes.
2. Evaluate staged event predicates against the final context-value overlay and committed dependency state.
3. Apply no graph mutation if predicate evaluation fails.
4. Combine context and event invalidation effects.
5. Commit the deduplicated graph changes atomically.

### Rollback

Root transaction rollback discards only operations staged through a transaction handle. Plain runtime publications remain committed and are not suppressed or discarded.

## Transaction-handle lifecycle

A transaction handle is valid only while its transaction group is open.

Calls after group closure must throw synchronously:

```ts
let captured: GraphTransaction | undefined;

await runtime.transaction(transaction => {
  captured = transaction;
});

captured?.setContext(JobSeekerId, 123);
// Throws because the transaction is closed.
```

The handle closes after:

- successful commit;
- rollback from synchronous failure;
- rollback from asynchronous rejection;
- predicate failure during commit preparation;
- root failure after joined participants settle.

A closed handle must not mutate committed or staged state.

## Same-context conflict policy

### Decision

Reject the transaction when a context staged by the transaction has been modified independently before commit.

This prevents the transaction from silently overwriting an unrelated immediate write.

### Detection

When a context is first staged, record its committed generation as the transaction's expected generation for that context.

At commit, compare the current committed generation with the recorded generation before applying any context or event effect.

A mismatch is a conflict.

### Conflict outcome

If any staged context conflicts:

- reject the transaction;
- commit none of its staged context values;
- apply none of its staged event publications;
- perform no transaction-owned invalidation;
- perform no transaction-owned abort;
- perform no transaction-owned observer notification;
- request no transaction-owned scheduler work;
- preserve all independently committed runtime changes.

Conflict checking occurs before event predicate evaluation and before graph mutation.

### Error shape

The initial implementation should introduce a named error if consumers or tests need reliable programmatic identification:

```ts
class GraphTransactionConflictError extends Error {
  readonly contextKeys: readonly string[];
}
```

If a public error type is not yet justified, use a stable error message and keep the type internal. The final choice is made during the conflict implementation slice, without changing the conflict semantics.

### Why reject instead of last-write-wins

Allowing the transaction to overwrite a later immediate write would replace the original capture bug with a different silent lost-update path. Conflict rejection makes the outcome visible to the transaction caller and preserves the unrelated write.

## Nested and overlapping transaction semantics

### Decision for this work

Preserve the current joined transaction-group semantics to keep the corrective work bounded.

- The first `runtime.transaction(...)` call opens the root group.
- Transaction calls started before the group closes join that group.
- All participants share staged contexts and publications.
- Every callback receives a handle associated with that group.
- All participants settle before the group closes.
- The root outcome continues to control commit or rollback.
- A joined failure remains visible to the joined caller and affects the root only when propagated into root work.
- All handles associated with the group close together.

This decision preserves current behaviour for callers that explicitly invoke `transaction(...)`. The corrective change is that plain runtime operations no longer join implicitly.

### Deferred reconsideration

Rejecting, serialising, or isolating independently overlapping transaction calls may be considered later if a concrete use case requires it. That would be a separate behavioural change.

## Notification and scheduling isolation

Removing a plain runtime write from the staged map is not sufficient. Unrelated work must not remain trapped behind the transaction's notification buffer.

While a transaction is open, a plain runtime context write or event publication must independently perform its normal committed behaviour:

- mutate committed state synchronously;
- advance relevant generations;
- invalidate affected nodes;
- abort affected attempts after generation advancement;
- notify observers without waiting for transaction closure;
- request scheduler work without waiting for transaction closure;
- allow settlement to reflect the resulting scheduler work.

Transaction-owned dispatch remains deferred until successful transaction commit.

The implementation should use explicit dispatch ownership rather than treating every notification and schedule request made during an open transaction as transaction-owned.

The notification buffer remains a dispatch concern. It must not become the owner of graph state or transaction participation decisions.

## Execute, prefetch, and refresh semantics

### Decision

Plain runtime caller operations remain available while another caller's transaction is open:

```ts
await runtime.execute([UnrelatedNode]);
await runtime.prefetch([UnrelatedNode]);
await runtime.refresh([UnrelatedNode]);
```

These operations read committed graph state. They do not see staged context values.

The transaction handle does not expose these operations. Code requiring transaction-owned context changes must wait for successful transaction completion before starting caller-owned execution against the new committed values.

### Race behaviour

Existing generation and attempt-token rules remain authoritative:

- pre-existing execution can complete while a transaction is open;
- successful data committed before transaction commit may later become stale;
- transaction commit advances affected generations before aborting attempts;
- late ignored-abort results cannot overwrite newer state;
- unrelated execution branches remain unaffected.

## Capability boundaries

### Graph transaction

The transaction capability owns:

- group lifecycle;
- transaction-handle creation and closure;
- staged context records;
- ordered staged event publications;
- expected context generations;
- conflict detection;
- root and joined participant coordination;
- successful commit participation;
- rollback discard.

### Runtime context and event APIs

The plain runtime APIs always use immediate committed paths. They do not inspect transaction activity to decide whether to stage.

### Invalidation

Invalidation continues to own:

- effective context reconciliation;
- direct event invalidation roots;
- descendant collection;
- affected-node deduplication;
- generation advancement;
- stale-data preservation;
- abort ordering;
- notification requirement;
- scheduler requirement.

Any shared commit helper must preserve one implementation of these graph-transition rules. It may accept a narrow dispatch strategy, but it must not expose transaction storage or move graph-state ownership into the notification buffer.

### Event matching

Event matching continues to own:

- candidate resolution;
- committed or final-context-overlay dependency reads;
- predicate evaluation;
- atomic match preparation;
- matched target collection.

### Notification buffer

The notification buffer remains dispatch and settlement infrastructure. It does not determine whether a runtime operation belongs to a transaction.

### Runtime composition

`runtime.ts` remains the explicit composition root. It wires immediate runtime operations and transaction-owned operations to the appropriate staging and dispatch paths.

## Implementation sequence

### TOI-2: Public transaction handle and lifecycle

- Add the public `GraphTransaction` contract.
- Change the transaction callback signature.
- Create one group-bound handle or facade per callback.
- Add active-state checks.
- Close handles on commit, rollback, and commit-preparation failure.
- Migrate focused transaction tests and call sites to the handle.

Exit condition: transaction ownership is represented explicitly and closed handles cannot be used.

### TOI-3: Explicit context ownership

- Route `transaction.setContext(...)` to staged context storage.
- Make `runtime.setContext(...)` always immediate.
- Preserve committed public reads.
- Preserve final-value reconciliation and atomic invalidation.
- Add the original unrelated-write regression tests.

Exit condition: a plain context write is never staged or discarded by another caller's transaction.

### TOI-4: Explicit event ownership

- Route `transaction.publish(...)` to ordered staged publications.
- Make `runtime.publish(...)` always immediate.
- Preserve final-context predicate overlays.
- Preserve combined context and event invalidation.
- Add unrelated-publication regression tests.

Exit condition: only handle publications participate in transaction commit or rollback.

### TOI-5: Independent notification and scheduling

- Separate transaction-owned deferred dispatch from unrelated immediate dispatch.
- Preserve invalidation ownership and one graph-transition implementation.
- Ensure unrelated observer notification occurs while the transaction remains open.
- Ensure unrelated subscribed work is scheduled and can settle while the transaction remains open.
- Cover context and event paths.

Exit condition: unrelated work is neither staged nor operationally delayed by an open transaction.

### TOI-6: Caller operations during transactions

- Remove runtime-wide transaction guards from unrelated `execute(...)`, `prefetch(...)`, and `refresh(...)` calls.
- Keep these operations absent from `GraphTransaction`.
- Confirm operations use committed state.
- Preserve execution race and concurrency-limit behaviour.

Exit condition: caller-owned runtime operations are not rejected merely because another caller has an open transaction.

### TOI-7: Conflict and overlap completion

- Record expected generations when contexts are first staged.
- Detect all conflicts before predicate evaluation or mutation.
- Reject atomically and preserve independent changes.
- Preserve existing joined-group semantics.
- Complete conflict, nested, overlapping, and handle-lifetime tests.

Exit condition: transaction commit cannot silently overwrite a conflicting independent context write.

### TOI-8: Playground, documentation, and final validation

- Update Atomic Transaction to use the handle.
- Update Typed Events to use `transaction.publish(...)`.
- Add a deterministic isolation demonstration or focused automated coverage.
- Update maintained API, architecture, ADR, testing, migration, and playground documentation.
- Run final automated and manual validation.

Exit condition: explicit transaction ownership is documented, tested, built, and manually demonstrated.

## Test plan

### Handle lifecycle

Cover:

- handle works while the group is open;
- handle closes after commit;
- handle closes after synchronous rollback;
- handle closes after asynchronous rollback;
- handle closes after event predicate failure;
- root and joined handles close when the group closes;
- a closed handle cannot stage context or publish events.

### Context isolation

Cover:

- unrelated plain context write is immediately readable;
- unrelated write survives successful transaction commit;
- unrelated write survives transaction rollback;
- unrelated write notifies before the transaction closes;
- unrelated subscribed descendants schedule before the transaction closes;
- transaction-owned context writes remain hidden before commit;
- transaction-owned context writes commit atomically;
- transaction-owned context writes roll back atomically.

### Event isolation

Cover:

- unrelated plain publication evaluates immediately;
- matching publication invalidates before the transaction closes;
- matching subscribed publication reloads before the transaction closes;
- unrelated publication survives transaction rollback;
- no-match publication remains silent;
- handle publication remains hidden before commit;
- handle publication commits with final staged context values;
- handle publication is discarded on rollback;
- predicate failure remains atomic.

### Operations

Cover:

- unrelated `execute(...)` works while a transaction is open;
- unrelated `prefetch(...)` works;
- unrelated `refresh(...)` works;
- operations observe committed rather than staged context values;
- affected pre-existing attempts become obsolete at transaction commit;
- unrelated attempts continue;
- the concurrency limiter remains shared and unchanged.

### Conflicts

Cover:

- immediate write to a staged context creates a conflict;
- conflict rejects the root transaction;
- no staged context partially commits;
- no staged event applies;
- no transaction-owned notification or scheduling occurs;
- the immediate write remains committed;
- conflicts across multiple staged contexts report deterministic keys;
- unrelated context writes do not cause conflict;
- reverted staged values still conflict if the context changed independently.

### Nested and overlapping groups

Cover:

- nested transaction callbacks share the group;
- independently overlapping transaction calls continue joining;
- root success commits joined staged work;
- root failure discards joined staged work;
- caught joined or nested failure preserves current root semantics;
- group handles close together;
- plain runtime operations do not join the group.

## Documentation changes

### Planning stage

Add this document and update:

- `docs/implementation/01-roadmap.md`
- `docs/decisions/ADR-005-atomic-graph-transactions.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/README.md`

The ADR updates should be amendments that record the discovered ownership gap and accepted correction. Historical implementation notes remain point-in-time records.

### Implementation completion

Update:

- `README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/decisions/ADR-005-atomic-graph-transactions.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/implementation/01-roadmap.md`
- `docs/testing/01-test-strategy.md`
- `docs/PLAYGROUND.md`

Add:

- a transaction ownership implementation summary;
- a final validation handoff;
- migration guidance for replacing ambient runtime calls inside transaction callbacks with handle operations.

## Migration shape

Current transaction-owned usage:

```ts
await runtime.transaction(async () => {
  runtime.setContext(FirstContext, 2);
  runtime.publish(AppointmentBooked, payload);
});
```

Target usage:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(FirstContext, 2);
  transaction.publish(AppointmentBooked, payload);
});
```

Plain runtime operations outside deliberate transaction ownership remain unchanged.

This is an intentional pre-release public API change. No compatibility mode should retain ambient staging because that would preserve the correctness defect.

## Risks

### Partial fix at state level

Making plain writes mutate committed state immediately while retaining transaction-wide dispatch buffering would still delay unrelated observers and scheduler work. Tests must assert timing before transaction closure.

### Lost updates

Without conflict detection, a later transaction commit could overwrite an immediate write to the same context. The selected policy is atomic conflict rejection.

### Duplicate invalidation implementation

Creating separate immediate and transaction graph-transition loops could allow generation, stale-data, or abort semantics to drift. Both paths should share the same invalidation rules.

### General transaction-object expansion

Adding committed reads, execution operations, subscriptions, or settlement to the handle would introduce unresolved staged-read and ownership semantics. Keep the handle narrow.

### Overlapping group complexity

This work preserves joined groups. It does not claim isolation between two explicit overlapping transaction calls. The corrected guarantee is that plain runtime operations do not join implicitly.

### Documentation drift

Historical notes should not be rewritten as if the handle existed during Milestones 5 and 6. Maintained documents should identify the new ownership model and point from superseded API examples where appropriate.

## Validation contract

Each implementation slice remains **Prepared** until offline validation is reported.

Run after every slice:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

For playground changes, also run:

```text
pnpm dev
```

Final manual validation must cover:

- explicit atomic context commit;
- explicit transaction rollback;
- staged typed-event commit and rollback;
- unrelated immediate context write while a transaction is open;
- unrelated immediate event publication while a transaction is open;
- unrelated work surviving transaction rollback;
- no warnings or suspended work after tab switching.

## Exit criterion

Only operations performed through a `GraphTransaction` participate in its commit or rollback.

Plain runtime context writes, typed-event publications, notifications, scheduling, and caller-owned operations remain independent while another transaction is open. A transaction cannot silently overwrite an independently committed write to a staged context.

## Next task

Prepare **TOI-2: Public transaction handle and lifecycle** after this plan and its ADR amendments are reviewed.
