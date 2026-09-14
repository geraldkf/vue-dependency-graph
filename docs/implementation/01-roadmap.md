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

Status: Implementation prepared; automated and manual validation pending.  
Implementation plan: `docs/implementation/29-milestone-5-atomic-transactions-plan.md`

- [x] Atomicity model, mutation-path inventory, and implementation sequence prepared
- [ ] Planning offline validation
- [x] Atomic context updates prepared
- [x] M5B transaction coordinator and operation guards prepared
- [x] M5C staged context values prepared
- [x] M5D atomic commit and coalesced invalidation prepared
- [x] M5E rollback and failure-path behaviour prepared
- [x] M5F settlement and execution-race behaviour prepared
- [x] M5G playground and maintained documentation prepared
- [ ] M5G automated and manual validation
- [ ] M5F offline validation
- [ ] M5E offline validation
- [ ] M5D offline validation
- [ ] M5C offline validation
- [ ] M5B offline validation
- [x] Nested transactions prepared
- [x] Deferred invalidation prepared
- [x] Deferred scheduling prepared
- [x] Transaction rollback for local synchronous and asynchronous failure prepared
- [x] Generation changes and abort behaviour prepared

Exit criteria: observers do not see partially committed related context values.

Design decision recorded ahead of implementation: `docs/decisions/ADR-005-atomic-graph-transactions.md`.

Post-validation follow-up: M5H transaction hardening and test organisation is planned in `docs/implementation/36-milestone-5-review-and-follow-up-plan.md`. It is not a blocker for Milestone 5 validation.

- [x] M5H.1 overlapping transaction semantics prepared
- [ ] M5H.1 offline validation
- [x] M5H.2 transaction test organisation prepared
- [ ] M5H.2 offline validation
- [x] M5H.3 internal transaction contracts prepared
- [ ] M5H.3 offline validation

## Milestone 6: Typed events

- [ ] Event handles and payload typing
- [ ] Event invalidation index
- [ ] Conditional event matching
- [ ] Transaction-aware event publication
- [ ] Cross-domain playground scenario

Exit criteria: appointment events invalidate capability status without either store importing the other.

## Milestone 7: Query groups

- [ ] `defineQuery`
- [ ] `useQuery`
- [ ] Aliased typed result shape
- [ ] Query refresh and prefetch

Exit criteria: representative page requirements are declared once and reused.

## Milestone 8: Refresh and polling

- [ ] Stale time
- [ ] Fixed interval while subscribed
- [ ] Poll-until completion
- [ ] Timeout
- [ ] Retry/backoff/jitter
- [ ] Pause and resume hooks
- [ ] Progress playground

Exit criteria: long-running operation progresses to completion without overlapping requests or leaked timers.

## Milestone 9: Mutation framework

- [ ] Success invalidation
- [ ] Direct cache reconciliation
- [ ] Optimistic updates
- [ ] Rollback snapshots
- [ ] Mutation event publishing
- [ ] Ambiguous remote outcome guidance

Exit criteria: failed optimistic appointment booking restores local graph state.

## Milestone 10: Observability

- [ ] Structured diagnostics stream
- [ ] In-memory metrics collector
- [ ] Load reasons
- [ ] Snapshot schema and redaction
- [ ] Stable snapshot test normaliser

Exit criteria: every node execution can be traced to subscription and invalidation reasons.

## Milestone 11: Devtools

- [ ] Inspector protocol
- [ ] Graph view
- [ ] Node inspector
- [ ] Timeline
- [ ] Metrics panel
- [ ] Snapshot export and offline viewer

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
