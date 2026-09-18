# Implementation Roadmap

The framework should be delivered in vertical milestones. Every milestone must update documentation, tests, playground scenarios, and diagnostics.

## Milestone 0: Single-package repository bootstrap

Status: Configuration updated; lockfile generation and final offline validation pending.

Implementation summary: `docs/implementation/04-bootstrap-summary.md`

- [x] Single pnpm package
- [x] Node.js 22.13 or newer declared
- [x] pnpm 12.4.1 declared consistently in `package.json` and CI
- [x] Strict TypeScript configuration
- [x] Logical source boundaries and public entry points
- [x] Vite playground and test infrastructure
- [x] Core boundary validation script
- [x] CI workflow
- [x] Remove npm lockfile and pnpm runtime dependency from the prepared change
- [ ] Generate and commit `pnpm-lock.yaml` with pnpm 12.4.1
- [ ] Run frozen install, typecheck, tests, build, and playground validation

Manual browser validation of the later Pinia-backed playground has been reported successful. Milestone 0 remains pending only until the pnpm 12.4.1 lockfile and final command results are reported.

## Milestone 1: Graph registry and validation

Status: Implementation complete; final combined offline validation pending.

Implementation summary: `docs/implementation/06-graph-registry-summary.md`

- [x] Immutable typed context, data, and derived node handles
- [x] Typed dependency access
- [x] Order-independent graph creation
- [x] Parent and child indexes
- [x] Duplicate key and dependency validation
- [x] Missing dependency validation
- [x] Self-cycle and multi-node cycle validation
- [x] Read-only deterministic topology inspection
- [x] Behavioural and compile-time tests
- [x] Current API and architecture documentation
- [ ] Run final combined boundary, typecheck, test, and build validation

The graph registry is used by every later runtime, Vue, Pinia, and playground capability. Final validation should use the current combined repository rather than reconstructing the original isolated Milestone 1 state.

## Milestone 2: Runtime state and execution

Status: Implementation complete; final combined offline validation pending.

Implementation summary: `docs/implementation/07-runtime-execution-summary.md`

- [x] Runtime state separated from immutable graph definitions
- [x] Status and freshness model
- [x] Typed context updates and descendant invalidation
- [x] Dependency-aware explicit execution
- [x] Concurrent independent branches and sibling dependencies
- [x] Attempt-scoped cancellation
- [x] Generation and token protection against obsolete results
- [x] Same-generation in-flight deduplication
- [x] Branch-scoped failure handling
- [x] Successful-value retention during refresh and refresh failure
- [x] Read-only runtime state inspection and observation
- [x] Behavioural and compile-time tests
- [x] Current API and architecture documentation
- [ ] Run final combined boundary, typecheck, test, and build validation

The execution engine is reused by subscription scheduling, prefetch, refresh, Vue composables, Pinia integration, and the playground. Final validation should use the current combined repository rather than reconstructing the original isolated Milestone 2 state.

## Milestone 3: Subscription, scheduler, prefetch, and refresh

Status: Complete and validated offline.

Implementation summary: `docs/implementation/08-subscription-scheduler-operations-summary.md`

- [x] Reference-counted direct and required node subscriptions
- [x] Per-subscription target and ancestor deduplication
- [x] Idempotent unsubscribe and read-only subscription inspection
- [x] Automatic microtask scheduling for subscribed stale nodes
- [x] Coalesced schedule requests and active-flush follow-up handling
- [x] Subscription-driven cancellation ownership
- [x] Scheduler error inspection and deterministic settlement
- [x] One-shot prefetch without persistent subscription ownership
- [x] Manual refresh for data and derived nodes
- [x] Shared execution ownership across explicit, scheduler, prefetch, and refresh work
- [x] Changed-result descendant invalidation
- [x] Behavioural and compile-time tests
- [x] API and architecture documentation
- [x] Successful offline validation reported

Exit criteria met: creating a node subscription automatically loads exactly the required graph without a public `loadData()` call. Prefetch and refresh reuse the same execution engine without creating duplicate orchestration paths.

## Execution concurrency limit

Status: Implemented. Final offline validation pending.

Implementation plan: `docs/implementation/26-execution-concurrency-limit-plan.md`

Implementation note: `docs/implementation/28-execution-concurrency-limit-implementation-note.md`

Design decision: `docs/decisions/ADR-011-execution-concurrency-limit.md`

An enhancement to the Milestone 2/3 execution engine, not tied to a numbered milestone. Prompted by a request to make sibling dependencies run concurrently and add a concurrency cap — checked first, not assumed: sibling and independent-target concurrency already works today (verified empirically, see the plan doc), so this item is scoped to the part that was genuinely missing, a configurable cap on simultaneous data-node loads. Does not block, and isn't blocked by, Milestone 4 or Milestone 5 — sequencing relative to them is still open.

- [x] Hand-rolled FIFO counting semaphore (`createExecutionConcurrencyLimiter`)
- [x] Wire it around `DataNodeDefinition.load()` calls only, not `derive()`
- [x] Abort-while-queued handling (reuses existing obsolete-attempt classification, no new logic needed there)
- [x] `GraphRuntimeOptions.maxConcurrentLoads`, default unlimited, on `createGraphRuntime`
- [x] Tests: capped concurrency, FIFO admission, abort-while-queued, default-unlimited regression, shared execution origins, independent runtimes, and derived nodes never gated
- [x] Playground scenario for limits of 1, 2, and unlimited with manually controlled loader completion
- [ ] Receive successful automated and manual offline validation feedback

## Milestone 4: Vue adapter and Pinia integration

Status: Complete.

Implementation summary: `docs/implementation/27-vue-adapter-implementation-summary.md`

- [x] Vue plugin and injected runtime resolution
- [x] Scope-safe `useNode` and `useNodes`
- [x] Explicit runtime option
- [x] Pinia-owned runtime integration
- [x] Behavioural and compile-time tests
- [x] Five deterministic playground scenarios
- [x] Pinia-backed playground shell
- [x] Shell lifecycle smoke tests
- [x] API and architecture documentation
- [x] Manual browser validation reported successful

Exit criteria met: a Vue component loads and refreshes graph data without manual loading or subscription cleanup, and an application with Pinia already installed can expose the runtime through a store without installing the graph runtime plugin or changing `App.vue`.

Run the full repository validation commands before release if they have not been run against the final combined change set.

## Runtime composition refactor

Status: R1A through R7 validated offline; R8 and R9 prepared with offline validation pending.

Implementation plan: `docs/implementation/11-runtime-composition-refactor-plan.md`

This behavior-preserving refactor was done in preparation for Milestone 5 (transactions).

- [x] R1A implementation: Documentation and repository cleanup
- [x] R1A offline validation
- [x] R1B implementation: Name existing runtime invariants
- [x] R1B offline validation
- [x] R1C implementation: Standardise registered-node validation
- [x] R1C offline validation
- [x] R1D implementation: Document notification ownership
- [x] R1D offline validation
- [x] R2 implementation: Extract runtime observation
- [x] R2 offline validation
- [x] R3 implementation: Extract runtime state and active-attempt storage
- [x] R3 offline validation
- [x] R4 implementation: Extract the execution controller
- [x] R4 offline validation
- [x] R5 implementation: Extract subscription storage and lifecycle
- [x] R5 offline validation
- [x] R6 implementation: Extract the automatic scheduler
- [x] R6 offline validation
- [x] R7 implementation: Extract invalidation and context updates
- [x] R7 offline validation
- [x] R8 implementation: Extract prefetch and refresh operations
- [ ] R8 offline validation
- [x] R9 implementation: Simplify runtime assembly and document internal boundaries
- [ ] R9 offline validation

The public API and runtime behavior remain unchanged. Milestone 5 (transactions) has not started.

## Core module structure

Status: Restructured; offline validation pending.

Implementation note: `docs/implementation/24-core-feature-folder-restructure-implementation-note.md`

`src/core` was reorganised from a flat directory into feature folders (`graph/`, `execution/`, `state/`, `observation/`, `subscriptions/`, `scheduling/`, `invalidation/`, `operations/`, `transactions/`), each holding its own `types.ts` next to its own capability file, with `runtime.ts` remaining the top-level composition root. This is a structural clarity change with no behavioural or public API impact; it also eliminated two circular type-import edges that previously ran through `runtime.ts`.

- [x] Move each capability file into its feature folder
- [x] Split each contract file into its owning feature folder as `types.ts`
- [x] Extract the runtime-level shared types (`NodeStatus`, `NodeFreshness`, `NodeRuntimeState`, `RuntimeNodeData`, `RuntimeListener`) out of `runtime.ts` into `state/types.ts` and `observation/types.ts`
- [x] Repoint every internal import and the public barrel (`index.ts`)
- [x] Confirm zero test files required changes (all import through the public barrel)
- [ ] Receive successful offline validation feedback

## Pre-Milestone 5 preparation: notification buffer seam

Status: Prepared; offline validation pending.

Implementation note: `docs/implementation/23-transaction-notification-buffer-implementation-note.md`

This is infrastructure prepared ahead of Milestone 5 (transactions), not the milestone itself. It routes every capability's `notify`/`schedule`/`resolveSettlementIfIdle`/`whenSettled` dispatch through one runtime-local buffer so a future transaction API has a seam to defer dispatch through, without every capability needing to know a transaction is open. It intentionally does not implement transactions.

- [x] Buffer notify/schedule/resolveSettlementIfIdle/whenSettled dispatch behind a depth counter
- [x] Support async-spanning deferral (depth stays open across an awaited gap)
- [x] Support nested calls collapsing into one commit
- [x] Preserve pass-through behavior at depth zero (no observable change to existing capabilities)
- [x] Expose `runtime.transaction(work)` on the public API
- [x] Add behavioural tests for coalescing, nesting, passthrough, and premature settlement
- [ ] Receive successful offline validation feedback

This does not satisfy any Milestone 5 checklist item below: state mutations are still applied immediately and are not batched or rolled back, so "Atomic context updates", "Deferred invalidation" (as opposed to deferred *notification*), and "Transaction rollback for local synchronous failure" remain entirely unstarted. "Deferred scheduling" is only partially addressed — the scheduler's flush is deferred until commit, but nothing yet prevents invalidation's own state mutation from happening immediately per call within a transaction body.

## Milestone 5: Transactions and invalidation

Status: Complete and validated on 14 September 2026.

Implementation plan: `docs/implementation/29-milestone-5-atomic-transactions-plan.md`  
Implementation summary: `docs/implementation/35-milestone-5-implementation-summary.md`

- [x] Atomicity model, mutation-path inventory, and implementation sequence
- [x] Atomic context updates
- [x] Transaction coordinator and operation guards
- [x] Staged context values with committed public reads
- [x] Atomic commit and coalesced invalidation
- [x] Rollback and failure-path behaviour
- [x] Settlement and execution-race behaviour
- [x] Nested and overlapping transaction semantics
- [x] Deferred invalidation and scheduling
- [x] Generation advancement and abort ordering
- [x] Focused transaction test organisation
- [x] Internal transaction contract cleanup
- [x] Playground lifecycle hardening
- [x] Transaction progress and error-driven rollback playground flows
- [x] Observer snapshot filtering fix
- [x] Boundary validation reported successful
- [x] Type checking reported successful
- [x] Complete automated test suite reported successful
- [x] Production build reported successful
- [x] Manual Atomic Transaction commit, rollback, reset, and tab-switch validation reported successful

Exit criteria met: observers do not see partially committed related context values.

The project owner reported the final combined automated and manual validation as successful on 14 September 2026. Exact command output and test totals were not stored in the repository, so this roadmap records the reported outcome without inventing counts. The pnpm 12.4.1 lockfile update remains tracked separately under Milestone 0.

## Milestone 6: Typed events

Status: Implementation and maintained documentation complete; final combined automated and manual validation pending.

Implementation plan: `docs/implementation/46-milestone-6-typed-events-plan.md`  
Implementation summary: `docs/implementation/52-milestone-6-implementation-summary.md`  
Validation handoff: `docs/implementation/53-milestone-6-validation-handoff.md`  
Design decision: `docs/decisions/ADR-006-domain-events.md`

- [x] Detailed scope, consistency model, and implementation sequence prepared
- [x] Planning review
- [x] M6A public event handles and node declaration types
- [ ] M6A offline validation
- [x] M6B graph validation and event invalidation index
- [ ] M6B offline validation
- [x] M6C immediate runtime publication
- [ ] M6C offline validation
- [x] M6D transaction-aware event publication
- [ ] M6D offline validation
- [x] M6E cross-domain playground scenario
- [ ] M6E automated and manual validation
- [x] M6F maintained documentation reconciliation
- [ ] M6F final combined automated and manual validation

Exit criteria prepared for final validation: appointment events invalidate capability status without either store importing the other.

Post-M6 structural cleanup prepared: feature contracts now use local `types.ts` files, node and event factories use singular filenames, and runtime matching uses `event-matcher.ts`. See `docs/implementation/54-feature-local-types-structure-note.md`.

## Transaction ownership isolation

Status: TOI-8F validation handoff prepared. Core boundary and standalone core TypeScript checks pass; repository and manual validation remain pending.

- [x] TOI-1 ownership isolation plan
- [x] TOI-2 public `GraphTransaction` handle and lifecycle prepared
- [ ] TOI-2 offline validation
- [x] TOI-3 explicit context ownership prepared
- [ ] TOI-3 offline validation
- [x] TOI-4 explicit event ownership prepared
- [ ] TOI-4 offline validation
- [x] TOI-5 independent notification and scheduling prepared
- [ ] TOI-5 offline validation
- [x] TOI-6 caller operations during transactions prepared
- [ ] TOI-6 offline validation
- [x] TOI-7 conflict and overlapping transaction completion prepared
- [ ] TOI-7 offline validation
- [x] TOI-8A Atomic Transaction context isolation playground prepared
- [ ] TOI-8A automated and manual validation
- [x] TOI-8B conflict playground demonstration prepared
- [ ] TOI-8B automated and manual validation
- [x] TOI-8C typed event isolation playground demonstration prepared
- [ ] TOI-8C automated and manual validation
- [x] TOI-8D playground coverage reconciliation prepared
- [ ] TOI-8D offline validation
- [x] TOI-8E maintained documentation and migration guidance prepared
- [x] TOI-8E documentation review prepared
- [x] TOI-8F final validation handoff prepared
- [x] Core boundary check
- [x] Standalone strict core TypeScript check
- [ ] Repository typecheck
- [ ] Full Vitest suite
- [ ] Production build
- [ ] Manual playground validation

Exit criterion: only operations performed through a `GraphTransaction` participate in its commit or rollback. Plain runtime operations remain independent while another transaction is open.

## Milestone 7: Query groups

Status: Implementation and maintained documentation complete; final combined automated and manual validation pending.  
Implementation plan: `docs/implementation/71-milestone-7-query-groups-plan.md`  
M7A implementation note: `docs/implementation/72-milestone-7a-query-definitions-note.md`  
M7B implementation note: `docs/implementation/73-milestone-7b-vue-use-query-note.md`  
M7C implementation note: `docs/implementation/74-milestone-7c-query-operations-note.md`  
M7D implementation note: `docs/implementation/75-milestone-7d-query-groups-playground-note.md`  
Implementation summary: `docs/implementation/76-milestone-7-implementation-summary.md`  
Validation handoff: `docs/implementation/77-milestone-7-validation-handoff.md`

- [x] M7A immutable `defineQuery(...)` definitions
- [x] M7A alias and node-handle type preservation
- [x] M7A behavioural and compile-time coverage prepared
- [ ] M7A offline validation
- [x] M7B `useQuery(...)` with aliased typed results prepared
- [x] M7B aggregate state and scope cleanup prepared
- [ ] M7B offline validation
- [x] M7C query prefetch and refresh prepared
- [ ] M7C offline validation
- [x] M7D deterministic playground scenario prepared
- [ ] M7D automated and manual validation
- [x] M7E maintained documentation reconciliation prepared
- [x] M7E final validation handoff prepared
- [ ] Core boundary check against final combined checkout
- [ ] Repository typecheck
- [ ] Full Vitest suite
- [ ] Production build
- [ ] Manual Query Groups playground validation

Exit criteria: representative page requirements are declared once and reused.

## Milestone 8: Refresh policies and polling

Status: Complete and validated. Implementation summary: `docs/implementation/86-milestone-8-implementation-summary.md`.  
Implementation plan: docs/implementation/78-milestone-8-refresh-polling-plan.md  
Design decision: docs/decisions/ADR-012-refresh-policies-and-polling.md

- [x] M8A immutable policy definitions, data-node typing, validation, and compile-time coverage. Plan: docs/implementation/79-milestone-8a-policy-definitions-validation-plan.md. Implementation note: docs/implementation/80-milestone-8a-policy-definitions-validation-note.md.
- [x] M8B runtime policy controller, injected deterministic environment, stale-after behaviour, and automatic ownership. Implementation note: docs/implementation/81-milestone-8b-stale-after-implementation-note.md.
- [x] M8C fixed interval while subscribed with recursive non-overlapping scheduling. Implementation note: docs/implementation/82-milestone-8c-fixed-interval-implementation-note.md.
- [x] M8D poll-until completion, business failure, timeout, generation changes, and terminal errors. Implementation note: docs/implementation/83-milestone-8d-poll-until-implementation-note.md.
- [x] M8E bounded retry, fixed/exponential backoff, jitter, pause/resume, and optional Vue/browser environment integration. Implementation note: docs/implementation/84-milestone-8e-retry-pause-resume-implementation-note.md.
- [x] M8F deterministic Polling Progress playground and Vue Testing Library coverage. Implementation note: docs/implementation/85-milestone-8f-polling-progress-playground-note.md.
- [x] M8G documentation reconciliation, final automated validation, and manual browser validation
- [x] Preserve the existing execution engine, refresh preparation, runtime concurrency limit, generation protection, and stale-data semantics
- [x] Clear timers and automatic-only work on final unsubscribe
- [x] Keep `whenSettled()` scheduler-specific rather than making recurring policies permanently unsettled

Exit criteria: a long-running operation progresses to completion without overlapping requests or leaked timers.

## Milestone 9: Mutation framework

Status: Milestone 9 implementation, automated validation, and manual verification complete. Post-milestone review identified focused correctness hardening to complete as M9H before Milestone 10.

Implementation plan: docs/implementation/87-milestone-9-mutation-framework-plan.md  
Design decision: docs/decisions/ADR-013-mutation-framework.md

- [x] M9A immutable mutation definitions, typed input/result contracts, and basic execution
- [x] M9B atomic direct cache reconciliation for successful data nodes
- [x] M9C combined success invalidation and typed event publication
- [x] M9D optimistic application, rollback snapshots, and known-rejection restoration
- [x] M9E overlap protection, race handling, and unknown remote outcomes
- [x] M9F deterministic Optimistic Appointment Booking playground and Vue behavioural coverage
- [x] M9G maintained documentation reconciliation and migration guidance
- [x] M9G dependency-backed automated validation and manual browser verification
- [x] Preserve framework-agnostic core boundaries and the existing state, invalidation, event, scheduler, and transaction ownership models
- [x] Reject unsafe same-node optimistic overlap rather than adding speculative optimistic layers
- [x] Never overwrite newer graph work with an obsolete rollback snapshot
- [x] Distinguish a known server rejection from an unknown remote outcome
- [x] Keep mutation requests outside the data-load concurrency budget
- [x] Extract internal invalidation or active-attempt seams only when a concrete M9 slice requires them
- [x] Limit opportunistic cleanup to code paths already changed by the active slice
- [x] Defer refresh-policy strategy, transaction lifecycle, execution, and Vue adapter refactors that do not deliver mutation behaviour

Exit criteria: a failed optimistic appointment booking restores the previous local graph state when the failure is known to be rejected by the server. An unknown outcome is retained and reconciled rather than falsely reported as rolled back.

## Milestone 9H: Mutation correctness hardening

Status: Complete and validated. The project owner reported successful combined offline validation on 15 September 2026.

Implementation plan: docs/implementation/95-milestone-9h-mutation-correctness-hardening-plan.md  
Decomposition summary: docs/implementation/109-milestone-9h-g6-final-regression-summary.md

- [x] M9H-A monotonic rollback generations and ignored-abort protection
- [x] M9H-B pure updater contract and development/test mutation guard
- [x] M9H-C remote-success reconciliation-failure recovery
- [x] M9H-D rollback scheduler recovery for restored stale subscribed state
- [x] M9H-E explicit immediate optimistic data-descendant loading coverage
- [x] M9H-F affected-derived mutation event predicate restriction
- [x] M9H-G internal mutation-controller decomposition before observability
- [x] Reconcile API, architecture, ADR, adoption, testing, and validation documentation
- [x] Complete automated and manual validation against the combined checkout

Confirmed decisions:

- Optimistic subscribed data descendants may reload before remote mutation settlement.
- Mutation event predicates may not read a derived dependency affected by the same success draft.
- Generation values remain monotonic and are not restored from rollback snapshots.
- Mutation updater functions are pure replacement functions and must not mutate graph-owned values.
- Remote success followed by local reconciliation failure retains optimistic values as stale and schedules authoritative recovery rather than rolling back.

Exit criteria: rollback cannot revive obsolete work, failed preparation cannot leak in-place changes, every ambiguous or unreconciled state is recoverable, and M10 can instrument explicit mutation lifecycle transitions.

## Milestone 10: Observability

Status: complete and validated on 16 September 2026. M10A through M10G observability delivery and final documentation are complete.  
Implementation plan: docs/implementation/110-milestone-10-observability-plan.md  
Design decision: docs/decisions/ADR-014-runtime-observability.md

- [x] M10A diagnostic contracts, runtime options, sink isolation, and deterministic IDs. Implementation note: docs/implementation/111-milestone-10a-diagnostic-foundation-note.md
- [x] M10B execution, scheduling, subscription, invalidation, and operation diagnostics. Implementation note: docs/implementation/112-milestone-10b-core-execution-causality-note.md
- [x] M10C transaction, event, refresh-policy, and mutation lifecycle diagnostics. Implementation note: docs/implementation/113-milestone-10c-advanced-lifecycle-diagnostics-note.md
- [x] M10D bounded in-memory diagnostic collector and metrics projection. Implementation note: docs/implementation/114-milestone-10d-in-memory-diagnostics-metrics-note.md
- [x] M10E diagnostic snapshot schema, safe value redaction, and error serialisation. Implementation note: docs/implementation/115-milestone-10e-diagnostic-snapshots-redaction-note.md
- [x] M10F stable snapshot normaliser and behaviour-focused regression coverage. Implementation note: docs/implementation/116-milestone-10f-stable-normaliser-regression-note.md
- [x] M10G deterministic observability playground scenario. Implementation note: docs/implementation/117-milestone-10g-runtime-observability-playground-note.md
- [x] M10H public documentation reconciliation and final validation
- [x] Preserve existing runtime behaviour when diagnostics are omitted
- [x] Keep diagnostics observational, synchronous, failure-isolated, and outside scheduler settlement
- [x] Keep devtools UI, snapshot import, persistence, and production telemetry adapters deferred

Exit criteria: every node execution can be traced to its initiating subscription, invalidation, refresh, or caller-owned operation; metrics are derivable from the same event stream; and a safely redacted, deterministic diagnostic snapshot can be exported without changing runtime behaviour.


Transaction ownership hardening completed with Milestone 10 closure: isolated top-level sessions, explicit nested composition, direct notification and scheduling, scheduler-specific settlement, session-local diagnostics, and the Transaction Isolation playground.

## Milestone 11: Devtools

Status: complete and validated on 18 September 2026.

- [x] Inspector protocol
- [x] Graph view
- [x] Node inspector
- [x] Timeline
- [x] Metrics panel
- [x] Snapshot export and offline viewer

Delivered as an embeddable Vue component panel (`src/devtools`) over a pure, framework-agnostic protocol layer, rather than a `@vue/devtools-api` browser-extension integration - see [ADR-015](../decisions/ADR-015-devtools-inspector-protocol.md). The Node inspector does not surface "last execution" or "last invalidation reason" as distinct fields (cross-reference the Timeline instead), and the original vision's write/remote-control section ("Controls" in `docs/architecture/06-observability-devtools-and-snapshots.md`) was not built - the panel is read-only plus export/import. Neither gap blocks the exit criterion below.

Exit criteria: framework behaviour can be understood without console logging.

## Milestone 12: Cache lifecycle and advanced lazy behaviour

- [ ] Garbage collection for unused data
- [ ] Direct-subscription-only semantics if still required
- [ ] Memory pressure tests
- [ ] Reference-data caching examples

Exit criteria: long-running applications do not retain unused graph data indefinitely.

## Milestone 13: Existing application migration trial

- [ ] Compatibility assessment
- [ ] Select one bounded page
- [ ] Map existing nodes to typed definitions
- [ ] Compare API calls and page behaviour
- [ ] Validate error handling and telemetry
- [ ] Document rollback plan

Exit criteria: one production-shaped workflow runs successfully with measurable parity or improvement.

## Deferred until proven necessary

- SSR hydration and server prefetch
- Persistent cache restoration
- Cross-tab synchronisation
- Async derived nodes
- Distributed event transport
- Offline mutation queue

## Milestone 9H-G mutation decomposition

M9H-G0 through M9H-G6 are implemented and validated. Mutation update planning, optimistic session policy, graph commits, and settlement coordination now live in focused internal modules behind one runtime-facing mutation controller. Milestone 10 is complete and Milestone 11 may proceed.
