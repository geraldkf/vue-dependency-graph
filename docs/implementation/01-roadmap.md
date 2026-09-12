# Implementation Roadmap

The framework should be delivered in vertical milestones. Every milestone must update documentation, tests, playground scenarios, and diagnostics.

## Milestone 0: Single-package repository bootstrap

Status: Validation pending.

Implementation prompt: `docs/implementation/prompts/001-bootstrap-pnpm-repository.md`

- [x] Prepare a single pnpm package configuration
- [x] Add root scripts and package manager declaration
- [x] Declare supported Node.js and pnpm versions
- [x] Add strict TypeScript configuration
- [x] Create logical `src/core`, `src/vue`, `src/devtools`, and `src/playground` folders
- [x] Add public and layer entry points
- [x] Add Vue 3.5 and Vite playground bootstrap
- [x] Add Vitest 3.0.7 smoke tests
- [x] Add Vue Testing Library playground smoke test
- [x] Add a simple boundary check for core isolation
- [x] Add minimal CI workflow
- [x] Document root commands and offline validation
- [ ] Generate and commit `pnpm-lock.yaml` offline
- [ ] Receive successful offline validation feedback

Prepared exit criteria are met by static inspection. Validated exit criteria remain pending until the developer reports successful installation, type checking, tests, build, boundary check, frozen installation, and playground startup.

## Milestone 1: Graph registry and validation

Status: Validation pending.

- [x] Prepare typed node handles
- [x] Prepare context, data, and derived definitions
- [x] Prepare order-independent subscription
- [x] Prepare parent and child indexes
- [x] Prepare duplicate detection
- [x] Prepare missing dependency detection
- [x] Prepare cycle detection
- [x] Prepare read-only topology inspection
- [x] Prepare behavioural and type tests
- [x] Update API and architecture documentation
- [ ] Receive successful offline validation feedback

Prepared exit criteria are met by static inspection. Milestone 1 remains incomplete until offline type checking, tests, build, boundary validation, and playground startup are reported successful.

## Milestone 2: Runtime state and execution

Status: Validation pending.

- [x] Prepare separate runtime state
- [x] Prepare status and freshness model
- [x] Prepare typed context updates and descendant invalidation
- [x] Prepare dependency-aware explicit execution
- [x] Prepare concurrent independent branches
- [x] Prepare per-attempt abort controllers
- [x] Prepare generation-based obsolete-result protection
- [x] Prepare in-flight deduplication
- [x] Prepare initial and refresh error distinction
- [x] Prepare branch-scoped failure handling
- [x] Prepare runtime observation and read-only state inspection
- [x] Prepare behavioural and type tests
- [x] Update API and architecture documentation
- [ ] Receive successful offline validation feedback

Prepared exit criteria are met by static inspection. Milestone 2 remains incomplete until offline type checking, tests, build, boundary validation, and playground startup are reported successful.

## Milestone 3: Subscription and scheduler

### Step 3A: Node subscription and lifecycle

Status: Validated offline.

- [x] Prepare direct node subscription
- [x] Prepare reference-counted subscription ownership
- [x] Prepare transitive required subscription
- [x] Prepare subscription-level deduplication
- [x] Prepare idempotent release
- [x] Prepare subscription inspection and observation
- [x] Prepare behavioural and type tests
- [x] Update API and architecture documentation
- [x] Receive successful offline validation feedback

### Step 3B: Automatic subscription scheduler

Status: Validated offline.

- [x] Prepare microtask scheduling
- [x] Prepare coalesced execution flushes
- [x] Prepare automatic execution for subscribed stale nodes
- [x] Prepare active-flush follow-up handling
- [x] Prepare subscription-driven cancellation ownership
- [x] Prepare scheduler failure inspection
- [x] Prepare scheduler settlement API
- [x] Prepare behavioural and type tests
- [x] Update API and architecture documentation
- [x] Receive successful offline validation feedback

### Step 3C: Prefetch and manual refresh

Status: Validated offline.

- [x] Prepare one-shot prefetch without persistent subscriptions
- [x] Prepare manual refresh for data and derived nodes
- [x] Prepare caller-operation ownership and deduplication
- [x] Prepare changed-result descendant invalidation
- [x] Prepare scheduler interaction and cancellation semantics
- [x] Prepare failure and recovery behaviour
- [x] Prepare behavioural and type tests
- [x] Update API and architecture documentation
- [x] Receive successful offline validation feedback

Milestone exit criteria: creating subscription automatically loads exactly the required graph without a public `loadData()` call.


Milestone 3 status: Complete.

## Execution concurrency limit

Status: Planned. Not yet implemented.

Implementation plan: `docs/implementation/26-execution-concurrency-limit-plan.md`

Design decision: `docs/decisions/ADR-011-execution-concurrency-limit.md`

An enhancement to the Milestone 2/3 execution engine, not tied to a numbered milestone. Prompted by a request to make sibling dependencies run concurrently and add a concurrency cap — checked first, not assumed: sibling and independent-target concurrency already works today (verified empirically, see the plan doc), so this item is scoped to the part that was genuinely missing, a configurable cap on simultaneous data-node loads. Does not block, and isn't blocked by, Milestone 4 or Milestone 5 — sequencing relative to them is still open.

- [ ] Hand-rolled FIFO counting semaphore (`createExecutionConcurrencyLimiter`)
- [ ] Wire it around `DataNodeDefinition.load()` calls only, not `derive()`
- [ ] Abort-while-queued handling (reuses existing obsolete-attempt classification, no new logic needed there)
- [ ] `GraphRuntimeOptions.maxConcurrentLoads`, default unlimited, on `createGraphRuntime`
- [ ] Tests: capped concurrency timing, abort-while-queued, default-unlimited regression, derived nodes never gated
- [ ] Receive successful offline validation feedback

## Milestone 4: Vue adapter

Implementation plan: `docs/implementation/25-vue-adapter-and-playground-plan.md`

- [ ] V1: Plugin and injection
- [ ] V2: Scope-safety guard
- [ ] V3A: `useNode` — dirty-check comparator (`statesEqual`)
- [ ] V3B: `useNode` — subscription and sync wiring
- [ ] V3C: `useNode` — scope guard and public return shape
- [ ] V3D: `useNode` — tests
- [ ] V4: `useNodes` with query aggregate state and alias-preserving typing
- [ ] V5A: Shared configurable mock loader
- [ ] V5B: Playground scenario — context switching
- [ ] V5C: Playground scenario — concurrent consumers
- [ ] V5D: Playground scenario — error and retry
- [ ] V5E: Playground scenario — unmount cleanup
- [ ] V5F: Playground scenario — aggregate query
- [ ] V5G: Playground shell (tabs, plugin installed in `main.ts`)
- [ ] V6: Playground smoke tests
- [ ] Behaviour tests with Vue Testing Library
- [ ] Update API and architecture documentation
- [ ] Receive successful offline validation feedback

Exit criteria: a Vue component loads and refreshes graph data without manual load or unsubscribe calls, demonstrated both by Vue Testing Library assertions and by hand in the running playground.

Milestone 4 was swapped ahead of what was originally numbered Milestone 4 (transactions, now Milestone 5): the core has never been exercised by a real consumer, and every runtime capability added since Milestone 3 (notification buffer, feature-folder restructure) was validated only against unit tests calling the core API directly. Proving the core against a real Vue component first is lower-risk than adding transaction staging on top of an unproven foundation. See the discussion preceding this decision for the full reasoning; nothing here is a hard technical dependency in either direction.

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

- [ ] Atomic context updates
- [ ] Nested transactions
- [ ] Deferred invalidation
- [ ] Deferred scheduling
- [ ] Transaction rollback for local synchronous failure
- [ ] Generation changes and abort behaviour

Exit criteria: observers do not see partially committed related context values.

Design decision recorded ahead of implementation: `docs/decisions/ADR-005-atomic-graph-transactions.md`.

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
