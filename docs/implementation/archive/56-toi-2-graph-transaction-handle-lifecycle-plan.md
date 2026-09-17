# TOI-2: Public Graph Transaction Handle and Lifecycle Plan

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

## Status

Planning complete. No runtime behaviour has changed.

Implementation and offline validation remain pending.

## Parent work item

This slice implements the public ownership and lifecycle foundation defined by:

- `docs/implementation/55-transaction-ownership-isolation-plan.md`

TOI-2 deliberately does not yet make plain runtime context writes, event publications, notifications, scheduling, or caller-owned operations independent of an open transaction. Those behavioural corrections belong to TOI-3 through TOI-6.

## Objective

Introduce an explicit, strongly typed `GraphTransaction` handle and pass it to every `runtime.transaction(...)` callback.

The handle establishes which operations deliberately participate in a transaction group. It also provides a lifecycle boundary so transaction-owned operations cannot be performed after the group has committed or rolled back.

The target API is:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(FirstContext, 2);

  await localWork();

  transaction.setContext(SecondContext, 20);
  transaction.publish(AppointmentBooked, payload);
});
```

This slice establishes the handle and migrates transaction-owned call sites. It does not yet change the existing staging, invalidation, notification-buffer, operation-guard, conflict, or overlapping-group behaviour except where required to route transaction-owned calls through the handle.

## Problem addressed by this slice

The current callback receives no transaction-specific capability:

```ts
await runtime.transaction(async () => {
  runtime.setContext(FirstContext, 2);
});
```

The coordinator therefore relies on runtime-wide active transaction state to interpret later calls. That state cannot distinguish deliberate transaction participation from unrelated runtime activity.

TOI-2 creates the explicit ownership token required by later slices. It does not claim the isolation defect is fully fixed until TOI-3 through TOI-6 are complete.

## Scope

TOI-2 includes:

- Add the public `GraphTransaction` interface.
- Change `GraphRuntime.transaction(...)` to pass a handle to its callback.
- Create transaction handles through the transaction coordinator.
- Route handle `setContext(...)` to existing staged-context behaviour.
- Route handle `publish(...)` to existing staged-publication behaviour.
- Enforce handle validity while its transaction group is open.
- Reject handle operations after successful commit or rollback.
- Preserve current root and joined transaction-group semantics.
- Migrate all transaction-owned source, test, playground, and documentation call sites to use the handle.
- Add focused compile-time and behavioural lifecycle coverage.
- Preserve current behaviour outside transactions.

## Non-goals

TOI-2 does not yet:

- Make plain `runtime.setContext(...)` always immediate while another transaction is open.
- Make plain `runtime.publish(...)` always immediate while another transaction is open.
- Separate unrelated notification and scheduler dispatch from transaction-owned dispatch.
- Remove runtime-wide guards from `execute(...)`, `prefetch(...)`, or `refresh(...)`.
- Add same-context conflict detection.
- Change the existing joined overlapping-transaction model.
- Add transaction read-your-writes.
- Add staged-state inspection.
- Add `getState(...)`, `execute(...)`, `prefetch(...)`, `refresh(...)`, `whenSettled(...)`, or subscription APIs to the handle.
- Add manual `commit()` or `rollback()` methods.
- Add savepoints.
- Introduce asynchronous context propagation.
- Complete the full transaction ownership isolation exit criterion.

## Public API

### GraphTransaction

Add a public contract owned by the transaction feature:

```ts
export interface GraphTransaction {
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

The exact existing context-node base type should be reused. Do not introduce a duplicate public node union solely for this interface.

### GraphRuntime.transaction

Change the callback signature from:

```ts
transaction<TResult>(
  work: () => TResult | Promise<TResult>
): Promise<TResult>;
```

To:

```ts
transaction<TResult>(
  work: (
    transaction: GraphTransaction
  ) => TResult | Promise<TResult>
): Promise<TResult>;
```

The callback result remains generic and the returned promise retains the same result type.

Examples:

```ts
const result = await runtime.transaction(transaction => {
  transaction.setContext(JobSeekerId, 123);
  return "updated" as const;
});
```

`result` must infer as `"updated"`.

### Public exports

Export `GraphTransaction` from the public core barrel.

Do not export:

- the coordinator implementation;
- mutable handle state;
- transaction-group records;
- staged context records;
- staged event publication records;
- notification-buffer contracts;
- handle factory internals.

## Naming decision

Use `GraphTransaction` for the public interface.

Rationale:

- It describes the capability rather than its implementation mechanism.
- It avoids implying a generic platform or database transaction.
- It reads clearly in callback parameters and helper signatures.
- It remains distinct from the coordinator and transaction group.

Internal implementation types may use names such as `RuntimeTransactionHandle` only when needed, but avoid two public terms for the same concept.

## Handle authority

The handle is intentionally narrow.

### Included operations

- `setContext(...)`
- `publish(...)`

These operations already have defined staged transaction semantics.

### Excluded operations

The handle must not expose:

```ts
getState(...)
execute(...)
prefetch(...)
refresh(...)
subscribeNodes(...)
getSubscriptionState(...)
hasSubscribers(...)
getSchedulerState()
whenSettled()
onChange(...)
transaction(...)
commit()
rollback()
```

Reasons:

- Public reads remain committed reads.
- Caller-owned execution against staged values is intentionally unsupported.
- Subscription and observation ownership remains with the runtime.
- Commit and rollback remain controlled by callback completion and failure.
- Nested helpers can receive the same handle without opening a second transaction.

## Transaction-owned helper pattern

The handle should be passable to ordinary typed helpers:

```ts
const stageAppointmentContext = (
  transaction: GraphTransaction,
  jobSeekerId: number
): void => {
  transaction.setContext(JobSeekerId, jobSeekerId);
};

await runtime.transaction(async transaction => {
  stageAppointmentContext(transaction, 123);
  await localWork();
  transaction.publish(AppointmentBooked, payload);
});
```

This is the preferred composition pattern for deliberate transaction participation.

## Coordinator design

### Responsibility

The transaction coordinator remains the owner of:

- root and joined transaction-group lifecycle;
- staged context values;
- ordered staged event publications;
- participant settlement;
- root outcome;
- commit and rollback orchestration.

TOI-2 adds responsibility for:

- creating a `GraphTransaction` facade for a callback;
- validating that the facade remains active;
- closing every facade when its group closes.

### Handle implementation

A handle should be a frozen object with closure-based access to the owning transaction group.

Conceptually:

```ts
const createGraphTransaction = (
  group: TransactionGroup
): GraphTransaction => {
  let isActive = true;

  const requireActive = (): void => {
    if (!isActive) {
      throw new Error("Graph transaction is no longer active.");
    }
  };

  return Object.freeze({
    setContext: (node, value) => {
      requireActive();
      stageContext(group, node, value);
    },
    publish: (event, payload) => {
      requireActive();
      stagePublication(group, event, payload);
    },
  });
};
```

This is illustrative only. The implementation should match existing closure-based project conventions and avoid exposing `TransactionGroup` outside the transaction feature.

### Group-bound validity

A callback handle remains active while the whole transaction group remains open, not merely while that callback's own promise is pending.

This is required by the existing joined-group model:

- the root callback may settle while joined participants remain active;
- commit or rollback occurs only after every participant settles;
- staged work remains mutable until group closure under current semantics.

All handles associated with the group close together immediately before or as part of final group cleanup.

### Handle-per-callback versus shared object

Recommended implementation: create one immutable facade per `runtime.transaction(...)` callback, backed by the same group state.

Benefits:

- Each callback receives a capability explicitly.
- Handle references are not required to be identity-equal.
- Future diagnostics can identify participants without changing public semantics.
- All facades can share one group-active check.

Public API must not guarantee referential equality between root and joined handles.

## Lifecycle semantics

### Active callback

While the transaction group is open, these calls are valid:

```ts
transaction.setContext(Context, value);
transaction.publish(Event, payload);
```

### After successful commit

Both methods throw synchronously and commit no state.

### After rollback

Both methods throw synchronously and commit no state.

### After predicate failure

If commit preparation fails while evaluating a staged event predicate, all handles close and later handle use throws.

### After joined settlement

A joined callback handle does not close merely because that joined callback returns. It closes when the shared group closes.

This preserves existing group semantics, but documentation should discourage retaining a handle beyond the callback that received it.

### Error message

Use one stable, explicit message:

```text
Graph transaction is no longer active.
```

Do not include volatile participant identifiers or internal group state in the public message.

A public error class is not necessary for TOI-2 unless existing project conventions require one. The key behavioural contract is a synchronous throw with no mutation.

## Staging semantics in TOI-2

### Context writes

`transaction.setContext(...)` must use the existing context validation and staged-write path.

Required behaviour:

- Missing or non-context handles fail synchronously.
- Equivalent registered handles continue resolving by key where currently supported.
- Only the final staged value per context key is retained.
- `runtime.getState(...)` continues to expose committed state.
- Context generations do not advance during staging.
- Descendants do not invalidate during staging.
- Active attempts are not aborted during staging.
- Commit and rollback continue using existing behaviour.

### Event publications

`transaction.publish(...)` must use the existing staged-publication path.

Required behaviour:

- Payload typing remains bound to the event handle.
- Publication records retain call order.
- Repeated publications are not deduplicated before predicate evaluation.
- Event predicates remain deferred until successful commit preparation.
- Rollback discards staged publications.
- Existing final-context predicate overlay behaviour is preserved.

### Plain runtime calls during TOI-2

Until TOI-3 and TOI-4, existing ambient behaviour may still be present internally for plain runtime methods. TOI-2 documentation must clearly state that the isolation defect is not closed by this slice alone.

However, all repository-owned transaction call sites must migrate to the explicit handle so new code no longer demonstrates or reinforces ambient staging.

## Nested and overlapping transaction calls

### Current group semantics preserved

TOI-2 must not redesign overlapping transaction behaviour.

```ts
await runtime.transaction(async outerTransaction => {
  outerTransaction.setContext(FirstContext, 2);

  await runtime.transaction(async innerTransaction => {
    innerTransaction.setContext(SecondContext, 20);
  });
});
```

The two callbacks participate in the current shared transaction group.

The public contract does not guarantee:

```ts
outerTransaction === innerTransaction
```

Both handles target the same staged group state and close when the group closes.

### Preferred helper use

Where no independently observable nested transaction promise is required, prefer passing the existing handle to a helper instead of calling `runtime.transaction(...)` again.

This keeps ownership explicit and avoids unnecessary joined participant lifecycle.

## Runtime composition changes

`runtime.ts` should continue exposing one `transaction(...)` method. It delegates callback execution and handle creation to the coordinator.

Avoid constructing the public handle directly in `runtime.ts`. The coordinator owns the group and is the correct place to enforce lifecycle.

The composition root should provide the coordinator with narrow dependencies for:

- registered context validation and staging;
- event publication staging;
- existing group commit callback;
- notification-buffer transaction lifecycle.

Do not pass the entire runtime object into the coordinator.

## Type organisation

Recommended location:

```text
src/core/transactions/types.ts
```

This file already owns transaction-local shared contracts. Add `GraphTransaction` there if that matches the current structure after source reconciliation.

If `types.ts` currently contains only private contracts and the project distinguishes public types, keep the public interface in the same feature folder rather than creating a global public-types file.

The public barrel should re-export only the intended public contract.

## Source changes expected

Likely files:

```text
src/core/transactions/types.ts
src/core/transactions/transaction-coordinator.ts
src/core/runtime.ts
src/core/index.ts
```

Potential focused type-test file:

```text
tests/core/transaction-types.test.ts
```

Existing transaction test files requiring call-site migration:

```text
tests/core/transaction-staging.spec.ts
tests/core/transaction-invalidation.spec.ts
tests/core/transaction-rollback.spec.ts
tests/core/transaction-settlement.spec.ts
tests/core/transaction-races.spec.ts
tests/core/transaction-overlap.spec.ts
tests/core/transaction-events.spec.ts
```

Playground call sites likely requiring migration:

```text
src/playground/scenarios/AtomicTransactionScenario.vue
src/playground/scenarios/TypedEventsScenario.vue
```

Exact filenames must be reconciled against the checkout before implementation. Make the smallest path adjustment if the repository differs.

## Call-site migration rules

### Transaction-owned context changes

Change:

```ts
await runtime.transaction(async () => {
  runtime.setContext(FirstContext, 2);
});
```

To:

```ts
await runtime.transaction(async transaction => {
  transaction.setContext(FirstContext, 2);
});
```

### Transaction-owned event publications

Change:

```ts
await runtime.transaction(async () => {
  runtime.publish(AppointmentBooked, payload);
});
```

To:

```ts
await runtime.transaction(async transaction => {
  transaction.publish(AppointmentBooked, payload);
});
```

### Runtime operations that are deliberately not staged

Do not mechanically rewrite plain runtime calls that are intended to remain immediate or observe committed state.

Every changed call site should be reviewed for ownership intent rather than replaced through blind text substitution.

### Nested transactions

Use the handle belonging to each callback for its own staged operations. Do not capture the outer handle in an independently joined callback unless the test specifically covers shared-handle delegation.

## Behavioural test plan

### Public handle stages context

Verify that:

- the callback receives a handle;
- `transaction.setContext(...)` keeps the write hidden while open;
- successful completion commits the write;
- rollback discards the write.

Existing staging and rollback tests may cover most of this after migration, but add one focused handle test if ownership is not explicit in test names.

### Public handle stages events

Verify that:

- `transaction.publish(...)` remains invisible while open;
- successful completion commits the publication effect;
- rollback discards the publication.

Existing transaction-event tests should remain behaviour-focused and migrate without broad rewrites.

### Closed handle after success

```ts
let captured: GraphTransaction | undefined;

await runtime.transaction(transaction => {
  captured = transaction;
});

expect(() => {
  captured?.setContext(Context, 2);
}).toThrow("Graph transaction is no longer active.");
```

Also assert:

- context data unchanged;
- generation unchanged;
- no notification;
- no scheduler request.

### Closed handle after rollback

Cover both methods after rollback:

- `setContext(...)`
- `publish(...)`

The original rollback error remains the transaction caller's error. Later use of the captured handle throws the closed-handle error.

### Closed handle after asynchronous rejection

Use a deferred promise or explicit rejection, not a real timer.

### Closed handle after predicate failure

Stage an event whose predicate throws during commit preparation. Confirm:

- transaction rejects with the predicate error;
- handle closes;
- later handle use throws;
- no graph mutation occurred.

### Joined handle lifecycle

Verify:

- root and joined callbacks receive usable handles;
- root settlement waits for the joined participant under existing semantics;
- a handle does not mutate after final group closure;
- all captured handles are closed after commit;
- all captured handles are closed after root rollback.

Avoid asserting root and joined handle object identity.

### Immediate validation

Verify invalid context handles supplied through `transaction.setContext(...)` fail at the call site, not only at commit.

### Type inference

Compile-time tests should prove:

- callback result inference is preserved;
- `setContext(...)` accepts the correct value type;
- incorrect context value types fail;
- non-context node handles fail;
- `publish(...)` accepts the correct payload;
- missing or incorrectly typed payload fields fail;
- `GraphTransaction` can be accepted by a helper function;
- excluded runtime methods do not exist on the handle.

## Tests intentionally deferred

Do not add assertions in TOI-2 that require later isolation behaviour:

- plain runtime context write surviving another transaction rollback;
- plain runtime event publication remaining immediate;
- immediate unrelated observer notification while a transaction is open;
- immediate unrelated scheduler work while a transaction is open;
- unrelated `execute(...)`, `prefetch(...)`, or `refresh(...)` succeeding;
- same-context transaction conflict rejection.

Those tests belong to TOI-3 through TOI-7 and should initially be documented as pending, not made to pass through an incomplete workaround.

## Documentation changes for TOI-2

Update maintained API documentation to introduce the handle, while clearly marking the broader isolation work as in progress.

Expected files:

```text
docs/api/01-public-api.md
docs/architecture/03-scheduler-transactions-and-concurrency.md
docs/architecture/04-events-refresh-and-polling.md
docs/decisions/ADR-005-atomic-graph-transactions.md
docs/decisions/ADR-006-domain-events.md
docs/implementation/01-roadmap.md
docs/implementation/55-transaction-ownership-isolation-plan.md
docs/README.md
```

Add the implementation note after the slice is prepared:

```text
docs/implementation/56-toi-2-graph-transaction-handle-lifecycle-note.md
```

Historical Milestone 5 and 6 implementation notes should remain point-in-time records. Do not rewrite every historical example. Add a maintained-document pointer where necessary.

## Roadmap status during implementation

Use these states:

- **Planned**: this plan is accepted but files are not prepared.
- **Prepared**: source, tests, and documentation have been generated and statically reviewed.
- **Validation pending**: offline commands have not yet been reported.
- **Validated**: all required offline commands pass.
- **Blocked**: validation revealed an unresolved issue.

Do not mark TOI-2 complete solely because call sites compile in a contained environment.

## Compatibility and migration

This is an intentional pre-release source-breaking change for transaction callback bodies.

Existing callbacks without a parameter remain structurally callable in TypeScript because a zero-argument function can often be passed where one argument is supplied. Therefore compilation alone may not identify every old ambient staging call.

A repository-wide search is required for transaction callbacks containing:

```ts
runtime.setContext(...)
runtime.publish(...)
```

Those calls must be reviewed and migrated when transaction-owned.

Do not retain ambient staging as a compatibility feature. Later slices will remove it because preserving ambient behaviour preserves the correctness defect.

## Static inspection checklist

Before offline validation, confirm:

- `GraphTransaction` is exported publicly exactly once.
- The coordinator owns handle construction and closure.
- The handle is frozen.
- The handle exposes only `setContext` and `publish`.
- Both methods perform an active-state check before validation or staging.
- Closed-handle calls mutate no state.
- Callback result typing is preserved.
- Transaction-owned repository call sites use the callback handle.
- No broad `any` or TypeScript suppression was introduced.
- Core remains framework-agnostic.
- No Vue import enters `src/core`.
- No second transaction coordinator or execution path was added.
- Existing commit, rollback, predicate, generation, abort, and settlement logic remains in its owning capabilities.

## Validation commands

Run from the repository root:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

If playground transaction call sites change, also run:

```text
pnpm dev
```

Manual browser validation for TOI-2 should confirm existing scenarios still work with the new API:

- Atomic Transaction staged progress;
- Atomic Transaction commit;
- Atomic Transaction rollback;
- Typed Events staged commit;
- Typed Events rollback;
- tab-switch cleanup.

TOI-2 does not yet claim that unrelated runtime activity is isolated while a transaction is open.

## Acceptance criteria

- `runtime.transaction(...)` supplies a strongly typed `GraphTransaction` to its callback.
- `GraphTransaction` publicly exposes only typed `setContext(...)` and `publish(...)` operations.
- Transaction-owned context and event call sites use the handle.
- Existing staged context, staged event, commit, rollback, settlement, and overlapping-group behaviour remains unchanged.
- A handle cannot be used after its transaction group commits or rolls back.
- Closed-handle operations throw synchronously and produce no graph mutation, notification, scheduling, or event effect.
- Root and joined handles remain usable until shared group closure and close together.
- Public callback result inference and context/event typing remain intact.
- The complete repository validation suite passes after offline execution.
- Documentation clearly states that TOI-2 establishes ownership plumbing but does not complete isolation until later slices.

## Risks

### False sense of completion

Introducing a handle may appear to fix the defect while plain runtime operations are still interpreted through ambient transaction state. Status and documentation must keep the parent work item open.

### Handle retained beyond callback

The current joined-group model may leave a captured handle active after its callback returns but before group closure. The public contract should discourage retention, and the implementation must close all handles at group closure.

### Mechanical migration errors

Blind replacement may convert calls that were intended to remain immediate. Review transaction call sites individually.

### Public type leakage

Do not expose coordinator, group, staged-record, or notification-buffer contracts with the new handle.

### Behaviour drift

Do not combine TOI-2 with dispatch isolation, operation-guard removal, or conflict detection. Smaller slices make failures attributable and reviewable.

### Historical documentation churn

Do not rewrite historical implementation notes. Update maintained sources and add the new slice note.

## Exit condition

The runtime has an explicit, narrow, lifecycle-safe `GraphTransaction` capability, and all deliberate transaction-owned repository operations use it.

The parent Transaction Ownership Isolation work remains open until plain runtime operations are independent, dispatch isolation is complete, caller operation guards are corrected, and context conflicts are handled.

## Next task

Prepare the TOI-2 implementation with the smallest reasonable changes to transaction types, coordinator lifecycle, runtime composition, public exports, focused tests, and maintained documentation.
