# Execution Concurrency Limit Implementation Note

## Status

Implemented. Final offline validation is pending.

## Summary

The runtime now supports an optional per-runtime cap on simultaneous data-node loader calls:

```ts
createGraphRuntime(graph, {
  maxConcurrentLoads: 6,
});
```

Omitting the option preserves unlimited concurrency.

## Implementation

- Added a framework-agnostic FIFO counting semaphore in `src/core/execution/concurrency-limiter.ts`.
- Validated that configured limits are at least `1`.
- Added abort-aware queued acquisition. An aborted queued attempt is removed and its loader is not invoked.
- Injected one limiter into each runtime execution controller.
- Acquired immediately before `DataNodeDefinition.load()` and released in `finally`.
- Left synchronous derived-node execution outside the limiter.
- Added the public `GraphRuntimeOptions.maxConcurrentLoads` option.
- Shared the runtime limit across explicit, scheduler, prefetch, and refresh execution origins.
- Kept limits independent between runtime instances.

## Tests

Behaviour-focused coverage includes:

- Immediate acquisition while capacity exists.
- FIFO admission beyond capacity.
- Queued cancellation and already-aborted signals.
- Slot release after loader settlement.
- Configured global ceiling across independent targets.
- Default unlimited behaviour.
- One shared ceiling across execution origins.
- Queued scheduler cancellation before loader invocation.
- Derived nodes not consuming slots.
- Independent limits for separate runtimes.
- Public option typing and invalid runtime values.

The existing independent-parent concurrency test was updated to wait for its observable condition rather than assuming a fixed number of microtask turns. The limiter adds an asynchronous admission boundary even when capacity is immediately available, but it does not make independent loaders sequential.

## Playground validation scenario

`ConcurrencyLimitScenario.vue` provides four independent, manually controlled data loaders. The scenario supports limits of `1`, `2`, and unlimited, displays active and maximum-observed loader counts, shows FIFO start order and per-loader state, and provides controls to complete work and reset cleanly. Focused component tests cover capped admission, unlimited execution, FIFO progression, and reset behaviour.

Manual checks remain required for each selectable limit before the feature is marked validated.

## Validation

Completed during implementation:

- Core boundary check.
- ZIP integrity checks for each change package.

A full offline run remains required before changing the status to validated:

```bash
pnpm check:boundaries
pnpm typecheck --pretty false
pnpm test:run --reporter verbose --no-color
pnpm build
```

Do not mark this work validated until all four commands succeed against the combined checkout.
