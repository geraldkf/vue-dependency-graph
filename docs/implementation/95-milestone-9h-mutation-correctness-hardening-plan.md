# Milestone 9H: Mutation Correctness Hardening Plan

## Status

Implemented through M9H-G6. Static validation is complete; the final dependency-backed type check, full test suite, and production build remain the completion gate.

## Purpose

Milestone 9 is functionally complete, but the post-implementation review identified correctness and contract gaps that should be resolved before Milestone 10 observability work begins.

M9H hardens the existing mutation framework without redesigning its public API. It preserves the current graph, invalidation, scheduler, event, transaction, refresh-policy, Pinia, and Vue ownership models.

## Confirmed decisions

### Optimistic data descendants reload before remote settlement

When an optimistic data-node value changes:

- affected derived descendants may recompute immediately;
- affected subscribed data descendants may reload immediately;
- descendant loading continues to use the normal data-load concurrency limit;
- the mutation request remains outside that limit;
- descendant completion may prevent exact rollback by advancing a captured generation;
- rollback conflict handling must preserve the newer result rather than restore an obsolete snapshot.

This is intentional normal graph scheduling, not a special mutation execution path.

### Mutation event predicates cannot read affected derived values

A mutation success event predicate may read:

- direct data-node values provided through the success-draft overlay;
- unaffected committed context values;
- unaffected successful data values;
- unaffected derived values.

It may not read a derived dependency affected by direct updates or explicit invalidation in the same mutation success draft. The runtime must reject the local success reconciliation before any success effect commits instead of evaluating the predicate against an obsolete derived value.

Normal runtime event publication and transaction event publication retain their existing behaviour.

## Non-goals

M9H does not add:

- mutation retry policy;
- idempotency-key generation or persistence;
- offline command queues;
- layered optimistic writes to one node;
- automatic Vue unmount cancellation;
- global mutation concurrency limits;
- mutation persistence;
- a generic Vue mutation composable;
- diagnostics or devtools UI;
- public mutation attempt handles.

Those remain future, evidence-driven decisions.

## M9H-A: Monotonic rollback generations

Status: Implemented. Offline validation pending. See `docs/implementation/96-milestone-9h-a-monotonic-rollback-generations-note.md`.

### Problem

The optimistic rollback snapshot currently contains the pre-optimistic generation. Restoring that generation can create an ABA race:

1. active work starts at generation `n`;
2. optimistic application advances the node to `n + 1` and aborts the work;
3. known rejection restores the snapshot generation to `n`;
4. work that ignored abort completes and may again appear current.

Generation values are runtime versions and must never decrease.

### Required behaviour

A successful rollback restores the previous logical state but creates a new graph generation.

Restore:

- data;
- status;
- freshness;
- error;
- successful-value history.

Do not restore the snapshot generation. Assign a generation greater than the current optimistic generation.

### Commit ordering

1. Validate optimistic ownership for every effective target.
2. Validate expected generations for every captured target and descendant.
3. Prepare the complete rollback commit.
4. Restore visible snapshot fields.
5. Advance every restored node to a new generation.
6. Abort active work associated with older generations.
7. Release optimistic ownership.
8. Emit one notification.
9. Request one scheduler pass when restored state contains subscribed stale nodes.

### Tests

Add behaviour coverage for:

- rollback generation exceeds the optimistic generation;
- target and descendant generations remain monotonic;
- a pre-optimistic loader ignores abort and completes after rollback;
- the obsolete completion cannot overwrite restored state;
- multi-node rollback advances each restored node once;
- visible snapshot fields are restored even though generation changes.

### Exit condition

Rollback restores logical state without making any obsolete attempt current again.

## M9H-B: Pure updater contract and mutation protection

Status: Implemented. Offline validation pending. See `docs/implementation/97-milestone-9h-b-pure-updater-guard-note.md`.

### Problem

Mutation updaters currently receive the graph-owned value reference. In-place mutation can leak during draft preparation:

```ts
effects.update(Appointments, current => {
  current.push(pendingAppointment);
  return current;
});
```

This can bypass change detection, notification, generation advancement, atomic failure handling, and rollback snapshot correctness.

### Contract

Mutation updater functions are pure replacement functions.

They must:

- treat `current` as read-only;
- return a replacement value;
- avoid modifying nested values reachable from `current`;
- avoid side effects that mutate graph-owned data.

### Implementation approach

Add a development and test guard for plain arrays and plain objects.

The guard must:

- protect the value passed to the updater rather than freezing the committed runtime value;
- detect direct and nested writes for supported plain values;
- throw `GraphMutationStateError` during preparation;
- leave graph state, ownership, generations, notifications, and scheduling unchanged;
- avoid production deep-clone or deep-compare overhead;
- document behaviour for non-plain values.

Do not introduce unconditional deep cloning in production. It would alter reference semantics, add hidden cost, and fail for some domain values.

### Tests

Add behaviour coverage for:

- immutable array replacement;
- immutable object replacement;
- direct array mutation rejection;
- direct object-property mutation rejection;
- nested plain-object mutation rejection;
- one updater mutating in place before a later updater throws;
- optimistic in-place mutation applying no value or ownership;
- success reconciliation in-place mutation applying no partial effect;
- documented non-plain value behaviour.

### Exit condition

Failed mutation preparation cannot mutate graph-owned plain arrays or plain objects.

## M9H-C: Remote success with local reconciliation failure

Status: Implemented. Offline validation pending. See `docs/implementation/98-milestone-9h-c-reconciliation-failure-recovery-note.md`.

### Problem

An optimistic mutation can succeed remotely and then fail locally while preparing `onSuccess`. The optimistic projection may remain marked fresh even though the response was not reconciled.

This is not a remote rejection and must not trigger snapshot rollback.

### Required behaviour

When remote execution succeeds but success reconciliation fails:

1. retain currently visible optimistic values;
2. mark optimistic targets and affected descendants stale;
3. advance affected generations;
4. abort obsolete active work;
5. release optimistic ownership;
6. emit one notification;
7. request at most one scheduler pass for subscribed stale nodes;
8. reject with a dedicated reconciliation error preserving the local cause.

### Error contract

Add:

```ts
GraphMutationReconciliationError
```

It should expose:

```ts
readonly mutationKey: string;
readonly nodeKeys: readonly string[];
readonly cause: unknown;
readonly remoteSucceeded: true;
```

`nodeKeys` must be immutable, unique, and sorted.

### Covered local failures

The recovery path must apply when remote success is followed by:

- `onSuccess` throwing;
- direct updater failure;
- invalid success target;
- event predicate failure;
- prohibited affected-derived predicate read;
- Promise-like success callback;
- Promise-like updater result;
- success-draft validation failure.

### Tests

Verify that:

- optimistic values remain visible;
- optimistic values are stale rather than fresh;
- descendants are stale;
- ownership is released;
- a later optimistic mutation can target the same node;
- subscribed nodes reload authoritatively;
- recovery emits one coherent notification;
- no success update, explicit invalidation, or event publication partially commits;
- the error records remote success and preserves the local cause.

### Exit condition

Remote success followed by local reconciliation failure never leaves an unreconciled optimistic projection marked authoritative and fresh.

## M9H-D: Scheduler recovery after rollback

Status: Implemented. Offline validation pending. See `docs/implementation/99-milestone-9h-d-rollback-scheduler-recovery-note.md`.

### Problem

A successful rollback may restore a snapshot that was already stale and subscribed. Notification alone does not guarantee that the restored stale state reloads.

### Required behaviour

Provide the mutation controller with the existing subscription query:

```ts
hasSubscribers(node)
```

After successful rollback, request one scheduler pass when at least one restored snapshot is stale and subscribed.

Do not schedule when:

- every restored node is fresh;
- stale restored nodes are unsubscribed;
- no effective optimistic state was applied;
- rollback conflict reconciliation already requested scheduling.

### Tests

Add coverage for:

- one stale subscribed snapshot;
- one fresh subscribed snapshot;
- one stale unsubscribed snapshot;
- multiple stale subscribed snapshots scheduling once;
- shared stale ancestors and descendants scheduling once;
- `whenSettled()` waiting for rollback-triggered scheduler work.

### Exit condition

Rollback follows the same subscribed-stale recovery rule as other graph invalidation paths.

## M9H-E: Immediate optimistic descendant loading

Status: Implemented. Offline validation pending. See `docs/implementation/100-milestone-9h-e-optimistic-descendant-loading-note.md`.

### Required behaviour

Preserve the current behaviour deliberately:

- optimistic target changes invalidate descendants immediately;
- subscribed derived descendants may recompute immediately;
- subscribed data descendants may reload before remote mutation settlement;
- mutation and descendant work remain independent;
- data descendants continue to use the data-load concurrency limiter;
- mutation execution remains outside that limiter;
- descendant completion can create a guarded rollback conflict.

### Tests

#### Data descendant settles before mutation success

Verify that the optimistic parent changes, the subscribed data descendant reloads, the descendant commits, and later mutation success does not corrupt that state.

#### Data descendant settles before known rejection

Verify that the descendant generation change prevents snapshot restoration, the newer value is preserved, `GraphMutationRollbackConflictError` identifies the changed descendant, and authoritative reconciliation remains scheduled.

#### Data descendant remains active at settlement

Verify that settlement advances generations before abort and an ignored-abort completion cannot overwrite post-settlement state.

#### Mutation and load concurrency remain independent

With `maxConcurrentLoads: 1`, verify that a full data-load slot does not prevent the mutation request from starting and that the descendant reload still waits under the normal load limiter.

### Exit condition

Immediate optimistic descendant loading is explicit, deterministic, and protected by generations and rollback conflicts.

## M9H-F: Prohibit affected-derived reads in mutation event predicates

Status: Implemented. Offline validation pending. See `docs/implementation/101-milestone-9h-f-derived-event-predicate-restriction-note.md`.

### Problem

Mutation event predicates currently receive final direct-update values through an overlay. A predicate reading a derived node affected by the same success draft would otherwise see the previous committed derived value.

### Required preparation sequence

1. Collect direct update drafts.
2. Collect explicit invalidation roots.
3. Collect event publications.
4. Validate targets and evaluate update replacements.
5. Compute a preliminary affected set from effective direct updates, explicit invalidation roots, and their descendants.
6. Collect affected derived-node keys.
7. Match event publications using direct data update overlays and the prohibited derived-key set.
8. Reject if a predicate reads a prohibited derived dependency.
9. Add valid event targets to the final invalidation plan.
10. Commit all success effects once.

### Shared event matcher extension

Extend event matching with optional matching options rather than embedding mutation policy in the event subsystem:

```ts
interface EventMatchOptions {
  readonly valueOverlay?: readonly EventValueOverlay[];
  readonly prohibitedDependencyKeys?: ReadonlySet<string>;
}
```

Normal runtime publication uses no options.

Transaction publication supplies staged context values through `valueOverlay`.

Mutation publication supplies final direct data values and affected derived keys.

The shared matcher should report a generic prohibited dependency read. The mutation controller should convert it to `GraphMutationReconciliationError` through the local reconciliation-failure path.

### Allowed cases

- an unaffected derived dependency;
- a directly updated data dependency through the overlay;
- an unaffected successful data dependency;
- a committed context dependency;
- normal runtime event predicates;
- transaction event predicates.

### Tests

Add coverage for:

- rejection of an affected derived dependency read;
- no partial direct update;
- no partial explicit invalidation;
- no partial event invalidation;
- no preparation notification;
- optimistic recovery becoming stale after remote success;
- unaffected derived dependencies remaining readable;
- directly updated data dependencies receiving overlay values;
- unchanged normal runtime event behaviour;
- unchanged transaction event behaviour;
- valid multiple-event ordering.

### Exit condition

A mutation success predicate never decides against a derived value invalidated by the same draft.

## M9H-G: Internal mutation-controller decomposition

### Purpose

The current controller owns update planning, ownership, snapshotting, optimistic commit, success commit, rollback, conflict handling, unknown outcomes, notifications, and scheduling. M10 observability should instrument explicit lifecycle transitions rather than scattered branches.

### Refactor timing

Perform this extraction only after M9H-A through M9H-F tests pass. Keep it mechanical and internal.

The full staged decomposition is specified in `docs/implementation/102-milestone-9h-g-full-mutation-decomposition-plan.md`. Implement it as M9H-G0 through M9H-G6, with a passing cumulative package after every step.

### Candidate internal modules

#### `mutation-update-planner.ts`

- collect update drafts;
- validate registered data targets;
- evaluate protected replacement functions;
- reject asynchronous callbacks and updater results.

#### `optimistic-session.ts`

- ownership acquisition and release;
- snapshot capture;
- expected generations;
- rollback validation.

#### `mutation-commit.ts`

- direct value commit;
- invalidation commit;
- monotonic generation advancement;
- abort ordering;
- notification and scheduler decision.

#### `mutation-settlement.ts`

- confirmed success;
- known rejection;
- unknown outcome;
- reconciliation failure;
- rollback conflict.

Do not add public abstractions or interfaces only to reduce file length.

### Exit condition

M10 can observe a small, explicit set of mutation lifecycle transitions without changing M9H behaviour.

## Implementation order

### Step 1: Add failing behavioural tests

Add tests for:

- rollback generation ABA;
- in-place updater mutation;
- remote success with local reconciliation failure;
- rollback scheduler recovery;
- immediate data-descendant loading;
- affected-derived event predicate rejection.

Do not refactor production code first.

### Step 2: Implement rollback correctness

Implement M9H-A and M9H-D together because both change rollback commit ordering.

### Step 3: Implement reconciliation-failure recovery

Implement M9H-C using the existing combined invalidation, generation, abort, notification, and scheduler paths.

### Step 4: Implement updater protection

Implement M9H-B with the smallest development and test guard that protects plain arrays and plain objects.

### Step 5: Implement event predicate restrictions

Implement M9H-F with optional event matcher restrictions and preserve non-mutation callers.

### Step 6: Confirm immediate descendant scheduling

Implement M9H-E tests and documentation. Change production scheduling only if tests reveal a mismatch with the confirmed behaviour.

### Step 7: Decompose the controller

Perform M9H-G after behaviour is green. Keep changes mechanical and verify no public API or runtime behaviour changes.

### Step 8: Validate the combined checkout

Run:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Then rerun all Optimistic Appointment Booking manual paths.

## Complete behavioural test matrix

M9H must add or confirm coverage for:

- monotonic generations across optimistic apply, rollback, conflict, unknown outcome, and reconciliation failure;
- ignored-abort completion before and after settlement;
- multi-node atomic rollback;
- pure updater enforcement;
- no state leakage during failed preparation;
- remote-success local-failure recovery;
- ownership release on every settlement path;
- rollback scheduling for stale subscribed snapshots;
- immediate derived and data descendant work;
- data-load limiter independence from mutation execution;
- affected-derived event predicate rejection;
- unaffected predicate compatibility;
- runtime event compatibility;
- transaction event compatibility;
- runtime isolation for ownership and attempts.

## Documentation updates required during implementation

When M9H implementation is complete, update:

- `docs/api/01-public-api.md`;
- `docs/architecture/05-mutations-failures-and-cache.md`;
- `docs/decisions/ADR-013-mutation-framework.md`;
- `docs/guides/04-mutation-adoption.md`;
- `docs/testing/01-test-strategy.md`;
- `docs/implementation/01-roadmap.md`;
- the M9H implementation and validation note;
- the root README milestone status.

Document explicitly:

- updater purity and immutability requirements;
- monotonic rollback generation behaviour;
- immediate optimistic descendant scheduling;
- remote-success reconciliation failure;
- the affected-derived event predicate restriction;
- why unknown outcomes and rollback conflicts remain authoritative-reload paths.

## M9H exit criteria

M9H is complete when:

- generations never decrease;
- ignored-abort work cannot become current after rollback;
- updater preparation cannot mutate graph-owned plain arrays or plain objects;
- remote success plus local reconciliation failure produces stale recoverable state;
- rollback restores stale subscribed state and schedules recovery;
- optimistic data descendants reload before settlement through normal scheduling;
- descendant races are protected by generation checks and rollback conflicts;
- mutation event predicates cannot read affected derived values;
- normal runtime and transaction event publication remain backward compatible;
- existing M9A through M9G behaviour remains green;
- M10 has explicit mutation lifecycle transition points to instrument;
- full automated and manual validation passes against the combined checkout.

## Next task

Complete the dependency-backed M9H-G6 validation gate before starting Milestone 10 observability.
