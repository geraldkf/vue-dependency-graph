# ADR-015: Devtools as an Embeddable Component Over a Protocol Layer

## Status

Accepted, implemented, and validated.

## Context

The runtime diagnostics foundation provides structured events, cumulative metrics, and safe versioned snapshots. A developer-facing UI needs to turn those contracts into a graph, node details, a timeline, metrics, and offline inspection without depending on private runtime internals.

A conventional Vue browser-extension integration would require an additional dependency and would place the primary UI in a surface that this repository cannot exercise through its normal component and playground tests.

Embedding transformation logic directly inside Vue components would also make the inspector model harder to test and impossible to reuse from another renderer.

## Decision

Ship devtools as an embeddable Vue component over a pure framework-independent protocol layer.

### Protocol layer

The protocol transforms diagnostic snapshots, events, and metrics into stable inspector view models:

- dependency and event-invalidation graph views;
- per-node details;
- categorised timeline entries;
- grouped metrics views.

The protocol has no Vue dependency and does not require access to private runtime internals. A future renderer, including a browser-extension integration, can reuse the same transforms.

### Deterministic graph layout

Graph layout uses dependency-depth columns and deterministic ordering within each column. The same snapshot therefore produces the same positions without force-simulation jitter, seeding, or settling logic.

Typed events use a separate lane with edges to nodes that declare them in `invalidatedBy`.

### Embeddable Vue panel

`GraphDevtoolsPanel` consumes a live runtime and the same `InMemoryGraphDiagnostics` collector configured as the runtime's sink. It provides Graph, Node, Timeline, and Metrics views plus snapshot export and import.

The panel does not create diagnostics implicitly and cannot reconstruct event history from runtime state alone.

### Offline inspection

Offline snapshot inspection uses the same protocol transforms and rendering components as live inspection. Loading a valid exported snapshot detaches the views from the live runtime until the user returns to live mode.

Offline inspection is read-only and does not restore snapshot values into a live runtime.

### Scope boundary

The panel is a read-only inspector except for exporting and importing diagnostic snapshots. It does not provide runtime commands to invalidate nodes, refresh nodes, publish synthetic events, or simulate failures.

The current implementation is not a `@vue/devtools-api` browser-extension integration. That remains an additive future renderer rather than a rewrite of the protocol.

## Consequences

- Devtools has no new runtime dependency and is testable through pure protocol tests, Vue component tests, and the playground.
- Consumers must deliberately mount the panel; there is no ambient browser-extension experience.
- Live views require the exact collector receiving the runtime's diagnostic events.
- Offline and live modes present the same view models and rendering behaviour.
- Deterministic layout makes graph rendering stable in tests and bug reports.
- A future browser-extension renderer can reuse the protocol without importing the embeddable panel.
- Runtime write controls remain outside the inspector contract.

The diagnostic event, metric, and snapshot contracts are defined by [ADR-014](./ADR-014-runtime-observability.md). Public panel and composable usage is maintained in the [Public API](../api/01-public-api.md).

## Alternatives considered

### `@vue/devtools-api` browser-extension integration

Rejected for the initial devtools UI because it adds a dependency and places the primary rendering surface outside the repository's normal automated component coverage. It may be added later as another protocol consumer.

### Force-directed graph layout

Rejected because simulation output is unstable unless additional seeding and settling rules are introduced. Dependency-depth columns provide deterministic, testable placement.

### Build view-model logic directly inside Vue components

Rejected because it would couple transformation to rendering, make pure testing harder, and prevent non-Vue consumers from reusing the inspector model.

### Restore imported snapshots into the runtime

Rejected because offline diagnostic inspection is observational. Live cache restoration is a separate persistent-cache capability with different correctness and compatibility requirements.
