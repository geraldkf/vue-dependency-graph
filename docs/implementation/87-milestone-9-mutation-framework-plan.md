# Milestone 9: Mutation Framework Plan

## Status

Prepared for review. Documentation only. No mutation runtime behaviour is implemented by this change.

## Objective

Add a small, typed mutation framework for remote commands that need coordinated local graph effects. The first release must support:

- remote mutation execution through an application-owned API client;
- optional optimistic updates to successful data-node values;
- automatic rollback for failures known not to have committed remotely;
- direct cache reconciliation from a successful response;
- invalidation after success;
- typed event publication after success;
- explicit handling for an unknown remote outcome;
- deterministic behaviour when optimistic writes overlap or race with graph work.

The milestone exit criterion remains: a failed optimistic appointment booking restores the previous local graph state when the failure is known to be rejected by the server.

## Existing foundation confirmed from the repository

Milestone 9 should extend the current runtime rather than introduce a second state or execution system:

- Data-node state, active attempts, generations, and immutable snapshots are owned by the runtime state store.
- Invalidation already advances generations, preserves successful data, aborts obsolete work, notifies once, and schedules subscribed stale work.
- Typed event matching already evaluates all predicates before graph mutation and can participate in atomic local commits.
- Transactions provide explicit atomic context and event staging. They deliberately do not model remote rollback.
- Refresh operations already provide caller-owned promises, generation protection, in-flight sharing, and stale-data retention.
- The notification buffer provides internal coalescing for a synchronous commit boundary, but it must not remain open while a remote request is pending.
- Refresh policies and the concurrency limiter govern data-node loads. Mutation commands are a separate resource class and must not silently consume data-load slots.

## Scope decisions

### One mutation definition, many executions

Mutation definitions are immutable typed handles declared at module scope. Runtime state belongs to each mutation execution, not to the definition.

Proposed shape:

```ts
const BookAppointment = defineMutation({
  key: "appointment.book",
  execute: ({ input, signal }: MutationExecuteContext<BookAppointmentInput>) =>
    appointmentsApi.book(input, signal),
});

const result = await runtime.mutate(BookAppointment, input, {
  optimistic: mutation => {
    mutation.update(Appointments, appointments => [
      ...appointments,
      createPendingAppointment(input),
    ]);
  },
  onSuccess: (mutation, response) => {
    mutation.update(Appointments, appointments =>
      replacePendingAppointment(appointments, input.clientId, response),
    );
    mutation.publish(AppointmentBooked, {
      jobSeekerId: response.jobSeekerId,
      appointmentId: response.appointmentId,
    });
  },
  onRejected: "rollback",
  onUnknown: "invalidate",
});
```

The exact generic spelling will be finalised in M9A. The behavioural boundary is fixed by this plan:

- `defineMutation(...)` owns identity and remote execution only.
- `runtime.mutate(...)` owns one execution and its local effects.
- Local effect callbacks receive a narrow capability. They do not receive the complete runtime.
- Mutation definitions do not become graph nodes and are not added to graph topology.

Keeping per-use reconciliation options on `mutate(...)` lets one remote command be reused by different page caches without placing application-specific node imports in a shared command contract. If repeated call-site configuration becomes a real problem, a higher-level application wrapper can be added outside core before increasing the framework API.

### Supported local effects

The first release supports these local effects:

- `update(dataNode, updater)` for direct writes to data nodes with an existing successful value;
- `invalidate(nodes)` for data and derived nodes;
- `publish(event, payload)` for typed event-driven invalidation.

Context nodes remain writable only through `setContext(...)` or `GraphTransaction.setContext(...)`. Derived nodes remain calculated values and cannot be updated directly.

An updater is synchronous and receives the current successful value. It must return the complete replacement value. Asynchronous callbacks, partial object patch syntax, path strings, and mutable draft proxies are out of scope.

### Successful-value requirement

An optimistic or reconciled direct update requires `hasSuccessfulValue === true`. The framework must not reinterpret a data node's placeholder `initialValue` as successfully loaded server state. Attempting to update a never-successful node fails before any mutation-owned local effect is applied.

Callers may use success invalidation instead when no successful cache value exists.

### Remote request ownership

A mutation request receives an attempt-scoped `AbortSignal`. It is caller-owned and returned directly from `runtime.mutate(...)` as a promise.

The first release does not add a global mutation concurrency limit, retry policy, deduplication, or automatic cancellation on component unmount. Those behaviours require domain-specific idempotency and outcome rules. Callers may pass their own signal if M9A confirms a clean composition model, but the runtime remains responsible for the signal supplied to `execute(...)`.

Mutation work does not use `maxConcurrentLoads`; that option remains specifically for `DataNodeDefinition.load()` calls.

## Failure classification and remote outcomes

### Why classification is required

A rejected business request and a lost response are not equivalent:

- A validation response can prove that the server rejected the command, so an optimistic local value can be rolled back safely.
- A timeout, disconnect, abort, or transport failure may occur after the server committed the command. Blind rollback can display a false negative and encourage a duplicate retry.

The framework must not infer remote atomicity from an arbitrary thrown error.

### Proposed classification

Optimistic mutations must classify execution failures as one of:

```ts
type MutationFailureKind = "rejected" | "unknown";
```

The call supplies a synchronous classifier:

```ts
classifyFailure: error =>
  isKnownRejectedResponse(error) ? "rejected" : "unknown"
```

Defaults:

- Non-optimistic mutation: preserve and rethrow the original error. No classification is required because there is no optimistic state to restore.
- Optimistic mutation without a classifier: treat the outcome as `unknown`. This is the safe default.
- `rejected`: restore eligible snapshots, then reject with the original error.
- `unknown`: do not restore potentially committed optimistic values. Mark affected nodes stale, apply configured invalidation, and reject with `GraphMutationOutcomeUnknownError` whose `cause` is the original error.

This milestone does not guess from HTTP status codes. API-specific classifiers belong to the application.

## Optimistic state and rollback model

### Snapshot contents

Before applying an optimistic write, capture the complete runtime state required to restore the data node:

- data;
- status;
- freshness;
- error;
- generation;
- hasSuccessfulValue.

Snapshots are runtime-internal and are not the diagnostic snapshots planned for Milestone 10.

### Atomic optimistic application

The optimistic callback first records intended updates in a private mutation draft. No runtime state changes while the callback is running.

After the callback returns successfully:

1. Validate all target handles and successful-value requirements.
2. Deduplicate targets by registered node key.
3. Reject duplicate writes to the same node within one callback to avoid order-dependent updates.
4. Confirm no target is owned by another unresolved optimistic mutation.
5. Capture rollback snapshots.
6. Apply every optimistic value synchronously.
7. Advance each changed target generation once.
8. Abort affected active attempts after generation advancement.
9. Notify once after all optimistic values are visible.

Optimistic writes are marked successful and fresh so subscription scheduling does not immediately replace them. They retain a private mutation ownership token until the mutation settles.

### Overlapping optimistic mutations

The first release rejects a second optimistic mutation that tries to update a data node already owned by another unresolved optimistic mutation. It throws `GraphMutationConflictError` before applying any local effect or starting the remote request.

This is intentionally conservative. A stack of composable optimistic layers would support overlap, but it would substantially increase complexity around ordering, refresh results, event invalidation, and rollback. It should be added only when a real workflow requires it.

Non-optimistic mutations may run concurrently. Optimistic mutations touching disjoint nodes may also run concurrently.

### External graph changes while optimistic work is pending

Context changes, events, refreshes, policy work, and plain runtime operations remain independent. They must not be held behind the remote request.

Every optimistic target records its post-write generation and ownership token. Safe rollback requires both to still match. If another graph operation has advanced the node generation or replaced mutation ownership:

- do not overwrite the newer state with the old snapshot;
- mark the node stale if needed;
- include the node key in a `GraphMutationRollbackConflictError`;
- preserve the original remote failure as `cause`;
- allow subscribed reconciliation through the existing scheduler.

This protects newer committed work from stale rollback. The simple no-race failure path still restores the exact previous snapshot and satisfies the milestone exit criterion.

## Successful completion model

### No optimistic update

After remote success, the success-effect callback records direct updates, invalidations, and event publications in a private draft. The callback is synchronous. If it throws or validation fails, no success effect is applied and `runtime.mutate(...)` rejects with that local error even though remote work may already have succeeded.

The documentation must call this an application reconciliation failure, not a remote rollback.

### Optimistic update

A successful mutation may:

- retain the optimistic value when no direct success update replaces it;
- replace it using response data;
- invalidate it for authoritative reload;
- publish typed events that invalidate other nodes.

At success settlement, remove optimistic ownership and apply all success effects through one synchronous local commit.

### Commit ordering

The proposed success commit order is:

1. Validate and resolve all direct data updates.
2. Evaluate event predicates against current committed graph values with the final direct-update values available through a private overlay where relevant.
3. Compute the union of explicit invalidation targets, event targets, and descendants.
4. Apply direct data updates.
5. Advance generations for updated or invalidated nodes once per node.
6. Apply invalidation state without overwriting direct success values for the same target.
7. Abort obsolete active attempts after generation changes.
8. Clear mutation ownership.
9. Notify once.
10. Request at most one scheduler pass for subscribed stale nodes.

M9D must define and test the exact overlap rule when a node is both directly updated and invalidated. The planned rule is that the direct response value is retained but marked stale, allowing immediate display followed by authoritative reload.

### Publication timing

Mutation events are published only after confirmed remote success. They are not emitted for optimistic application, known rejection, unknown outcome, or rollback.

If a domain needs an explicit attempted or failed event, the application can publish it separately. Milestone 9 does not introduce lifecycle event types automatically.

## Relationship to graph transactions

Graph transactions and mutations solve different problems:

- `runtime.transaction(...)` stages local context and event effects and commits them only after local callback success.
- `runtime.mutate(...)` may expose an optimistic local value before remote completion and later reconcile, invalidate, or roll it back.

A mutation must never keep a graph transaction or notification buffer open while awaiting the remote request.

Initial interaction rules:

- Plain `runtime.mutate(...)` remains an independent caller-owned operation while a graph transaction is open, consistent with `execute(...)`, `prefetch(...)`, and `refresh(...)`. It reads no staged transaction state and its result is not committed or discarded by that transaction.
- Calling `runtime.transaction(...)` while a mutation request is pending remains allowed as independent runtime work.
- Mutation effect callbacks receive only the mutation effect capability and cannot open transactions through that capability.
- Plain runtime context, event, execute, prefetch, and refresh calls remain independent while a mutation is pending.

These rules avoid implicit transaction membership and preserve the transaction ownership model established before Milestone 9.

## Runtime and source design

### Proposed files

```text
src/core/mutations/
  mutation.ts             immutable mutation definitions
  mutation-controller.ts  execution, optimistic ownership, settlement
  mutation-commit.ts      atomic local update/invalidation/event commit
  errors.ts               exported mutation error types
  types.ts                public and internal mutation contracts
```

`src/core/runtime.ts` remains the composition root and adds the mutation controller to `GraphRuntime`.

### Capability responsibilities

#### Mutation definition

Owns key validation, immutability, input/result typing, and the remote execute function. It owns no runtime state.

#### Mutation controller

Owns execution identity, abort signal, optimistic target ownership, snapshot lifetime, failure classification, request settlement, and cleanup.

It does not own graph traversal, event candidate indexing, scheduler state, or observer storage.

#### Mutation commit capability

Owns mutation-local draft validation and one synchronous state commit containing direct data updates, explicit invalidation, and event effects. It should reuse existing descendant collection and event matching helpers rather than copy those algorithms.

#### State store

Remains the source of committed node state and active attempts. It may gain narrow snapshot and token-safe mutation ownership operations. Mutation policy should not be embedded in the general state store.

#### Invalidation and event matching

Expose narrow reusable planning helpers if needed. They must retain their existing public behaviour. Avoid calling `runtime.publish(...)` or `runtime.refresh(...)` repeatedly from the mutation controller because that would create multiple commits and notifications.

#### Scheduler and refresh policy controller

Receive at most one scheduling request after a mutation commit. Existing policy timers must observe the resulting node generation and state normally. Mutation execution itself does not become scheduler or policy work.

## Public API direction

M9A should validate this provisional API with compile-time tests before runtime implementation:

```ts
interface MutationDefinition<TInput, TResult> {
  readonly key: string;
  readonly execute: (
    context: MutationExecuteContext<TInput>,
  ) => Promise<TResult>;
}

interface MutationExecuteContext<TInput> {
  readonly input: TInput;
  readonly signal: AbortSignal;
}

interface MutationOptions<TInput, TResult> {
  readonly optimistic?: (
    effects: MutationUpdateEffects,
    input: TInput,
  ) => void;
  readonly onSuccess?: (
    effects: MutationSuccessEffects,
    result: TResult,
    input: TInput,
  ) => void;
  readonly classifyFailure?: (
    error: unknown,
  ) => MutationFailureKind;
}

runtime.mutate(definition, input, options?): Promise<TResult>;
```

The effect interfaces should expose typed methods rather than one broad callback context. `update(...)` accepts data nodes only, `invalidate(...)` accepts data and derived nodes, and `publish(...)` retains event payload typing.

M9A may adjust parameter order or type aliases when compile-time tests expose an inference problem. It must not weaken typing with `any`, string node keys, or untyped payloads.

## Error model

Proposed exported errors:

- `GraphMutationConflictError`: an optimistic target is already owned by unresolved optimistic work.
- `GraphMutationOutcomeUnknownError`: remote completion cannot be determined safely; optimistic state is retained and reconciliation is requested.
- `GraphMutationRollbackConflictError`: a known rejection occurred, but newer graph work prevents safe restoration of one or more snapshots.
- `GraphMutationStateError`: a direct mutation update targets a node without a successful value or uses an invalid target kind.

Normal known rejection should preserve the application's original error after successful rollback. Framework errors should expose immutable, deterministically sorted node keys where applicable and use `cause` for the original error.

## Pre-implementation maintenance decisions

A source review identified several possible consolidations around refresh policies, state transitions, active attempts, transactions, graph traversal, execution, and Vue result mapping. Milestone 9 will apply only changes that are directly required by mutation behaviour or are safe within an already-touched code path.

### Changes that may be made opportunistically

#### Reuse semantic invalidation planning

M9B and M9C may extract a narrow internal invalidation planning or commit helper when mutation success effects need to combine direct updates, explicit invalidation, typed event invalidation, descendant deduplication, generation advancement, abort ordering, notification, and scheduling.

The helper must remain owned by the capability that understands the transition. Do not move a generic `markStale(...)` operation into the runtime state store. The state store remains storage and snapshot infrastructure rather than the owner of invalidation policy.

#### Narrow active-attempt access only when required

M9B and M9D should review the active-attempt boundary when mutation commits first need to obsolete existing loads or protect rollback ownership. Prefer the smallest change supported by that use case, such as snapshot iteration or a narrow visitor, rather than moving subscription or cancellation policy into the state store.

Do not redesign active-attempt storage during M9A. Do not expose mutation ownership through the public runtime state.

#### Use index-based graph traversal in touched loops

If Milestone 9 modifies an existing breadth-first traversal that currently removes the first array element repeatedly, it may replace that loop with an index-based queue while preserving deterministic order and existing descendant or ancestor behaviour.

This is not a standalone milestone task and must not broaden a slice that otherwise does not touch the traversal.

#### Clarify refresh timer operations only if touched

If a required Milestone 9 integration change touches refresh-policy timer cancellation, replace ambiguous boolean call sites such as `clearTimer(session, preserveRemaining)` with intention-revealing operations such as normal timer clearing and timer suspension.

Milestone 9 is not expected to require this. Any such change must retain focused pause, resume, remaining-delay, timeout, token, and stale-callback coverage.

#### Add local rationale comments when editing forward declarations

If Milestone 9 necessarily edits a file containing an unexplained forward declaration, a concise rationale comment may be added. Do not introduce factories or indirection only to remove a harmless forward declaration.

### Changes explicitly deferred

The following are not Milestone 9 prerequisites and must not be included without concrete implementation evidence:

- splitting the refresh-policy controller into policy strategy modules;
- centralising all node-kind predicates into one generic guards module;
- moving stale-state transition policy into the runtime state store;
- moving final-unsubscribe cancellation policy into the runtime state store;
- merging transaction-coordinator and notification-buffer depth tracking;
- refactoring the data-node execution lifecycle into speculative helper layers;
- extracting a Vue node-result mapper before a third real consumer exists;
- removing defensive query runtime checks solely because typed callers cannot trigger them;
- adding transaction identifiers before structured diagnostics require them;
- adding `GraphTransaction.rollback()` or another transaction cancellation API for mutation rollback.

Optimistic mutation rollback remains owned by the mutation controller. It restores guarded snapshots after a known remote rejection and is not implemented by holding or cancelling a graph transaction.

Transaction correlation identifiers belong with Milestone 10 diagnostics. If required there, prefer deterministic runtime-local group identifiers for tests and snapshots, with externally unique ID generation supplied through a diagnostics environment only when a real telemetry requirement exists.

## Implementation sequence

### M9A: Mutation definitions and public typing

Status: Implementation prepared. Offline validation pending. See `docs/implementation/88-milestone-9a-mutation-definitions-execution-note.md`.

- Add immutable `defineMutation(...)` definitions.
- Add input and result inference.
- Add `runtime.mutate(definition, input)` without local graph effects.
- Validate blank keys and malformed definitions.
- Add compile-time tests for input and result typing.
- Add a basic remote success and rejection execution path.
- Confirm plain mutation execution remains independent while a graph transaction is open.

Typed data-node updates, invalidation targets, and event payloads move to M9B and M9C, where the corresponding effect APIs and runtime behaviour are introduced together.

Exit condition: a typed command can execute and return its typed result without changing graph state.

### M9B: Atomic direct cache reconciliation

Status: Implementation prepared. Offline validation pending. See `docs/implementation/89-milestone-9b-atomic-cache-reconciliation-note.md`.

- Add mutation success-effect drafts.
- Support synchronous `onSuccess` direct updates for successful data nodes.
- Validate every target, duplicate key, successful-value requirement, and updater before state mutation.
- Apply multi-node results atomically with one notification.
- Advance changed generations once and abort obsolete active attempts after generation advancement.
- Invalidate changed-result descendants once across all updated roots and schedule subscribed stale descendants through the existing scheduler.
- Treat an equal value on an already successful fresh node as a silent no-op.
- Reject asynchronous success callbacks and asynchronous updater results.
- Cover updater exceptions and local reconciliation failure after remote success.

Exit condition prepared: a successful command can reconcile multiple cached data nodes without intermediate observer state, while dependent graph state becomes stale and reloads through existing subscription scheduling.

### M9C: Success invalidation and typed event publication

Status: Implementation prepared. Offline validation pending. See `docs/implementation/90-milestone-9c-success-invalidation-events-note.md`.

- Add explicit `effects.invalidate(...)` for data and derived nodes.
- Add typed `effects.publish(...)` for success-only event publication.
- Reuse the graph event index and predicate matching with final direct-update values available through an overlay.
- Validate and match every success effect before graph mutation.
- Combine direct updates, explicit invalidation, event invalidation, changed-result descendants, generation advancement, and abort ordering into one commit.
- Deduplicate converging roots and descendants and request at most one scheduler pass.
- Retain a direct response value but mark it stale when the same node is explicitly or event-invalidated.
- Publish no mutation effects when remote execution rejects.

Exit condition prepared: confirmed remote success can update immediate UI state and trigger authoritative cross-domain reload through existing graph mechanisms without partial observer state.

### M9D: Optimistic apply and known-rejection rollback

Status: Implementation prepared. Offline validation pending. See `docs/implementation/91-milestone-9d-optimistic-rollback-note.md`.

- Add staged synchronous optimistic update planning.
- Validate every optimistic target and updater before request execution.
- Capture complete rollback snapshots for optimistic targets and affected descendants.
- Apply multi-node optimistic values atomically and invalidate descendants through the existing graph path.
- Add per-node optimistic ownership and reject same-node overlap before the second request starts.
- Restore complete snapshots atomically for a failure classified as `rejected`.
- Preserve the original remote rejection after successful rollback.
- Ensure success clears ownership and applies reconciliation without a transient rollback.
- Reject optimistic updates for never-successful data nodes before request execution.
- Retain optimistic state for an unclassified or `unknown` outcome pending M9E stale reconciliation and framework error handling.

Exit condition prepared: a known-rejected optimistic appointment booking restores the exact prior local target and descendant state in the no-race path.

### M9E: Concurrency, races, and unknown outcomes

Status: Implementation prepared. Offline validation pending. See `docs/implementation/92-milestone-9e-concurrency-outcomes-note.md`.

- Reject overlapping optimistic ownership for the same node before remote execution.
- Allow disjoint optimistic mutations and concurrent non-optimistic mutations.
- Protect rollback with optimistic ownership and expected-generation checks across targets and captured descendants.
- Add `GraphMutationOutcomeUnknownError` and `GraphMutationRollbackConflictError` with immutable sorted node keys and original causes.
- Retain optimistic values for unknown outcomes, mark all affected nodes stale, abort obsolete work, and schedule subscribed reconciliation.
- Treat classifier exceptions and unsupported runtime results as unknown rather than proof of rejection.
- Preserve newer graph values when context, event, refresh, polling, or independent mutation work prevents safe rollback.
- Confirm plain transactions and other runtime operations remain independent while mutation work is pending.

Exit condition prepared: mutation failure handling never overwrites newer committed graph work or falsely claims that an ambiguous remote command was rolled back.

### M9F: Vue-facing usage and deterministic playground

Status: Implementation prepared. Offline validation pending. See `docs/implementation/93-milestone-9f-vue-playground-note.md`.

- Add an Optimistic Appointment Booking scenario using the existing Pinia-owned runtime.
- Show ready, submitting, optimistic, confirmed, rejected-and-rolled-back, and unknown-outcome states.
- Provide deterministic controls for starting, confirming, rejecting, making the outcome unknown, demonstrating same-node overlap, and resetting.
- Show appointment values, node status and freshness, request count, capability status, and mutation outcome.
- Demonstrate event-driven capability-status invalidation and reload after confirmed success.
- Add Vue Testing Library behaviour coverage for optimistic visibility, confirmation, rollback, unknown reconciliation, overlap rejection, reset, and unmount.
- Release pending scenario work on reset and unmount without claiming that the remote request was safely cancelled.

No mutation composable was added. The scenario keeps request lifecycle state application-local and calls the Pinia-owned runtime directly; no repeated framework-level lifecycle abstraction was revealed.

Exit condition prepared: the playground visibly demonstrates optimistic display, confirmed reconciliation, safe rollback, ambiguous-outcome handling, and overlap protection.

### M9G: Documentation, migration guidance, and validation

Status: Documentation and migration guidance complete. Full dependency-backed validation and manual browser verification remain pending on the combined checkout.

- Reconciled the public API, architecture, ADR, roadmap, playground, and test strategy.
- Added application guidance for known rejection versus unknown outcome.
- Added idempotency-key and authoritative-reload guidance without implementing transport policy.
- Recorded only validation results actually observed.
- Retained the local validation commands and manual playground checklist required for milestone closure.

Exit condition partially met: maintained documentation describes implemented mutation behaviour and limitations. Milestone 9 must not be marked fully validated until the dependency-backed commands and manual playground paths below pass.

## Behavioural test plan

### Definitions and basic execution

- immutable definition and blank-key rejection;
- typed input and result;
- one execute call per mutate call;
- success returns the remote result;
- rejection preserves the original error for non-optimistic work;
- execute receives the exact input and a signal;
- runtime isolation between two runtimes sharing one definition.

### Direct reconciliation

- one and multiple data-node updates;
- atomic observer view across multiple nodes;
- data-node-only update restriction;
- never-successful target rejection;
- updater exception before mutation;
- generation advancement and active-attempt obsolescence;
- unrelated state remains unchanged.

### Invalidation and events

- explicit target and descendant invalidation;
- matching and non-matching typed event predicates;
- event predicate failure before mutation;
- direct update plus event invalidation deduplication;
- one notification and at most one scheduler pass;
- stale successful data retention;
- subscribed and unsubscribed target behaviour.

### Optimistic lifecycle

- optimistic value visible before remote settlement;
- multi-node optimistic application is atomic;
- known rejection restores exact snapshots;
- success does not transiently restore snapshots;
- success response replaces a temporary value;
- success invalidation retains the response value as stale;
- never-successful target fails before request start;
- optimistic callback failure starts no request and changes no state.

### Concurrency and races

- same-node optimistic overlap rejected before second request start;
- disjoint optimistic mutations proceed independently;
- non-optimistic mutations remain concurrent;
- external generation change prevents stale rollback;
- active attempt is aborted only after optimistic generation advancement;
- ignored-abort result cannot overwrite optimistic or reconciled data;
- context and event operations remain immediate while a mutation is pending;
- transaction calls remain independent;
- plain mutate calls remain independent while a graph transaction is open and cannot see staged transaction state;

### Unknown outcomes

- missing classifier defaults to unknown for optimistic work;
- unknown retains optimistic data;
- unknown marks affected nodes stale and schedules subscribed reconciliation;
- unknown error preserves the original cause;
- known rejection uses automatic rollback;
- rollback conflict reports sorted immutable node keys and preserves newer state.

### Regression coverage

The complete graph, execution, transaction, event, query, refresh-policy, Vue, Pinia, and playground suites must remain green. Tests should use deferred promises and deterministic environments, not real delays.

## Playground scenario

Add **Optimistic Appointment Booking** with:

- a job seeker context;
- an appointments data node with an existing successful list;
- a capability-status node invalidated by `AppointmentBooked`;
- a typed booking mutation;
- a client-generated temporary appointment identifier;
- controls to start, confirm, reject, or make the result unknown;
- committed request and reload counters;
- current node status and freshness;
- outcome and error display;
- reset and tab-switch cleanup.

Manual paths:

1. Start a booking and confirm the temporary appointment appears before completion.
2. Confirm success replaces the temporary record and publishes `AppointmentBooked` once.
3. Confirm capability status reloads only after success.
4. Start another booking and choose known rejection.
5. Confirm the previous appointment snapshot is restored with no success event.
6. Start another booking and choose unknown outcome.
7. Confirm the optimistic value is not falsely rolled back, the node becomes stale, and reconciliation is requested.
8. Attempt overlapping optimistic booking for the same appointments node and confirm the second request does not start.
9. Reset and confirm timers, pending gates, counters, outcomes, and subscriptions return to their initial state.
10. Switch tabs with a request pending and confirm no post-unmount Vue warning appears.

## Documentation changes required at completion

- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/decisions/ADR-013-mutation-framework.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/testing/01-test-strategy.md`
- `docs/PLAYGROUND.md`
- a final Milestone 9 implementation summary and validation handoff

## Explicit non-goals

Milestone 9 does not add:

- a general command bus;
- backend transaction rollback;
- automatic HTTP status interpretation;
- mutation retry or offline queues;
- mutation deduplication or idempotency-key generation;
- global mutation concurrency control;
- overlapping optimistic layers for one node;
- direct context or derived-node writes;
- mutable draft proxies or path-based patches;
- mutation persistence across reloads;
- cross-tab coordination;
- automatic lifecycle events;
- structured mutation diagnostics or devtools views;
- a Vue mutation composable without demonstrated need.

## Risks to preserve during implementation

### False rollback

A transport failure does not prove server rejection. Unknown outcomes must never be presented as successfully rolled back.

### Snapshot clobbering

A rollback snapshot must not overwrite newer graph work. Ownership and generation checks are mandatory.

### Partial local commits

Updater, target, and event predicate validation must complete before mutation. Multi-node effects must not expose intermediate observer state.

### Hidden loading loops

An optimistic value should not be marked stale automatically. Invalidation happens only through explicit success or unknown-outcome policy.

### Remote success followed by local failure

A success-effect callback can fail after the server committed. The framework must report a reconciliation failure and must not imply remote rollback.

### Scope creep

Mutation state, forms, transport clients, retries, notifications, and API-specific error mapping remain application responsibilities unless a later concrete use case justifies framework support.

## Validation contract

For every implementation slice, run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

For M9F and M9G, also run the playground and complete every Optimistic Appointment Booking manual path.

Do not mark a slice validated until the project owner reports successful results against the combined checkout.

## Assumptions and review questions

This plan makes the following decisions so implementation can proceed without blocking questions:

- Direct updates target successful data nodes only.
- The safe default for an unclassified optimistic failure is unknown, not rollback.
- Same-node optimistic overlap is rejected rather than layered.
- Mutation execution does not consume data-load concurrency slots.
- Mutation callbacks are synchronous and use narrow effect capabilities.
- A Vue-specific mutation composable is deferred until demonstrated necessary.

M9A finalised the generic parameter and callback ordering. Compile-time tests now preserve that public contract alongside the behavioural decisions above.

## Next task

Run the complete dependency-backed validation and manual playground checklist. If all results pass, update the roadmap and milestone status from validation pending to complete. Otherwise fix only the observed failures before starting Milestone 10.
