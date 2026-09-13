# Milestone 4: Vue Adapter and Playground

## Status

Complete.

Manual browser validation of the complete Pinia-backed playground was reported successful. The milestone is closed by the project owner. Run the repository validation commands before release if they have not been run against the final combined change set.

## Outcome

Vue components can load, observe, refresh, and release graph data without manual `loadData()` calls or manual subscription cleanup.

Applications may resolve the runtime through the Vue plugin or pass an explicitly owned runtime. The playground uses the same Pinia-owned runtime pattern intended for the departmental application, avoiding a graph-specific `App.vue` or bootstrap change.

## Delivered

- `createGraphRuntimePlugin` and `useGraphRuntime`
- Active-effect-scope enforcement
- `useNode`
- `useNodes` with tuple-preserving results and aggregate state
- Explicit `GraphRuntime` composable option
- Pinia-owned runtime store
- Real Pinia integration tests
- Shared deterministic playground loaders
- Context switching scenario
- Concurrent consumers scenario
- Error and retry scenario
- Unmount cleanup scenario
- Aggregate query scenario
- Pinia-backed tabbed playground shell
- Scenario and shell smoke tests
- Public API and architecture documentation

## Final architecture

```text
Vue component
    |
    +-- explicit runtime --> Pinia store --> GraphRuntime
    |
    `-- injected runtime --> Vue plugin --> GraphRuntime
                                      |
                                      v
                                   src/core
```

The Pinia store owns the runtime instance only. It does not mirror graph state.

## Exit criteria

- A Vue component loads graph data from subscription without a public loading call.
- Context changes reload subscribed dependent data.
- Refresh works without consumer-managed subscription cleanup.
- Two consumers share one execution.
- Unmount releases component-owned subscriptions.
- Partial failure preserves independent successful branches and stale successful data.
- The playground runs all scenarios through one Pinia-owned runtime.
- Manual browser validation is successful.

## Detailed record

See [`27-vue-adapter-implementation-summary.md`](./27-vue-adapter-implementation-summary.md) for public usage, important findings, test coverage, and validation commands.
