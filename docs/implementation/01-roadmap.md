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

## Runtime composition refactor

Status: R1A, R1B, and R1C validated offline; R1D prepared with offline validation pending.

Implementation plan: `docs/implementation/11-runtime-composition-refactor-plan.md`

This behavior-preserving refactor is scheduled before Milestone 4.

- [x] R1A implementation: Documentation and repository cleanup
- [x] R1A offline validation
- [x] R1B implementation: Name existing runtime invariants
- [x] R1B offline validation
- [x] R1C implementation: Standardise registered-node validation
- [x] R1C offline validation
- [x] R1D implementation: Document notification ownership
- [ ] R1D offline validation
- [ ] R2: Extract runtime observation
- [ ] R3: Extract runtime state and active-attempt storage
- [ ] R4: Extract the execution controller
- [ ] R5: Extract subscription storage and lifecycle
- [ ] R6: Extract the automatic scheduler
- [ ] R7: Extract invalidation and context updates
- [ ] R8: Extract prefetch and refresh operations
- [ ] R9: Simplify runtime assembly and document internal boundaries

The public API and runtime behavior remain unchanged. Milestone 4 has not started.

## Milestone 4: Transactions and invalidation

- [ ] Atomic context updates
- [ ] Nested transactions
- [ ] Deferred invalidation
- [ ] Deferred scheduling
- [ ] Transaction rollback for local synchronous failure
- [ ] Generation changes and abort behaviour

Exit criteria: observers do not see partially committed related context values.

## Milestone 5: Vue adapter

- [ ] Plugin and injection
- [ ] `useNode`
- [ ] `useNodes`
- [ ] Scope cleanup
- [ ] Query aggregate state
- [ ] Behaviour tests with Vue Testing Library

Exit criteria: a Vue component loads and refreshes graph data without manual load or unsubscribe calls.

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
