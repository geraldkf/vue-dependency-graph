# Implementation History Preservation Audit

## Purpose

This is a temporary verification record for deciding whether `docs/implementation/` can be deleted safely.

The audit records only durable knowledge that affects current correctness, public compatibility, operational safety, adoption, testing, or future architectural decisions. Implementation sequencing, milestone prompts, prepared-file instructions, and point-in-time validation handoffs are not treated as durable knowledge.

## Result meanings

- **Covered**: The lesson is accurately represented in maintained documentation and supported by current source or focused tests.
- **Needs update**: The lesson exists in the implementation or tests, but the maintained documentation is incomplete, stale, or still depends on implementation-history links.
- **Not durable**: The material is delivery history and can be removed without replacement.

## Authoritative ownership

After cleanup, information should have one primary home:

- `docs/decisions`: why a material decision was made, accepted trade-offs, rejected alternatives, and revisit triggers.
- `docs/architecture`: how the current implementation works and how capabilities interact.
- `docs/api`: public contracts and observable behaviour.
- `docs/guides`: consumer adoption and operational guidance.
- `docs/testing`: validation strategy, regression areas, and deterministic testing patterns.
- `docs/ROADMAP.md`: current status, active work, documentation follow-up, and deferred capabilities.
- Source comments and focused tests: narrow implementation invariants and behavioural proof.

# Durable lesson inventory

## 1. Repository and architecture boundaries

### Durable lessons

- The project is one package with logical `core`, `vue`, `devtools`, and `playground` layers.
- `src/core` is framework-independent and must not import Vue, browser-specific APIs, devtools UI, or playground code.
- Runtime composition uses focused controllers with narrow dependencies rather than a general shared runtime-context object.
- Public layer entry points are explicit and boundary checks enforce dependency direction.

### Current documentation

- `docs/decisions/ADR-001-foundation.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/07-vue-and-pinia-integration.md`
- `CONTRIBUTING.md`

### Source evidence

- `src/core/runtime.ts`
- `src/core/composition/graph-coordination.ts`
- `src/core/composition/graph-commit.ts`
- `src/core/composition/policy-services.ts`
- `src/core/composition/scheduler-diagnostics.ts`
- `src/core/index.ts`
- `src/vue/index.ts`
- `src/devtools/index.ts`
- `scripts/check-boundaries.mjs`

### Test and validation evidence

- `pnpm check:boundaries`
- `tests/core/graph-coordination.spec.ts`
- `tests/core/runtime-golden-trace.spec.ts`

### Result

**Covered.** The durable boundary and composition decisions have maintained homes. Historical runtime-refactor sequencing is not durable.

---

## 2. Graph and node model

### Durable lessons

- Node definitions are immutable typed handles.
- Stable string keys provide runtime identity, while graph registration establishes one canonical definition per key.
- Context nodes are mutable inputs, data nodes own asynchronous work, and derived nodes remain synchronous.
- Dependency resolution and topology are immutable after graph creation.
- Graph creation rejects duplicate keys, missing dependencies, duplicate dependencies, and cycles.

### Current documentation

- `docs/decisions/ADR-002-key-decisions.md`
- `docs/decisions/ADR-003-typed-handles.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/graph/node.ts`
- `src/core/graph/graph.ts`
- `src/core/graph/types.ts`
- `src/core/graph/errors.ts`

### Test evidence

- `tests/core/node-definitions.spec.ts`
- `tests/core/graph-validation.spec.ts`
- `tests/core/graph-topology.spec.ts`
- `tests/core/node-types.test.ts`
- `tests/core/refresh.spec.ts`

### Result

**Covered.** The current typed-handle and canonical-definition behaviour is documented. Historical node-definition implementation plans are not durable.

---

## 3. Runtime state invariants

### Durable lessons

- Execution status and freshness are separate facts.
- Successful stale data is retained through invalidation, refresh, and refresh failure.
- Generation represents supersession and never moves backwards.
- Rollback and release are new state transitions rather than generation rewinds.
- Every node-state write goes through named transitions.
- Aborted attempts return a node to a non-running state when they still own that state.

### Current documentation

- `docs/decisions/ADR-007-status-freshness-separation.md`
- `docs/architecture/02-graph-and-node-model.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-public-api.md`

### Source evidence

- `src/core/state/state.ts`
- `src/core/state/transitions.ts`
- `src/core/state/types.ts`

### Test evidence

- `tests/core/state-transitions.spec.ts`
- `tests/core/state-types.test.ts`
- `tests/core/runtime-state-trace.spec.ts`
- `tests/core/runtime-state.spec.ts`
- `tests/core/refresh-failure.spec.ts`

### Result

**Covered.** The maintained architecture and ADR now include the transition rule and generation semantics. Historical state-refactor plans are not durable.

---

## 4. Execution, cancellation, and concurrency limits

### Durable lessons

- Dependencies execute before dependants, while independent parents and targets run concurrently.
- One active attempt is shared per node generation.
- Generation and attempt-token checks prevent stale results from committing.
- Branch failures do not stop unrelated branches.
- Data-node loads share one runtime-wide FIFO concurrency limit; derived work does not consume slots.
- Loaders should honour `AbortSignal`, but runtime liveness does not depend on them doing so.
- Abandoning a signal-ignoring loader releases runtime ownership and capacity, so underlying real concurrency may briefly exceed `maxConcurrentLoads`.

### Current documentation

- `docs/decisions/ADR-008-branch-scoped-failures.md`
- `docs/decisions/ADR-011-execution-concurrency-limit.md`
- `docs/decisions/ADR-018-abort-ends-the-attempt.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/execution/execution.ts`
- `src/core/execution/concurrency-limiter.ts`
- `src/core/execution/types.ts`

### Test evidence

- `tests/core/execution-order.spec.ts`
- `tests/core/execution-failure.spec.ts`
- `tests/core/execution-concurrency-limiter.spec.ts`
- `tests/core/execution-shared-attempt-outcomes.spec.ts`
- `tests/core/runtime-races.spec.ts`
- `tests/retention/attempt-cleanup.spec.ts`

### Result

**Covered.** The important abort and limiter trade-off is explicitly preserved in ADR-018. Historical empirical timing notes and implementation sequencing are not durable.

---

## 5. Subscription scheduler behaviour

### Durable lessons

- Subscription registration requests scheduler work through a microtask and does not invoke loaders synchronously.
- Synchronous requests coalesce into one scheduled flush.
- Scheduler flushes may overlap to prevent unrelated head-of-line blocking.
- A node with an active unaborted attempt is not selected as a new scheduler target.
- Dependency ordering still prevents a child from running before its slow parent.
- `runtime.whenSettled()` waits for all current scheduler flushes, but not caller-owned operations, future policy timers, or uncommitted transactions.
- Scheduler error represents the latest completed flush outcome.
- Overlap trades lower latency for repeated graph scans under extreme change storms.

### Current documentation

- `docs/decisions/ADR-004-subscription-driven-loading.md`
- `docs/decisions/ADR-019-overlapping-scheduler-flushes.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-public-api.md`
- `docs/testing/01-test-strategy.md`

### Source evidence

- `src/core/scheduling/scheduler.ts`
- `src/core/scheduling/request-tracker.ts`
- `src/core/composition/scheduler-diagnostics.ts`
- `src/core/composition/graph-coordination.ts`
- `src/core/subscriptions/subscriptions.ts`

### Test evidence

- `tests/core/scheduler-coalescing.spec.ts`
- `tests/core/scheduler-overlap.spec.ts`
- `tests/core/scheduler-settlement.spec.ts`
- `tests/core/scheduler-subscription.spec.ts`
- `tests/core/scheduler-failure.spec.ts`

### Result

**Covered.** The final scheduler model and its trade-offs are documented. Earlier serialized-flush implementation notes are not durable.

---

## 6. Transactions

### Durable lessons

- Every top-level transaction owns an independent session.
- Same-session composition is explicit through `transaction.transaction(...)`.
- Only handle-owned context changes and event publications are staged.
- Plain runtime operations remain immediate and use committed state.
- Commit uses generation-based conflict detection and applies no partial effects on conflict.
- Staged event predicates read the final staged context overlay.
- Transactions provide local graph atomicity only, not backend rollback.
- `runtime.whenSettled()` remains scheduler-specific and should be awaited after transaction completion when commit-triggered work matters.

### Current documentation

- `docs/decisions/ADR-005-atomic-graph-transactions.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/transactions/transaction-coordinator.ts`
- `src/core/transactions/types.ts`
- `src/core/transactions/errors.ts`
- `src/core/composition/graph-commit.ts`

### Test evidence

- `tests/core/transaction-session-isolation.spec.ts`
- `tests/core/transaction-handle.spec.ts`
- `tests/core/transaction-conflicts.spec.ts`
- `tests/core/transaction-context-isolation.spec.ts`
- `tests/core/transaction-event-isolation.spec.ts`
- `tests/core/transaction-operation-isolation.spec.ts`
- `tests/core/transaction-rollback.spec.ts`
- `tests/core/transaction-settlement.spec.ts`
- `tests/core/transaction-races.spec.ts`

### Result

**Covered.** ADR-005 now contains only the final ownership and consistency model. Earlier ambient-group and notification-buffer plans are not durable.

---

## 7. Typed domain events

### Durable lessons

- Events are immutable typed handles used for graph invalidation, not a general asynchronous handler bus.
- Nodes declare unconditional or conditional invalidation.
- Predicates can read only declared dependencies and are evaluated before graph mutation.
- Predicate failure applies no partial event invalidation.
- Plain runtime publication is immediate; transaction publication is staged; mutation publication occurs after confirmed success.
- Event delivery is local, in-memory, non-durable, and does not provide cross-tab or server delivery.

### Current documentation

- `docs/decisions/ADR-006-domain-events.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/events/event.ts`
- `src/core/events/event-index.ts`
- `src/core/events/event-matcher.ts`
- `src/core/events/types.ts`
- `src/core/composition/graph-commit.ts`

### Test evidence

- `tests/core/event-definitions.spec.ts`
- `tests/core/event-index.spec.ts`
- `tests/core/event-publication.spec.ts`
- `tests/core/transaction-events.spec.ts`
- `tests/core/mutation-success-effects.spec.ts`
- `tests/core/mutation-event-derived-restrictions.spec.ts`

### Result

**Covered.** ADR-006, the events architecture, the Public API, the User Guide, and the test strategy now describe the current event model without depending on implementation history. Immediate runtime publication, transaction-owned publication, confirmed mutation-success publication, predicate atomicity, and local non-durable delivery are preserved.

---

## 8. Refresh policies and polling

### Durable lessons

- Refresh policies apply to data nodes only, with one policy per node.
- `staleAfter`, fixed interval, and poll-until reuse normal refresh and execution machinery.
- Policies are subscription-owned and stop when ownership disappears.
- Recursive timeouts prevent overlapping policy requests.
- Retry, backoff, jitter, pause, resume, and active poll timeout are policy-owned.
- Future policy timers are outside scheduler settlement.
- Browser lifecycle signals enter through the optional Vue timer environment.
- Refresh and release share one timer environment but remain separate controllers.

### Current documentation

- `docs/decisions/ADR-012-refresh-policies-and-polling.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/refresh-policies/policy.ts`
- `src/core/refresh-policies/policy-controller.ts`
- `src/core/refresh-policies/types.ts`
- `src/core/composition/policy-services.ts`
- `src/vue/browser-timer-environment.ts`

### Test evidence

- `tests/core/refresh-policy-definitions.spec.ts`
- `tests/core/refresh-policy-stale-after.spec.ts`
- `tests/core/refresh-policy-interval.spec.ts`
- `tests/core/refresh-policy-polling.spec.ts`
- `tests/core/refresh-policy-retry-pause.spec.ts`
- `tests/vue/browser-timer-environment.spec.ts`

### Result

**Covered.** ADR-012, the current refresh and polling architecture, the scheduler architecture, the Public API, the User Guide, and the test strategy now preserve the final policy model without implementation-history dependencies. Subscription ownership, recursive scheduling, retry, pause and resume, active-time timeout, shared execution and concurrency, scheduler settlement boundaries, timer disposal, and the shared timer environment are documented.

---

## 9. Query groups

### Durable lessons

- Query definitions are immutable typed groupings of existing nodes.
- Queries do not add graph topology or query-owned runtime state.
- Aliases preserve exact node types.
- One query definition can drive prefetch, Vue subscription, aggregate state, and refresh.
- Query refresh excludes context aliases because context values change through context APIs.

### Current documentation

- `docs/api/01-public-api.md`
- `docs/architecture/07-vue-and-pinia-integration.md`
- `docs/guides/00-user-guide.md`
- `docs/PLAYGROUND.md`

### Source evidence

- `src/core/queries/query.ts`
- `src/core/queries/types.ts`
- `src/core/operations/operations.ts`
- `src/vue/use-query.ts`

### Test evidence

- `tests/core/query-definitions.spec.ts`
- `tests/core/query-types.test.ts`
- `tests/core/query-operations.spec.ts`
- `tests/vue/use-query.spec.ts`
- `tests/vue/use-query-types.test.ts`
- `tests/playground/scenarios/query-groups.spec.ts`

### Result

**Covered.** A separate ADR is not required because the maintained API and architecture already capture the durable model and no unresolved architectural trade-off depends on implementation history.

---

## 10. Mutations

### Durable lessons

- Mutations are independent typed remote commands, not graph nodes.
- Mutation requests are not deduplicated and do not consume the data-loader concurrency budget.
- Confirmed-success effects prepare one atomic local graph commit.
- Updaters are pure replacement functions.
- Optimistic updates require successful existing data and exclusive target ownership.
- Known rejection differs from unknown remote outcome.
- Rollback never overwrites newer graph work and never rewinds generation.
- Optimistic invalidation schedules subscribed descendants immediately.
- Confirmed remote success followed by local reconciliation failure does not roll back the command.
- Mutation event predicates cannot read derived dependencies affected by the same draft.
- Graph transactions do not include remote mutation work.

### Current documentation

- `docs/decisions/ADR-013-mutation-framework.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/api/01-public-api.md`
- `docs/guides/04-mutation-adoption.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/mutations/mutation.ts`
- `src/core/mutations/mutation-controller.ts`
- `src/core/mutations/mutation-update-planner.ts`
- `src/core/mutations/optimistic-session.ts`
- `src/core/mutations/mutation-commit.ts`
- `src/core/mutations/mutation-settlement.ts`
- `src/core/mutations/mutation-value-guard.ts`
- `src/core/mutations/errors.ts`

### Test evidence

- `tests/core/mutation-execution.spec.ts`
- `tests/core/mutation-success-effects.spec.ts`
- `tests/core/mutation-optimistic.spec.ts`
- `tests/core/mutation-outcomes-races.spec.ts`
- `tests/core/mutation-reconciliation-failure.spec.ts`
- `tests/core/mutation-rollback-scheduling.spec.ts`
- `tests/core/mutation-optimistic-descendants.spec.ts`
- `tests/core/mutation-event-derived-restrictions.spec.ts`
- `tests/core/mutation-updater-purity.spec.ts`
- `tests/core/mutation-decomposition-safety.spec.ts`

### Result

**Covered.** ADR-013, the current mutation architecture, the Public API, the Mutation Adoption Guide, the User Guide, and the test strategy now preserve the final mutation model without implementation-history dependencies. Confirmed-success reconciliation, optimistic ownership, pure updates, rollback safety, unknown outcomes, reconciliation failure, event predicate restrictions, transaction independence, internal responsibility boundaries, and public error behaviour are documented.

---

## 11. Diagnostics, snapshots, and devtools

### Durable lessons

- Diagnostics are optional, synchronous, observational, and failure-isolated.
- Events are immutable and ordered within a runtime.
- Runtime-local IDs are diagnostic correlation, not distributed tracing identifiers.
- Metrics derive from the same event stream.
- The in-memory collector is bounded and tracks dropped records.
- Snapshot values are omitted by default and explicit redactors fail safely.
- Normalisation removes volatile identity and time values while preserving causality.
- Diagnostic snapshots are not live cache restoration.
- Devtools consumes a public protocol layer rather than private runtime internals.
- The devtools panel is embeddable, deterministic, and read-only except export/import.
- Offline viewing reuses the same protocol transformations as live viewing.

### Current documentation

- `docs/decisions/ADR-014-runtime-observability.md`
- `docs/decisions/ADR-015-devtools-inspector-protocol.md`
- `docs/architecture/06-observability-devtools-and-snapshots.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/core/diagnostics/diagnostic-emitter.ts`
- `src/core/diagnostics/in-memory-diagnostics.ts`
- `src/core/diagnostics/metrics.ts`
- `src/core/diagnostics/snapshot.ts`
- `src/core/diagnostics/snapshot-normaliser.ts`
- `src/devtools/protocol/`
- `src/devtools/components/GraphDevtoolsPanel.vue`
- `src/devtools/composables/use-graph-devtools.ts`
- `src/devtools/composables/use-offline-devtools-snapshot.ts`

### Test evidence

- `tests/core/runtime-diagnostics.spec.ts`
- `tests/core/runtime-diagnostics-causality.spec.ts`
- `tests/core/runtime-diagnostics-advanced.spec.ts`
- `tests/core/in-memory-diagnostics.spec.ts`
- `tests/core/diagnostic-snapshot.spec.ts`
- `tests/core/diagnostic-normaliser.spec.ts`
- `tests/core/diagnostic-regression.spec.ts`
- `tests/devtools/protocol/graph-view.spec.ts`
- `tests/devtools/protocol/node-inspector.spec.ts`
- `tests/devtools/protocol/timeline.spec.ts`
- `tests/devtools/protocol/metrics-panel.spec.ts`
- `tests/devtools/components/GraphDevtoolsPanel.spec.ts`
- `tests/devtools/composables/use-offline-devtools-snapshot.spec.ts`

### Result

**Covered.** ADR-014, ADR-015, the observability architecture, the Public API, the User Guide, and the test strategy now describe the current diagnostic and devtools model without implementation-history dependencies. Optional emission, causality, failure isolation, bounded collection, metrics, safe snapshots, redaction, stable normalisation, protocol transforms, deterministic layout, live and offline inspection, and current limitations are preserved.

---

## 12. Release policy, retention, and runtime disposal

### Durable lessons

- Automatic release applies to successful data-node values only.
- A node policy overrides the runtime default, and `retain()` explicitly opts out.
- Total subscription ownership, including required ancestors, determines liveness.
- Release resets a node to its never-loaded state and advances generation.
- Resubscription cancels a pending release and reuses retained data.
- Refresh and release share the timer environment but have separate controllers.
- `runtime.dispose()` stops background policy timers and browser pause listeners.
- Disposal is idempotent and deliberately does not disable the runtime or abort all in-flight work.
- Released, replaced, and abandoned values and transaction or mutation intermediates become collectible.

### Current documentation

- `docs/decisions/ADR-016-value-release-policies.md`
- `docs/architecture/01-system-overview.md`
- `docs/architecture/03-scheduler-transactions-and-concurrency.md`
- `docs/architecture/07-vue-and-pinia-integration.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`
- `docs/testing/01-test-strategy.md`

### Source evidence

- `src/core/release-policies/policy.ts`
- `src/core/release-policies/policy-controller.ts`
- `src/core/composition/policy-services.ts`
- `src/core/runtime.ts`
- `src/vue/plugin.ts`
- `src/vue/browser-timer-environment.ts`

### Test evidence

- `tests/core/release-policy.spec.ts`
- `tests/core/runtime-dispose.spec.ts`
- `tests/vue/plugin.spec.ts`
- `tests/playground/dependency-graph-store-dispose.spec.ts`
- `tests/retention/garbage-collection.spec.ts`
- `tests/retention/runtime-cleanup.spec.ts`
- `tests/retention/attempt-cleanup.spec.ts`

### Result

**Covered.** The important release, disposal, and retention invariants have maintained homes and focused tests. Historical memory-investigation logs and injected-leak experiments do not need to be retained.

---

## 13. Vue and Pinia ownership

### Durable lessons

- The Vue adapter converts runtime observation into computed refs and owns component-scope subscription cleanup.
- Explicit runtime options take precedence over plugin injection.
- Pinia may own one runtime per Pinia instance but must not mirror graph state.
- Runtime ownership determines disposal; component unmount releases subscriptions but does not dispose the runtime.
- `markRaw` prevents Vue from proxying the runtime service object.
- Browser timer integration remains outside core.

### Current documentation

- `docs/architecture/07-vue-and-pinia-integration.md`
- `docs/api/01-public-api.md`
- `docs/guides/00-user-guide.md`

### Source evidence

- `src/vue/use-node.ts`
- `src/vue/use-nodes.ts`
- `src/vue/use-query.ts`
- `src/vue/plugin.ts`
- `src/vue/browser-timer-environment.ts`
- `src/playground/dependency-graph-store.ts`

### Test evidence

- `tests/vue/use-node.spec.ts`
- `tests/vue/use-nodes.spec.ts`
- `tests/vue/use-query.spec.ts`
- `tests/vue/scope-guard.spec.ts`
- `tests/vue/node-subscription.spec.ts`
- `tests/vue/plugin.spec.ts`
- `tests/playground/pinia-composable-integration.spec.ts`
- `tests/playground/dependency-graph-store-dispose.spec.ts`

### Result

**Covered.** Current ownership and cleanup guidance is maintained independently of implementation history.

---

## 14. Deferred architecture and roadmap

### Durable lessons

The following are intentionally deferred until a concrete consumer or measured need justifies them:

- SSR hydration and server prefetch.
- Persistent cache restoration.
- Cross-tab synchronisation.
- Async derived nodes.
- Durable or distributed event transport.
- Offline mutation queues.
- A generic runtime extension host.
- Count-bounded or LRU release policy.
- Explicit scheduler debounce or invalidation coalescing policy.

The next active product-shaped step is an existing-application migration trial.

### Current documentation

- `docs/decisions/ADR-002-key-decisions.md`
- `docs/decisions/ADR-017-runtime-extension-host-deferred.md`
- Alternatives and consequences in ADR-006, ADR-012, ADR-013, ADR-016, and ADR-019
- `docs/ROADMAP.md`
- `docs/implementation/01-roadmap.md`

### Source and test evidence

Deferred capability verification is primarily negative: the public exports and runtime options do not expose these features. Existing tests preserve the current supported model.

### Result

**Covered.** `docs/ROADMAP.md` is now the single current roadmap. It marks the initial framework and cache-lifecycle capabilities complete, identifies the existing-application migration trial as the active objective with measurable exit criteria, moves reference-data examples into documentation follow-up, and preserves deferred capabilities with concise revisit conditions and ADR links.

# Cross-cutting documentation integrity findings

## Maintained documents still depending on implementation history

The preservation audit found maintained files that link to `docs/implementation` for plans, summaries, migration guidance, or status evidence. These dependencies must be removed or replaced before deleting the directory.

At minimum, review:

- `docs/README.md`
- `docs/ROADMAP.md`
- `docs/architecture/04-events-refresh-and-polling.md`
- `docs/architecture/05-mutations-failures-and-cache.md`
- `docs/architecture/06-observability-devtools-and-snapshots.md`
- `docs/decisions/ADR-006-domain-events.md`
- `docs/decisions/ADR-011-execution-concurrency-limit.md`
- `docs/decisions/ADR-014-runtime-observability.md`

A repository-wide search must determine the complete final list.

## Historical validation evidence

Detailed command output, prepared-file status, implementation slice status, and manual handoff checklists are **not durable** once the final capability is represented by:

- a validated ADR status;
- the current architecture and API;
- focused automated tests;
- the current CI command set.

These records can be deleted with implementation history.

## Milestone sequence and prompt history

Milestone decomposition, implementation prompts, intermediate design proposals, and offline workflow instructions are **not durable**. Their final decisions and lessons have authoritative maintained homes identified above.

# Audit summary

## Covered

- Repository and architecture boundaries
- Graph and node model
- Runtime state invariants
- Execution, cancellation, and concurrency limits
- Subscription scheduler behaviour
- Transactions
- Typed domain events
- Query groups
- Mutations
- Release policy, retention, and runtime disposal
- Vue and Pinia ownership
- Roadmap and deferred work

## Needs update before deletion

- Refresh and polling architecture must stop linking to milestone plans and summaries.
- Observability architecture and ADR-014 must stop linking to milestone and transaction-isolation plans.
- Remaining maintained implementation-history references, including ADR-011's historical plan link, must be removed before deletion.

## Not durable

- Per-slice implementation plans
- Milestone prompts
- Prepared-file manifests
- Contained-environment instructions
- Validation handoffs and historical command output
- Intermediate transaction, scheduler, state, mutation, and composition designs
- Point-in-time “validation pending” statuses
- Historical refactor sequencing

# Deletion gate

Do not delete `docs/implementation/` until all items below are complete:

- [ ] Every `Needs update` area above has been reconciled in maintained documentation.
- [x] `docs/ROADMAP.md` is the only roadmap and describes current, active, follow-up, and deferred work.
- [ ] Maintained documents contain no links or textual dependencies on `docs/implementation`.
- [ ] No maintained document describes superseded transaction or serialized-scheduler behaviour as current.
- [ ] No maintained document contains stale “validation pending” or milestone-future wording for completed capabilities.
- [ ] Repository-wide local Markdown link validation passes after deletion.
- [ ] `pnpm check:boundaries`, `pnpm typecheck --pretty false`, `pnpm test:run`, and `pnpm build` pass against the final documentation cleanup.

# Recommended next step

Proceed with the remaining refresh-policy and observability preservation work, then remove the final maintained implementation-history references. Do not delete `docs/implementation/` until every area is marked `Covered` and the repository-wide link check passes.
