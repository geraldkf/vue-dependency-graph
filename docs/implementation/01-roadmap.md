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
- [x] Prepare order-independent registration
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

- [ ] Status and freshness model
- [ ] Dependency-aware planner
- [ ] Concurrent independent branches
- [ ] Per-execution abort controller
- [ ] Generation-based stale result protection
- [ ] In-flight deduplication
- [ ] Initial and refresh error distinction
- [ ] Branch-scoped failure

Exit criteria: deterministic graph execution under success, failure, cancellation, and racing context changes.

## Milestone 3: Demand and scheduler

- [ ] Demand registration
- [ ] Microtask scheduling
- [ ] Coalesced execution flushes
- [ ] Demand release
- [ ] Prefetch
- [ ] Manual refresh
- [ ] No public `loadData()` requirement

Exit criteria: creating demand automatically loads exactly the required graph.

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
- [ ] Fixed interval while demanded
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

Exit criteria: every node execution can be traced to demand and invalidation reasons.

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
- [ ] Direct-demand-only semantics if still required
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
