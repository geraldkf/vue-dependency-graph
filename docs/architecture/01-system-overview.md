# System Overview

## Architectural direction

The framework uses one package and one repository. Logical layers are separated by source folders and explicit import boundaries.

```text
Application and domain stores
             |
             v
src/vue
             |
             v
src/core
             |
             +-- registry
             +-- scheduler
             +-- transaction manager
             +-- event invalidation
             +-- refresh controller
             +-- mutation coordinator
             +-- diagnostics and metrics

src/devtools ------> public core inspection contracts

src/playground ----> public core, Vue, and devtools entry points
```

The playground and devtools consume public inspection APIs. They must not reach into private core internals.

## Layer responsibilities

### `src/core`

Framework-agnostic TypeScript. It must not import Vue, Pinia, browser lifecycle APIs, devtools UI, or playground code.

Responsibilities:

- Typed node and event definitions
- Registry and graph indexes
- Graph validation
- Demand tracking
- Node state machine
- Scheduling and execution
- Transactions
- Invalidation
- Refresh and polling policies
- Optimistic mutations
- Failure propagation
- Metrics and diagnostic events
- Snapshot export

### `src/vue`

Vue 3.5 integration.

Responsibilities:

- Convert core observations into Vue refs
- `useNode`, `useNodes`, and `useQuery`
- Scope-aware demand registration and cleanup
- Vue plugin and graph injection
- Reactive aggregate loading and error state
- Browser lifecycle integration where appropriate

### `src/devtools`

Optional inspection and visualisation.

Responsibilities:

- Dependency graph view
- Node inspector
- Execution and event timeline
- Transaction timeline
- Metrics dashboard
- Snapshot export and comparison

Devtools code must be tree-shakeable or excluded from production application usage.

### `src/playground`

A controlled Vue application where developers can change latency, failures, dependencies, contexts, event publication, mutation outcomes, and polling completion without relying on a product backend.

## Why one package

A single package is preferred during research and development because:

- Core, Vue integration, diagnostics, and playground evolve together.
- There is no current need for independent publication or versioning.
- Local imports and build configuration remain simpler.
- API experimentation does not require coordinating package releases.

Logical boundaries are still important. Moving to multiple packages later remains possible if independent consumption or versioning becomes necessary.

## Core operating model

1. Nodes and events are registered.
2. A consumer creates demand for one or more nodes.
3. The scheduler finds demanded nodes that are not fresh.
4. Required ancestors are included automatically.
5. Ready nodes execute concurrently where safe.
6. Changes are published to observers.
7. Context updates, events, mutations, or refresh policies may invalidate nodes.
8. Only demanded stale nodes and required ancestors are scheduled again.

## Important boundaries

- A node dependency means the loader requires the dependency's successful value.
- An invalidation event means the node may be out of date. It is not a data value.
- A transaction batches local graph changes. It does not provide backend atomicity.
- Demand controls whether stale data should be refreshed. Registration alone must not execute every node.
- Polling is a refresh policy, not a recursive loader implementation.

## Validation model

The contained environment prepares files and performs static inspection. The developer performs package installation, type checking, tests, builds, and runtime validation offline. Documentation and roadmap status must distinguish prepared changes from validated changes.
