# ADR-015: Devtools as an Embeddable Component Over a Protocol Layer

## Status

Accepted, implemented, and validated.

## Context

Milestone 10 (see [ADR-014](./ADR-014-runtime-observability.md)) delivered a structured diagnostic event stream, an in-memory collector, metrics, and versioned safe snapshots. Milestone 11's job was to put a UI on top of that.

The conventional way a Vue ecosystem library ships devtools is a `@vue/devtools-api` integration: a custom inspector tab and timeline layer inside the official browser extension, the same approach Pinia and Vue Router use. That's a reasonable default, but two constraints ruled it out for this milestone specifically:

- `@vue/devtools-api` was not already a dependency, and adding an external package whose UI surface (an actual browser extension panel) cannot be exercised by this project's test suite means shipping a large piece of functionality with no automated verification and no way to visually confirm it renders correctly.
- This project's own discipline throughout has been to verify everything it ships - typecheck, automated tests, and a playground scenario for manual QA. A browser-extension integration breaks that pattern at the one point where it matters most: the thing a person actually looks at.

## Decision

Devtools ships as an embeddable Vue component panel (`GraphDevtoolsPanel`, in `src/devtools`) that a consuming app mounts against its own runtime and diagnostics collector - the same shape TanStack Query Devtools and Nuxt Devtools use, either as their primary interface or as a stepping stone before a browser-extension integration.

The data transformation from a diagnostic snapshot and event stream into inspector-ready view models - the graph layout algorithm, node detail, timeline entries, and metrics grouping - is a separate, pure, framework-agnostic layer (`src/devtools/protocol/`) with no Vue dependency and no rendering concerns. The Vue components are one consumer of that layer, not the layer itself. This makes "inspector protocol" (named as its own concern in the original Milestone 11 plan) a real, honored decision rather than an implementation detail folded invisibly into the UI: a future `@vue/devtools-api` integration, or a third-party tool, can build on the same stable data contract without depending on Vue, and without redoing the layout algorithm or the event-categorisation logic.

Two further, smaller decisions worth recording:

- **Layout is deterministic, not force-directed.** Nodes are placed in columns by longest-path dependency depth, rows assigned alphabetically within a column. The same snapshot always produces the same positions. This was chosen specifically so the layout algorithm is unit-testable without a rendering engine and without tolerating simulation jitter between runs - a property a physics-based force layout does not have.
- **Offline viewing reuses the live views unchanged.** `useOfflineDevtoolsSnapshot` loads a previously exported JSON snapshot and feeds it through the exact same `computeGraphView`/`computeNodeDetail`/`computeTimeline`/`computeMetricsView` functions and the exact same components as the live path, with no live runtime attached. This is a direct consequence of the protocol/UI split above, not separate work - it's what "the components only need view models, not a runtime" gets you for free.

## Consequences

- Devtools has no new runtime dependencies and is fully covered by the same automated test suite as everything else in this project - typecheck, unit tests on the protocol layer, component tests on the Vue layer, and a dedicated playground scenario for manual QA.
- The panel only works where a consumer chooses to mount it; there's no ambient "install once, inspect any app" browser-extension experience. That's the direct cost of the decision above, not an oversight.
- The panel is read-only plus export/import. The original vision's "Controls" section (invalidate a node, refresh a node, publish a synthetic event, simulate failure/delay) was not built - see `docs/architecture/06-observability-devtools-and-snapshots.md` for exactly what shipped against that vision. Adding write controls remains legitimate future work; it just wasn't in this milestone's scope.
- Because the protocol layer has no Vue dependency, a future `@vue/devtools-api` integration is additive - a new renderer on the existing data contract - rather than a rewrite of the transformation logic this milestone already built and tested.

## Alternatives considered

### A `@vue/devtools-api` browser-extension integration

Rejected for this milestone for the reasons in Context above: an unverified new dependency and a UI surface this project's test suite cannot exercise. Not rejected permanently - the protocol layer this ADR establishes is designed to make that integration cheaper later, not harder.

### A force-directed or manually-positioned graph layout

Rejected. A force simulation isn't deterministic between runs (or requires seeding and settling-iteration logic to become deterministic, which is more complexity for a debugging tool than the value justifies), and manual positioning doesn't scale to graphs the consumer didn't hand-lay-out. Longest-path-depth columns give a legible, stable layout for the common case (a DAG that isn't pathologically wide) with a straightforward, testable algorithm.

### Building the view-model logic directly inside the Vue components

Rejected. This is the same reasoning as `runtime.ts`'s earlier separation of composition from cross-cutting concerns (see the codebase's own refactor history): mixing data transformation into rendering code makes the transformation harder to test in isolation and impossible to reuse from a non-Vue consumer, for no benefit the coupling would have bought.
