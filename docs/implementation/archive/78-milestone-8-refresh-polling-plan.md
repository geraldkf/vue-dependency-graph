## Milestone 8: Refresh Policies and Polling Plan

> **Historical implementation record:** This document describes the design at the time of its milestone. The current transaction contract uses independent top-level sessions, explicit `transaction.transaction(...)` composition, direct notification and scheduler dispatch, and scheduler-specific `runtime.whenSettled()`. See `docs/decisions/ADR-005-atomic-graph-transactions.md` and `docs/implementation/114-transaction-overlap-isolation-plan.md`.

### Status

Planned and ready for review. This task changes documentation only. No runtime behaviour or public API is implemented yet.

### Objective

Milestone 8 adds subscription-aware automatic refresh policies for data nodes. It must support time-based staleness, fixed-interval refresh, poll-until workflows, timeout, bounded retry with backoff and jitter, and pause/resume integration without creating overlapping requests or leaked timers.

The milestone exit criterion is:

> A long-running operation progresses to completion without overlapping requests or leaked timers.

The implementation must reuse the existing graph runtime, refresh preparation, execution controller, generation protection, concurrency limiter, subscriptions, notification model, and Vue scope cleanup. It must not introduce a second cache, scheduler, execution engine, or polling-specific data channel.

### Current foundation confirmed from source

Milestone 8 builds on these existing behaviours:

- Data-node loaders already receive an attempt-scoped `AbortSignal`.
- `runtime.refresh(...)` preserves successful data, advances generations, aborts superseded attempts, and reuses the single execution controller.
- Active attempts record execution ownership so compatible work can be shared and automatic work can be cancelled safely.
- Subscription totals already distinguish whether a node is currently required by a consumer.
- The runtime-wide FIFO concurrency limiter applies to all data-node loads.
- Generation and attempt-token checks prevent late ignored-abort results from committing.
- `whenSettled()` currently describes the automatic dependency scheduler only.
- Vue composables create subscriptions in an active effect scope and release them on disposal.
- Graph definitions are immutable and may be shared by independent runtime instances.

Refresh-policy state must therefore belong to each `GraphRuntime`, not to immutable node definitions or Pinia.

### Scope and terminology

A **refresh policy** is immutable metadata declared on a data-node definition. A runtime interprets that metadata while the node is subscribed.

A **policy session** is runtime-local state for one node while its policy is eligible to run. It may contain a timer, elapsed polling time, retry count, and pause state.

A **policy attempt** is a refresh initiated by the policy controller. It uses the existing execution engine and concurrency limiter but has automatic ownership distinct from caller-owned `refresh(...)`.

A **poll cycle** begins when a subscribed poll-enabled node first produces a successful value that does not satisfy its stop or failure condition. It ends on completion, terminal condition, timeout, retry exhaustion, dependency invalidation, or final unsubscribe.

### Proposed public API

#### Data-node policy declaration

Only data nodes accept a refresh policy in Milestone 8:

```ts
const ReportProgress = defineDataNode({
  key: "reportProgress",
  dependencies: [ReportId] as const,
  initialValue: undefined as ReportProgress | undefined,
  load: ({ get, signal }) => api.getProgress(get(ReportId), signal),
  refresh: pollUntil({
    intervalMs: 2_000,
    stopWhen: result => result?.state === "completed",
    failWhen: result => result?.state === "failed",
    timeoutMs: 10 * 60_000,
    retry: {
      maxRetries: 3,
      strategy: "exponential",
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    },
  }),
});
```

The first release supports one policy per data node. Policy composition is deferred because combining stale-time, interval, and polling policies creates ordering and ownership rules that are not yet required.

Planned factories:

```ts
staleAfter({ durationMs: 30_000 });

refreshInterval({
  intervalMs: 30_000,
  retry: { maxRetries: 2, strategy: "fixed", delayMs: 1_000 },
});

pollUntil({
  intervalMs: 2_000,
  stopWhen: value => value.state === "completed",
  failWhen: value => value.state === "failed",
  timeoutMs: 600_000,
  retry: { maxRetries: 3, strategy: "exponential", initialDelayMs: 1_000 },
});
```

Proposed policy kinds:

```ts
type RefreshPolicy<TValue> =
  | StaleAfterPolicy
  | RefreshIntervalPolicy
  | PollUntilPolicy<TValue>;
```

Policy descriptors are frozen by their factory. Numeric durations must be finite and greater than zero. Retry counts must be non-negative integers. Jitter must be between `0` and `1`. `maxDelayMs` must not be less than the initial delay.

Context and derived nodes do not accept `refresh` in Milestone 8:

- Context values change through `setContext(...)`.
- Derived nodes are recalculated from dependency invalidation and explicit refresh.
- Polling a derived node would introduce timer activity without I/O and blur dependency ownership.

#### Policy errors

Export narrow error types for terminal policy outcomes:

```ts
class GraphPollingTimeoutError extends Error {
  readonly nodeKey: string;
  readonly timeoutMs: number;
}

class GraphPollingConditionError extends Error {
  readonly nodeKey: string;
}

class GraphRefreshRetryExhaustedError extends Error {
  readonly nodeKey: string;
  readonly attempts: number;
  readonly cause: Error;
}
```

A terminal policy error uses the existing stale-success model. Previously successful data remains available, `error` exposes the terminal outcome, `freshness` remains `stale`, and `hasSuccessfulValue` remains true.

#### Runtime pause and resume seam

The core receives an optional environment rather than importing browser APIs:

```ts
interface RefreshPolicyEnvironment {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly random: () => number;
  readonly isPaused: () => boolean;
  readonly onPauseChange: (listener: (paused: boolean) => void) => () => void;
}

createGraphRuntime(graph, {
  maxConcurrentLoads: 6,
  refreshPolicyEnvironment,
});
```

The default core environment uses `globalThis.setTimeout`, `globalThis.clearTimeout`, `Date.now`, and `Math.random`, and is never paused. Tests inject a deterministic clock and random source.

The Vue/browser adapter may provide an environment that pauses while offline or while the document is hidden. Browser lifecycle support must remain optional so the core stays framework and browser independent. A runtime created in a Pinia store can receive the browser environment through normal runtime construction without mirroring policy state into Pinia.

### Behaviour by policy kind

#### Stale after duration

`staleAfter(...)` records the completion time of the latest successful value.

While subscribed:

- If no successful value exists, normal subscription scheduling performs the initial load.
- After success, schedule one timer for the remaining freshness duration.
- On expiry, request one policy-owned refresh.
- If a consumer subscribes after the value has already aged beyond the duration, request refresh in a microtask rather than invoking a loader synchronously from `subscribeNodes(...)`.
- A successful refresh starts a new freshness duration.
- A failed automatic refresh applies retry rules when configured. Without retry, the policy suspends until an external trigger succeeds or the subscription lifecycle restarts.

The policy does not add a public `updatedAt` field in this milestone. Successful timestamps are runtime-local policy metadata. Diagnostics may expose them later in Milestone 10.

#### Fixed interval while subscribed

`refreshInterval(...)` waits `intervalMs` after a successful attempt settles, then requests one refresh.

It must use recursive `setTimeout`, never `setInterval`, so a slow request cannot overlap the next tick. The next normal interval begins after the previous policy attempt settles successfully.

On policy-triggered load failure:

- Apply the configured retry policy.
- Never run a retry concurrently with the failed cycle's replacement work.
- After retries are exhausted, expose a terminal retry error and suspend the policy.
- A later successful manual refresh, context/event driven reload, or fresh subscription lifecycle may start a new interval session.

#### Poll until completion

`pollUntil(...)` evaluates conditions after every successful value committed for the node, including the initial subscription load and manual refreshes.

Evaluation order is fixed:

1. Evaluate `failWhen(value)` when supplied.
2. Evaluate `stopWhen(value)`.
3. Check timeout.
4. Schedule the next polling delay.

This order makes an explicit business failure terminal even if malformed data also satisfies completion. Predicates are synchronous and must not mutate runtime state.

Outcomes:

- `failWhen` true commits `GraphPollingConditionError` and stops the session.
- `stopWhen` true stops without changing the successful node state.
- Timeout commits `GraphPollingTimeoutError` and stops.
- Neither condition true schedules the next policy attempt.
- A thrown predicate is treated as a terminal policy error and stops without scheduling another attempt.

Timeout uses active elapsed time. Time spent paused does not consume the timeout budget. Dependency invalidation or context change ends the current session. A new successful value for the new generation can start a new session.

### Subscription ownership and cancellation

Policies run only while the node has total subscription ownership, including required ownership as an ancestor of a directly subscribed descendant.

On the transition from zero to non-zero ownership:

- Inspect policy metadata and current runtime state.
- Start or resume the appropriate policy session asynchronously.
- Do not invoke loaders synchronously from `subscribeNodes(...)`.

On the transition from non-zero to zero ownership:

- Clear the node's policy timer.
- Remove pause listeners owned by that session.
- Abort an active attempt only when its ownership is exclusively automatic and no subscribed node still requires it.
- Preserve work that is also owned by explicit execution, prefetch, manual refresh, or another current consumer.
- Clear session retry and polling elapsed state.

Add a distinct internal execution origin such as `refresh-policy`. Cancellation checks should use an `isAutomaticOnlyAttempt(...)` invariant rather than extending the existing scheduler-only rule ad hoc. An attempt jointly owned by `scheduler` and `refresh-policy` is still automatic-only and may be aborted after final unsubscribe. Any caller-owned origin protects the shared attempt.

### Execution and operation integration

The policy controller must not call the public runtime recursively. Add a narrow internal refresh operation that:

- accepts one registered data node;
- prepares the node using the existing refresh semantics;
- delegates to the existing execution controller with origin `refresh-policy`;
- shares compatible active work;
- uses the runtime-wide concurrency limiter;
- returns a promise the policy controller handles internally;
- does not place its rejection in `SchedulerState.error`.

Manual `runtime.refresh(...)` remains caller-owned and unchanged. Policy-triggered errors are caught by the policy controller so they do not become unhandled rejections.

`runtime.whenSettled()` remains scheduler-specific in the first implementation slice. Introduce a separate inspection and settlement contract only if deterministic tests and playground controls demonstrate a real need. The preferred initial testing approach is an injected fake clock plus observable node state, not broadening `whenSettled()` prematurely.

### Runtime refresh-policy controller

Add a feature folder:

```text
src/core/refresh-policies/
  policy.ts
  policy-controller.ts
  environment.ts
  errors.ts
  types.ts
```

Responsibilities of `policy-controller.ts`:

- Create runtime-local policy session state only for nodes that declare a policy.
- Observe subscription ownership transitions.
- Observe committed execution success and failure for relevant nodes.
- Schedule at most one timer per node.
- Request policy-owned refresh through the injected operation.
- Apply retry delay calculation.
- Evaluate poll stop and failure predicates after successful commits.
- Track active polling elapsed time and pause duration.
- Commit terminal policy errors through a narrow injected state transition.
- Dispose timers and environment listeners when the runtime or session no longer needs them.

The controller must not own graph topology, node values, active-attempt storage, the concurrency limiter, or Vue lifecycle APIs.

### Required integration seams

#### Node definitions

`DataNodeDefinition` and `DataNodeOptions` gain a typed optional `refresh` field. `defineDataNode(...)` retains the frozen descriptor. Existing node inference is unchanged when the field is omitted.

Graph creation validates defensive untyped policy shapes. Normal policy factories validate early, while graph validation protects JavaScript callers and forged descriptors.

#### Subscriptions

The subscription controller should expose one callback after committed total ownership changes. The runtime composition root forwards only zero-to-non-zero and non-zero-to-zero transitions to the policy controller. Avoid making the subscription controller import refresh-policy types.

#### Execution

The execution controller should expose a narrow completion callback containing:

- registered node;
- generation;
- outcome: success, failure, aborted, or obsolete;
- committed value for success where applicable;
- execution origins.

Only committed current-generation outcomes drive policy decisions. Aborted and obsolete completions must not schedule timers or retries.

If adding a general completion callback would broaden the execution controller unnecessarily, use separate `onCommittedSuccess` and `onCommittedFailure` callbacks. Prefer the smallest shape required by M8.

#### State transitions

Terminal timeout, condition, and retry-exhaustion errors need one explicit policy-owned transition. It must:

- verify the node generation still matches the policy session;
- preserve successful data;
- set status to `error`;
- set freshness to `stale`;
- store the error;
- preserve `hasSuccessfulValue`;
- notify once;
- avoid scheduling another policy attempt.

Do not write mutable node state directly from timer callbacks without generation validation.

#### Transactions and events

Policy timers and attempts are independent runtime operations. They do not join a transaction merely because a transaction is open.

- Policy attempts read committed context state.
- Transaction-staged context and event changes remain invisible until commit.
- A transaction commit that invalidates the node advances its generation, which closes the prior policy session and makes late completions obsolete.
- Policy notifications and execution results remain independent of the unrelated transaction notification buffer, consistent with transaction ownership isolation.

The policy controller must not expose policy operations on `GraphTransaction`.

### Retry, backoff, and jitter

Retry is optional and applies only to policy-owned load failures. It does not alter manual refresh, prefetch, explicit execution, or scheduler retry behaviour.

Supported strategies:

- Fixed: every retry uses the configured delay.
- Exponential: `initialDelayMs * multiplier ** retryIndex`, capped by `maxDelayMs`.

Jitter uses bounded proportional variation:

```text
baseDelay * (1 - jitterRatio + 2 * jitterRatio * random())
```

The final delay is clamped to zero or greater and rounded deterministically. With `jitterRatio: 0`, no random source is consulted.

`maxRetries` counts retries after the failed policy attempt. A value of `0` means fail without retry. Retry counters reset after a successful policy attempt, a new generation, final unsubscribe, or explicit session restart.

### Pause and resume behaviour

When the environment reports paused:

- Clear pending timers.
- Record remaining delay and active polling elapsed time.
- Do not start new policy attempts.
- Do not abort an attempt already inside its loader solely because the environment paused.

When resumed:

- Re-check current subscription ownership, generation, and terminal state.
- Restore the remaining delay.
- Coalesce multiple pause/resume notifications.
- If the delay elapsed according to active time, queue one policy attempt.
- Never replay multiple missed interval ticks.

A final unsubscribe while paused disposes the session. Resubscription creates a clean session from the current committed value and generation.

### Deterministic timer model

Tests must not rely on real delays. Inject a fake environment with:

- controllable monotonic time;
- explicit timer advancement;
- deterministic queued callback order;
- deterministic random values;
- pause notifications;
- inspection for outstanding timer count.

Timer callbacks must re-check node generation, subscription ownership, pause state, and session token before mutation or refresh. Clearing a timer is not enough because a callback may already be queued.

### Failure and race semantics

Required invariants:

- At most one timer exists per policy-enabled node.
- At most one policy-owned attempt for one node generation is active.
- A slow request never overlaps the next interval or poll request.
- Manual refresh may share compatible work rather than duplicate it.
- Context or event invalidation closes the old policy session.
- Final unsubscribe prevents later queued callbacks from starting a loader.
- An ignored-abort result cannot overwrite a newer generation.
- Predicate and timeout errors do not erase successful data.
- A timer callback after disposal is a silent no-op.
- Policy failure does not populate `SchedulerState.error`.
- Independent nodes retain independent policy sessions and may execute concurrently subject to `maxConcurrentLoads`.

### Inspection and diagnostics boundary

Milestone 8 should add only the minimum inspection required for deterministic behaviour and playground display. If needed, expose a frozen per-node snapshot:

```ts
interface RefreshPolicyState {
  readonly status: "inactive" | "waiting" | "refreshing" | "paused" | "completed" | "failed";
  readonly attempt: number;
  readonly nextRefreshAt: number | null;
  readonly elapsedMs: number;
}
```

Prefer keeping this internal until the playground proves a public consumer need. Structured reasons, event history, duration metrics, and cross-node timelines remain Milestone 10 work.

### Implementation sequence

#### M8A: Policy definitions and validation

Status: Complete and validated.

- Add refresh-policy contracts and immutable factories.
- Add optional `refresh` metadata to data-node definitions only.
- Validate durations, retry options, jitter, predicates, and defensive untyped shapes.
- Add public exports and compile-time tests.
- Confirm existing data-node inference is unchanged.
- Add ADR-012 and update current API documentation with planned wording only.

Exit condition: strongly typed policy definitions can be declared but do not create timers or runtime behaviour.

#### M8B: Runtime policy controller and stale-after behaviour

Status: Complete and validated.

- Add the injected environment and runtime-local policy sessions.
- Add subscription transition integration.
- Add committed-success integration.
- Implement `staleAfter(...)` with one timer per subscribed node.
- Add policy-owned refresh execution origin and internal operation delegation.
- Add automatic-only cancellation on final unsubscribe.
- Add deterministic fake-clock tests.

Exit condition: a subscribed successful node refreshes once when its freshness duration expires, and no timer or attempt survives final unsubscribe.

#### M8C: Fixed interval while subscribed

Status: Complete and validated.

- Implement recursive timeout scheduling after settled success.
- Prevent overlapping loads.
- Preserve runtime-wide concurrency limits and active-attempt sharing.
- Cover slow loads, unsubscription, invalidation, manual refresh interaction, and independent runtimes.

Exit condition: a subscribed node refreshes repeatedly at settled intervals with no overlapping requests.

#### M8D: Poll-until completion, failure, and timeout

Status: Complete and validated.

- Implement `pollUntil(...)` condition evaluation.
- Define generation-scoped polling sessions.
- Add terminal condition and timeout error transitions.
- Preserve latest successful progress data.
- Stop on completion, business failure, timeout, dependency invalidation, or final unsubscribe.
- Add predicate-failure atomicity and ignored-abort race coverage.

Exit condition: a long-running resource advances through deterministic progress values and stops exactly once on completion, failure, or timeout.

#### M8E: Retry, backoff, jitter, pause, and resume

Status: Complete and validated.

- Add fixed and exponential retry calculation.
- Add bounded jitter using injected randomness.
- Add retry exhaustion behaviour.
- Add pause/resume environment handling and active-time timeout accounting.
- Add optional Vue/browser environment integration for visibility and network state.
- Verify no replay storm after resume.

Exit condition: transient policy failures retry deterministically, paused sessions create no requests, and resume schedules at most one continuation.

#### M8F: Progress playground

Status: Complete and validated.

Add a deterministic **Polling Progress** scenario that exposes:

- current operation identifier;
- progress value and node state;
- request count and maximum concurrent request count;
- start or mount consumer control;
- complete, fail, timeout, pause, resume, and unmount controls;
- retry attempt and scheduled-delay display where available;
- reset with zero outstanding timers.

Required demonstrations:

- Progress advances through a fixed response sequence.
- Only one request is active at a time.
- Completion stops polling.
- Business failure stops polling and retains the latest data.
- Timeout stops polling.
- Transient request failure retries with deterministic delay.
- Pause prevents requests and freezes timeout budget.
- Resume continues once without replaying missed ticks.
- Unmount releases subscriptions, timers, and automatic-only work.
- Switching tabs leaves no suspended timers or Vue warnings.

Use Vue Testing Library with injected fake time. Do not expose real random failures or real-time waits.

#### M8G: Documentation reconciliation and final validation

Status: Complete and validated. See docs/implementation/86-milestone-8-implementation-summary.md.

- Update the public API from proposed to implemented wording.
- Update architecture, roadmap, testing strategy, playground instructions, README status, and ADR-012 status.
- Add a Milestone 8 implementation summary and validation handoff.
- Run the complete repository command suite against the combined checkout.
- Complete every Polling Progress manual browser path.

Exit condition: policy types, runtime behaviour, Vue lifecycle integration, deterministic tests, production build, and manual playground validation all pass.

### Behavioural test plan

#### Policy definitions and type safety

- Immutable policy descriptors.
- Invalid duration, retry count, multiplier, maximum delay, and jitter rejection.
- `pollUntil` value inference from its data node.
- Rejection of refresh metadata on context and derived nodes.
- Existing node inference unchanged when no policy is supplied.

#### Stale after

- Initial subscription load remains scheduler-owned.
- Timer begins after committed success.
- Remaining duration is honoured on later subscription.
- Expiry starts one policy refresh asynchronously.
- Equal result becomes fresh and restarts the duration.
- Final unsubscribe clears the timer.

#### Interval

- Repeated settled refresh.
- No overlap during a slow load.
- One timer after success.
- Failure enters retry or terminal suspension.
- Manual refresh interaction does not duplicate a load.
- Runtime concurrency cap remains global.

#### Polling

- Intermediate values continue polling.
- Completion stops polling.
- Business failure stops with retained data.
- Timeout uses active elapsed time.
- Predicate throw is terminal and applies no extra refresh.
- New generation starts a clean session.
- Final unsubscribe stops the session.

#### Retry and pause

- Fixed retry delays.
- Exponential cap.
- Deterministic jitter bounds.
- Retry exhaustion error.
- Retry reset after success.
- Pause clears timers and suppresses new attempts.
- Resume restores one remaining delay.
- Paused duration excluded from poll timeout.
- Repeated lifecycle events coalesce.

#### Races and ownership

- Queued callback after unsubscribe is ignored.
- Context invalidation before timer callback closes the old session.
- Late ignored-abort completion cannot restart an obsolete session.
- Shared scheduler and policy ownership is cancellable only when automatic-only.
- Caller-owned execution protects shared work from final unsubscribe.
- Separate runtimes do not share sessions, clocks, retries, or timers.
- Runtime disposal or playground unmount leaves zero timers and listeners.

### Documentation changes during implementation

Maintain these documents as each slice progresses:

- `README.md`
- `docs/README.md`
- `docs/api/01-public-api.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/architecture/07-vue-and-pinia-integration.md`
- `docs/decisions/ADR-012-refresh-policies-and-polling.md`
- `docs/implementation/01-roadmap.md`
- `docs/implementation/02-playground.md`
- `docs/testing/01-test-strategy.md`
- `docs/PLAYGROUND.md`
- Milestone 8 slice notes, implementation summary, and validation handoff.

Historical notes must remain point-in-time records. Do not rewrite prior milestone notes to describe new behaviour.

### Validation contract

For every implementation slice:

```text
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

For M8F and M8G also run:

```text
pnpm dev
```

Do not mark a slice validated until results are reported against the combined checkout. Do not mark Milestone 8 complete until automated validation and the complete manual Polling Progress checklist pass.

### Explicit non-goals

Milestone 8 does not add:

- Optimistic mutations or rollback snapshots.
- General retry behaviour for manual refresh, prefetch, or explicit execution.
- Async derived nodes.
- Multiple composed policies on one node.
- Cron expressions or wall-clock schedules.
- Background polling without subscription ownership.
- Cross-tab polling coordination.
- Durable timers or persistence across page reload.
- Server-driven push, WebSockets, or service-bus transport.
- Structured diagnostics, metrics sinks, or devtools timelines.
- Browser focus or reconnect refresh beyond the pause/resume environment seam.
- Cache garbage collection.

### Risks to preserve during implementation

#### Timer leaks

Every timer must belong to a generation-scoped session and be cleared on unsubscribe, invalidation, terminal outcome, and disposal. Callbacks must still validate their session token because clearing alone does not cancel an already queued callback.

#### Duplicate orchestration

Policy work must delegate to the existing refresh and execution machinery. A separate polling loader path would bypass concurrency, deduplication, generation safety, and failure semantics.

#### Ambiguous settlement

Do not silently broaden `whenSettled()` to include future timers. A continuously subscribed interval policy might otherwise make settlement impossible. Tests should use fake time and observable state. A later explicit `whenPolicyIdle(...)` API can be considered only if a concrete consumer requires it.

#### Retry storms

Retries are per node and bounded. Resume coalesces missed time into one attempt. Jitter is deterministic under an injected source and never creates negative delay.

#### Transaction ownership

Automatic timers do not become transaction-owned from ambient timing. They use committed state and remain independent, matching the explicit ownership model established before Milestone 8.

#### Browser coupling

The core must not import `window`, `document`, `navigator`, Vue, or Pinia. Browser lifecycle detection belongs in the optional Vue/browser environment adapter.

### Open decisions before M8A implementation

The plan recommends these defaults:

- One policy per data node.
- Policies require subscription ownership.
- `failWhen` is evaluated before `stopWhen`.
- Poll timeout excludes paused time.
- Retry applies only to policy-owned load failures.
- Retry exhaustion suspends automatic policy work until an external success or a clean subscription session.
- `whenSettled()` remains scheduler-specific.
- Policy timestamps remain internal until diagnostics work.

If any of these should differ, change ADR-012 and this plan before implementing M8A because they affect public types or observable runtime behaviour.

### Next task

After review, prepare **M8A: Policy definitions and validation** as a small implementation slice with no timers or runtime refresh behaviour.
